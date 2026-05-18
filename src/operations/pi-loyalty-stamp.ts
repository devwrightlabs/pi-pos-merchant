/**
 * @fileoverview pi-loyalty-stamp — Automatically issues cryptographic loyalty
 * tokens to the customer's Pi wallet after a successful purchase.
 *
 * @module @devright/pi-pos-merchant/operations
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import type { LoyaltyToken } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Issuance input
// ---------------------------------------------------------------------------

/** Parameters for issuing a loyalty token. */
export interface LoyaltyIssuanceParams {
  /** The Pi UID of the customer receiving the token. */
  recipientUid: string;
  /** The order ID this token is issued for. */
  orderId: string;
  /** The total Pi spent in this transaction. */
  totalPi: number;
  /** Points awarded per Pi spent.  Defaults to 1. */
  pointsPerPi?: number;
}

// ---------------------------------------------------------------------------
// Pluggable on-chain issuance handler
// ---------------------------------------------------------------------------

/**
 * Signature for a custom on-chain loyalty token issuance function.
 * Your backend calls the Pi Platform API to transfer the loyalty NFT/token
 * to the customer's wallet.
 */
export type LoyaltyIssuanceHandler = (
  token: Omit<LoyaltyToken, "txid">
) => Promise<string | undefined>; // Returns on-chain txid or undefined

let _issuanceHandler: LoyaltyIssuanceHandler = async (token) => {
  // Default: log intent.  Replace via setLoyaltyIssuanceHandler().
  console.info(
    `[pi-loyalty-stamp] Default handler: issue ${token.pointsAwarded} points to ${token.issuedTo} (order ${token.orderId})`
  );
  return undefined;
};

/**
 * Returns the active loyalty issuance handler.
 */
export function getLoyaltyIssuanceHandler(): LoyaltyIssuanceHandler {
  return _issuanceHandler;
}

/**
 * Replaces the loyalty issuance handler with a custom implementation.
 *
 * @param handler - An async function that calls the Pi Platform token-issuance
 *   API and returns the on-chain transaction ID.
 *
 * @example
 * ```ts
 * setLoyaltyIssuanceHandler(async (token) => {
 *   const res = await fetch("/api/loyalty/issue", {
 *     method: "POST",
 *     body: JSON.stringify(token),
 *   });
 *   const { txid } = await res.json();
 *   return txid;
 * });
 * ```
 */
export function setLoyaltyIssuanceHandler(handler: LoyaltyIssuanceHandler): void {
  _issuanceHandler = handler;
}

// ---------------------------------------------------------------------------
// Core issuance function
// ---------------------------------------------------------------------------

/**
 * Issues a cryptographic loyalty token to the customer's wallet post-purchase.
 *
 * @param params - {@link LoyaltyIssuanceParams}
 * @returns The issued {@link LoyaltyToken}, including the on-chain `txid` if
 *   the handler returned one.
 * @throws If token generation or issuance fails.
 *
 * @example
 * ```ts
 * const token = await issueLoyaltyToken({
 *   recipientUid: "user_123",
 *   orderId: "order_456",
 *   totalPi: 5.25,
 *   pointsPerPi: 10,
 * });
 * console.log(`Issued ${token.pointsAwarded} points — txid: ${token.txid}`);
 * ```
 */
export async function issueLoyaltyToken(
  params: LoyaltyIssuanceParams
): Promise<LoyaltyToken> {
  const { recipientUid, orderId, totalPi, pointsPerPi = 1 } = params;

  if (totalPi <= 0) {
    piLog(
      "warn",
      PI_ERROR_CODES.OPS_LOYALTY_ISSUE_FAILED,
      `issueLoyaltyToken: totalPi is ${totalPi}. No points to award.`,
      { recipientUid, orderId }
    );
    // Return a zero-point token rather than throwing.
    return {
      tokenId: generateTokenId(),
      issuedTo: recipientUid,
      issuedAt: Date.now(),
      orderId,
      pointsAwarded: 0,
    };
  }

  const pointsAwarded = Math.floor(totalPi * pointsPerPi);
  const tokenId = generateTokenId();

  const draftToken: Omit<LoyaltyToken, "txid"> = {
    tokenId,
    issuedTo: recipientUid,
    issuedAt: Date.now(),
    orderId,
    pointsAwarded,
  };

  piLog(
    "info",
    PI_ERROR_CODES.OPS_LOYALTY_ISSUE_FAILED,
    `Issuing ${pointsAwarded} loyalty points to ${recipientUid} for order ${orderId}.`,
    { tokenId, pointsAwarded }
  );

  try {
    const handler = getLoyaltyIssuanceHandler();
    const txid = await handler(draftToken);

    const token: LoyaltyToken = {
      ...draftToken,
      ...(txid !== undefined ? { txid } : {}),
    };

    piLog(
      "info",
      PI_ERROR_CODES.OPS_LOYALTY_ISSUE_FAILED,
      `Loyalty token issued: ${tokenId}${txid ? ` (txid: ${txid})` : ""}.`,
      { tokenId, txid }
    );

    return token;
  } catch (err: unknown) {
    const message = (err as Error).message ?? String(err);

    piLog(
      "error",
      PI_ERROR_CODES.OPS_LOYALTY_ISSUE_FAILED,
      `Loyalty token issuance failed for order ${orderId}: ${message}`,
      { recipientUid, orderId, tokenId }
    );

    throw new Error(`Loyalty issuance failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a unique loyalty token ID.
 */
function generateTokenId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `loyalty_${hex}`;
}
