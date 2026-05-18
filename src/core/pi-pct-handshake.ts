/**
 * @fileoverview pi-pct-handshake — The official Pi Core Team (PCT) initialization
 * wrapper.  Strictly enforces the PCT authentication flow for `window.Pi`,
 * catching and logging all standard SDK failures via pi-universal-logger.
 *
 * @module @devright/pi-pos-merchant/core
 */

import { piLog, PI_ERROR_CODES, installGlobalErrorInterceptor } from "../debug/pi-universal-logger.js";
import type {
  PiSdk,
  PiAuthResult,
  PiAuthScope,
  PiPaymentDto,
  PosConfig,
} from "../types/pos.js";

// ---------------------------------------------------------------------------
// Window augmentation
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    /** The Pi SDK global injected by the Pi Browser webview. */
    Pi?: PiSdk;
  }
}

// ---------------------------------------------------------------------------
// Handshake result
// ---------------------------------------------------------------------------

/** Result returned by {@link initPiHandshake}. */
export interface HandshakeResult {
  /** Whether the handshake completed successfully. */
  success: boolean;
  /** The authenticated user info (present on success). */
  auth: PiAuthResult | null;
  /** The validated Pi SDK reference (present on success). */
  sdk: PiSdk | null;
  /** Error message (present on failure). */
  error?: string;
}

// ---------------------------------------------------------------------------
// Default scopes required by the POS
// ---------------------------------------------------------------------------

const DEFAULT_SCOPES: PiAuthScope[] = ["username", "payments", "wallet_address"];

// ---------------------------------------------------------------------------
// Core handshake
// ---------------------------------------------------------------------------

/**
 * Initialises the Pi SDK and authenticates the user via the PCT-approved flow.
 *
 * Steps:
 * 1. Validates that `window.Pi` is present (Pi Browser guard).
 * 2. Calls `window.Pi.authenticate()` with the required scopes.
 * 3. Handles any `onIncompletePaymentFound` callback per PCT guidelines.
 * 4. Installs the global webview crash interceptor.
 * 5. Logs all outcomes via pi-universal-logger.
 *
 * @param config   - The merchant {@link PosConfig}.
 * @param scopes   - Override the default auth scopes if needed.
 * @param onIncompletePayment - Optional handler for incomplete payment recovery.
 * @returns A {@link HandshakeResult} indicating success or failure.
 *
 * @example
 * ```ts
 * const result = await initPiHandshake(config);
 * if (!result.success) {
 *   console.error("Pi SDK init failed:", result.error);
 * }
 * ```
 */
export async function initPiHandshake(
  config: PosConfig,
  scopes: PiAuthScope[] = DEFAULT_SCOPES,
  onIncompletePayment?: (payment: PiPaymentDto) => void
): Promise<HandshakeResult> {
  // Step 1 — Install global crash interceptor early.
  installGlobalErrorInterceptor();

  // Step 2 — Guard: ensure window.Pi exists.
  if (typeof window === "undefined" || !window.Pi) {
    piLog(
      "error",
      PI_ERROR_CODES.SDK_NOT_FOUND,
      "window.Pi is not defined. Ensure the app runs inside Pi Browser.",
      { sandbox: config.sandbox ?? false }
    );
    return { success: false, auth: null, sdk: null, error: "window.Pi not found" };
  }

  const sdk: PiSdk = window.Pi;

  piLog("info", PI_ERROR_CODES.SDK_NOT_FOUND, "Pi SDK detected. Starting PCT handshake…", {
    sandbox: config.sandbox ?? false,
    scopes,
  });

  // Step 3 — Authenticate.
  try {
    const auth = await sdk.authenticate(
      scopes,
      // PCT-required: handle incomplete payments from a previous session.
      (payment: PiPaymentDto) => {
        piLog(
          "warn",
          PI_ERROR_CODES.SDK_INCOMPLETE_PAYMENT,
          `Incomplete payment found: ${payment.identifier}. Dispatching recovery handler.`,
          {
            paymentId: payment.identifier,
            amount: payment.amount,
            status: payment.status,
          }
        );

        if (onIncompletePayment) {
          try {
            onIncompletePayment(payment);
          } catch (callbackError: unknown) {
            piLog(
              "error",
              PI_ERROR_CODES.SDK_CALLBACK_ERROR,
              `onIncompletePayment callback threw: ${(callbackError as Error).message ?? String(callbackError)}`
            );
          }
        } else {
          piLog(
            "warn",
            PI_ERROR_CODES.SDK_INCOMPLETE_PAYMENT,
            "No onIncompletePayment handler provided. Provide one to comply with PCT guidelines."
          );
        }
      }
    );

    piLog("info", PI_ERROR_CODES.SDK_AUTH_FAILED, `PCT handshake complete. User: @${auth.user.username}`, {
      uid: auth.user.uid,
      hasWallet: !!auth.user.walletAddress,
    });

    return { success: true, auth, sdk };
  } catch (authError: unknown) {
    const message = (authError as Error).message ?? String(authError);
    const stack = authError instanceof Error ? (authError.stack ?? "") : "";

    piLog("error", PI_ERROR_CODES.SDK_AUTH_FAILED, `PCT handshake failed: ${message}`, {
      stack,
      apiKey: config.apiKey.slice(0, 6) + "…", // Never log full API key.
    });

    return {
      success: false,
      auth: null,
      sdk: null,
      error: message,
    };
  }
}
