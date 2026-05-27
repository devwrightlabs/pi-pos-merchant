/**
 * @fileoverview pi-tip-router — Separates the gratuity amount from the
 * inventory total and routes tips to a dedicated wallet address.
 *
 * @module @devright/pi-pos-merchant/operations
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";

// ---------------------------------------------------------------------------
// Tip routing
// ---------------------------------------------------------------------------

/** Result of a tip routing operation. */
export interface TipRoutingResult {
  readonly orderId: string;
  readonly tipAmountPi: number;
  readonly destinationWallet: string;
  readonly routedAt: number;
  /** Whether the tip was successfully queued for routing. */
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Routes a tip amount to a separate wallet address.
 *
 * In a production environment this would initiate a Pi Platform API call to
 * the tip wallet via your backend (server-to-user payment).  The SDK-level
 * app-to-user tip payment is handled server-side to prevent wallet exposure.
 *
 * This function validates the inputs, logs the routing event, and returns a
 * structured result.  The actual Pi Platform API call is delegated to your
 * backend (POST /api/tips/route).
 *
 * @param tipAmountPi       - The tip amount in Pi.
 * @param destinationWallet - The Pi wallet address to receive the tip.
 * @param orderId           - The associated order ID for reconciliation.
 * @returns A {@link TipRoutingResult}.
 *
 * @example
 * ```ts
 * const result = await routeTip(0.5, "GDQP2K...WALLETADDR", "order_123");
 * if (result.success) {
 *   console.log("Tip routed:", result);
 * }
 * ```
 */
export async function routeTip(
  tipAmountPi: number,
  destinationWallet: string,
  orderId: string
): Promise<TipRoutingResult> {
  // --- Validation ---
  if (tipAmountPi <= 0) {
    piLog(
      "warn",
      PI_ERROR_CODES.OPS_TIP_ROUTE_FAILED,
      `routeTip called with non-positive amount: ${tipAmountPi}. Skipping.`,
      { orderId }
    );
    return {
      orderId,
      tipAmountPi,
      destinationWallet,
      routedAt: Date.now(),
      success: false,
      error: "Tip amount must be greater than 0.",
    };
  }

  if (!isValidWalletAddress(destinationWallet)) {
    piLog(
      "error",
      PI_ERROR_CODES.OPS_TIP_ROUTE_FAILED,
      `Invalid tip wallet address: "${destinationWallet}".`,
      { orderId }
    );
    return {
      orderId,
      tipAmountPi,
      destinationWallet,
      routedAt: Date.now(),
      success: false,
      error: "Invalid destination wallet address.",
    };
  }

  piLog(
    "info",
    PI_ERROR_CODES.OPS_INFO,
    `Routing tip of ${tipAmountPi}π to ${destinationWallet.slice(0, 8)}… for order ${orderId}.`,
    { orderId, tipAmountPi }
  );

  // --- Delegate to backend ---
  // In production, call your Pi Platform server-to-user payment endpoint here.
  // We expose a hook-ready placeholder that integrators can override.
  const handler = getTipRouteHandler();

  try {
    await handler(tipAmountPi, destinationWallet, orderId);

    const result: TipRoutingResult = {
      orderId,
      tipAmountPi,
      destinationWallet,
      routedAt: Date.now(),
      success: true,
    };

    piLog(
      "info",
      PI_ERROR_CODES.OPS_INFO,
      `Tip routing successful for order ${orderId}.`,
      { orderId, tipAmountPi }
    );

    return result;
  } catch (err: unknown) {
    const message = (err as Error).message ?? String(err);

    piLog(
      "error",
      PI_ERROR_CODES.OPS_TIP_ROUTE_FAILED,
      `Tip routing failed for order ${orderId}: ${message}`,
      { orderId, tipAmountPi }
    );

    return {
      orderId,
      tipAmountPi,
      destinationWallet,
      routedAt: Date.now(),
      success: false,
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Pluggable handler
// ---------------------------------------------------------------------------

/** Signature for a custom tip route handler. */
export type TipRouteHandler = (
  amountPi: number,
  walletAddress: string,
  orderId: string
) => Promise<void>;

/** The default no-op handler (integrators replace this). */
let _tipRouteHandler: TipRouteHandler = async (amountPi, walletAddress, orderId) => {
  // Default: log intent.  Replace with a real backend call via setTipRouteHandler().
  console.info(
    `[pi-tip-router] Default handler: route ${amountPi}π → ${walletAddress} (order ${orderId})`
  );
};

/**
 * Returns the active tip route handler.
 */
export function getTipRouteHandler(): TipRouteHandler {
  return _tipRouteHandler;
}

/**
 * Replaces the tip route handler with a custom implementation.
 *
 * @param handler - Your async function that calls the Pi Platform server-to-user
 *   payment API.
 *
 * @example
 * ```ts
 * setTipRouteHandler(async (amountPi, wallet, orderId) => {
 *   await fetch("/api/tips/route", {
 *     method: "POST",
 *     body: JSON.stringify({ amountPi, wallet, orderId }),
 *   });
 * });
 * ```
 */
export function setTipRouteHandler(handler: TipRouteHandler): void {
  _tipRouteHandler = handler;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Basic Pi wallet address validation.
 * Pi wallet addresses are Stellar-compatible base32 public keys (G...) or
 * Pi UID strings.  Accepts both.
 */
function isValidWalletAddress(address: string): boolean {
  // Stellar G... public key: 56 chars, base32
  if (/^G[A-Z2-7]{55}$/.test(address)) return true;
  // Pi UID: non-empty alphanumeric string
  if (/^[a-zA-Z0-9_-]{8,64}$/.test(address)) return true;
  return false;
}
