/**
 * @fileoverview pi-universal-logger — Intercepts webview crashes, SDK errors, and
 * Pi Browser anomalies, then outputs human-readable error codes and actionable
 * terminal hints to the developer console.
 *
 * @module @devright/pi-pos-merchant/debug
 */

import type { PiLogEntry } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Error code catalogue
// ---------------------------------------------------------------------------

/**
 * Human-readable error codes emitted by the universal logger.
 * Each code maps to a specific actionable hint for the developer.
 */
export const PI_ERROR_CODES = {
  // Generic info/status codes (used for non-error informational logging)
  SDK_INFO: "SDK_INFO",
  HW_INFO: "HW_INFO",
  OPS_INFO: "OPS_INFO",
  PAY_INFO: "PAY_INFO",

  // Pi SDK
  SDK_NOT_FOUND: "SDK_NOT_FOUND",
  SDK_AUTH_FAILED: "SDK_AUTH_FAILED",
  SDK_PAYMENT_CANCELLED: "SDK_PAYMENT_CANCELLED",
  SDK_INCOMPLETE_PAYMENT: "SDK_INCOMPLETE_PAYMENT",
  SDK_CALLBACK_ERROR: "SDK_CALLBACK_ERROR",

  // Hardware
  HW_BLUETOOTH_UNAVAILABLE: "HW_BLUETOOTH_UNAVAILABLE",
  HW_PRINTER_CONNECT_FAILED: "HW_PRINTER_CONNECT_FAILED",
  HW_CASH_DRAWER_FAILED: "HW_CASH_DRAWER_FAILED",
  HW_NFC_UNAVAILABLE: "HW_NFC_UNAVAILABLE",
  HW_NFC_READ_FAILED: "HW_NFC_READ_FAILED",
  HW_BLE_SCAN_FAILED: "HW_BLE_SCAN_FAILED",

  // Network / CORS
  NET_OFFLINE: "NET_OFFLINE",
  NET_CORS_BLOCKED: "NET_CORS_BLOCKED",
  NET_FETCH_FAILED: "NET_FETCH_FAILED",
  NET_SYNC_FAILED: "NET_SYNC_FAILED",

  // Cart / Memory
  CART_MEMORY_PRESSURE: "CART_MEMORY_PRESSURE",
  CART_OVERFLOW: "CART_OVERFLOW",

  // Operations
  OPS_SHIFT_NOT_OPEN: "OPS_SHIFT_NOT_OPEN",
  OPS_TAX_CALC_FAILED: "OPS_TAX_CALC_FAILED",
  OPS_FIAT_FETCH_FAILED: "OPS_FIAT_FETCH_FAILED",
  OPS_LOYALTY_ISSUE_FAILED: "OPS_LOYALTY_ISSUE_FAILED",
  OPS_TIP_ROUTE_FAILED: "OPS_TIP_ROUTE_FAILED",

  // React
  UI_RENDER_CRASH: "UI_RENDER_CRASH",
  UI_CONTEXT_MISSING: "UI_CONTEXT_MISSING",

  // Generic
  UNKNOWN: "UNKNOWN",
} as const;

/** Union type of all recognised Pi error codes. */
export type PiErrorCode = (typeof PI_ERROR_CODES)[keyof typeof PI_ERROR_CODES];

/** Mapping from error codes to developer-friendly hints. */
const CODE_HINTS: Record<PiErrorCode, string> = {
  // Generic info codes
  SDK_INFO: "Pi SDK informational event.",
  HW_INFO: "Hardware state change or informational event.",
  OPS_INFO: "Operational event — no action required.",
  PAY_INFO: "Payment lifecycle informational event.",
  // Pi SDK errors
  SDK_NOT_FOUND:
    "window.Pi is undefined. Ensure the app is opened inside Pi Browser and <script src='https://sdk.minepi.com/pi-sdk.js'> is loaded.",
  SDK_AUTH_FAILED:
    "Pi authentication failed. Check your API key in PosConfig.apiKey and confirm the app is approved in the developer portal.",
  SDK_PAYMENT_CANCELLED:
    "Payment was cancelled by the user. Safe to ignore — show a retry prompt.",
  SDK_INCOMPLETE_PAYMENT:
    "An incomplete payment was found. Call your server-side /payments/approve endpoint to resume it.",
  SDK_CALLBACK_ERROR:
    "An error occurred inside a Pi payment callback. Review the callback stack trace above.",
  HW_BLUETOOTH_UNAVAILABLE:
    "Web Bluetooth API is not available. Pi Browser on Android requires BT permissions; iOS is unsupported.",
  HW_PRINTER_CONNECT_FAILED:
    "Could not connect to receipt printer. Confirm the printer is powered on, in pairing mode, and within BLE range.",
  HW_CASH_DRAWER_FAILED:
    "Cash drawer trigger failed. Verify the drawer is connected (RJ11 cable or BLE adapter) and the target address is correct.",
  HW_NFC_UNAVAILABLE:
    "Web NFC API is not available. Requires Android + Chrome/Pi Browser with NFC permission granted.",
  HW_NFC_READ_FAILED:
    "NFC read timed out or returned invalid data. Ensure wristband is held flat within 4 cm of the NFC antenna.",
  HW_BLE_SCAN_FAILED:
    "BLE scan for inventory radar failed. Check location permission (required by Android for BLE scans).",
  NET_OFFLINE:
    "Device is offline. Sales are being queued locally and will sync when connectivity returns.",
  NET_CORS_BLOCKED:
    "A request was blocked by Pi Browser CORS policy. Use pi-cors-shield or proxy requests through your own server.",
  NET_FETCH_FAILED:
    "A network request failed. Check the URL and ensure your backend is reachable from the Pi Browser sandbox.",
  NET_SYNC_FAILED:
    "Offline queue sync failed. Sales remain queued — they will be retried automatically.",
  CART_MEMORY_PRESSURE:
    "High memory usage detected in cart. Consider paginating large inventories to avoid crashes on low-RAM devices.",
  CART_OVERFLOW:
    "Cart item limit reached. Reduce the number of unique items or increase memory-safe-cart maxItems.",
  OPS_SHIFT_NOT_OPEN:
    "No active shift found. Open a shift with piShiftAuth.openShift() before processing sales.",
  OPS_TAX_CALC_FAILED:
    "Tax calculation failed. Verify the taxRegion code is valid and supported by pi-tax-engine.",
  OPS_FIAT_FETCH_FAILED:
    "Fiat rate fetch failed. pi-fiat-peg will serve cached rates; ensure your oracle URL is reachable.",
  OPS_LOYALTY_ISSUE_FAILED:
    "Loyalty token issuance failed. The purchase was still processed — retry token issuance manually.",
  OPS_TIP_ROUTE_FAILED:
    "Tip routing failed. Verify PosConfig.tipWalletAddress is a valid Pi wallet address.",
  UI_RENDER_CRASH:
    "A React render error was caught by the Blank Screen Killer boundary. See the on-screen error panel for details.",
  UI_CONTEXT_MISSING:
    "usePos() was called outside a <PosProvider>. Wrap your app with <PosProvider config={...}>.",
  UNKNOWN:
    "An unrecognised error occurred. Enable debug mode in PosConfig and check the full stack trace.",
};

// ---------------------------------------------------------------------------
// Logger implementation
// ---------------------------------------------------------------------------

/** In-memory ring buffer of recent log entries (max 200). */
const LOG_BUFFER: PiLogEntry[] = [];
const MAX_BUFFER = 200;

/** External subscribers that receive log entries in real-time. */
type LogSubscriber = (entry: PiLogEntry) => void;
const subscribers: Set<LogSubscriber> = new Set();

/**
 * Subscribes to real-time log entries.
 * @param fn - Callback invoked for each new log entry.
 * @returns An unsubscribe function.
 */
export function subscribeLogs(fn: LogSubscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * Returns a snapshot of the current in-memory log buffer.
 */
export function getLogBuffer(): ReadonlyArray<PiLogEntry> {
  return [...LOG_BUFFER];
}

/**
 * Clears the in-memory log buffer.
 */
export function clearLogBuffer(): void {
  LOG_BUFFER.length = 0;
}

/**
 * Core logging function. Formats a structured {@link PiLogEntry}, pushes it to
 * the ring buffer, notifies subscribers, and writes to the developer console
 * with colour-coded output and actionable hints.
 *
 * @param level - Severity level.
 * @param code  - Machine-readable {@link PiErrorCode}.
 * @param message - Human-readable description of the event.
 * @param context - Optional additional key/value context.
 */
export function piLog(
  level: PiLogEntry["level"],
  code: PiErrorCode,
  message: string,
  context?: Record<string, unknown>
): PiLogEntry {
  const hint = CODE_HINTS[code] ?? CODE_HINTS.UNKNOWN;

  const entry: PiLogEntry = {
    level,
    code,
    message,
    hint,
    timestamp: Date.now(),
    ...(context !== undefined ? { context } : {}),
  };

  // Push to ring buffer, evicting oldest if full.
  if (LOG_BUFFER.length >= MAX_BUFFER) {
    LOG_BUFFER.shift();
  }
  LOG_BUFFER.push(entry);

  // Notify real-time subscribers.
  subscribers.forEach((fn) => fn(entry));

  // Write to developer console with colour-coded prefix.
  const prefix = `[pi-pos][${level.toUpperCase()}][${code}]`;
  const hintLine = `  ↳ HINT: ${hint}`;

  switch (level) {
    case "error":
      console.error(prefix, message, ...(context ? [context] : []), hintLine);
      break;
    case "warn":
      console.warn(prefix, message, ...(context ? [context] : []), hintLine);
      break;
    case "debug":
      console.debug(prefix, message, ...(context ? [context] : []), hintLine);
      break;
    default:
      console.info(prefix, message, ...(context ? [context] : []), hintLine);
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Global webview crash interceptor
// ---------------------------------------------------------------------------

/**
 * Installs a global `window.onerror` and `unhandledrejection` interceptor
 * that catches fatal webview crashes and routes them through `piLog`.
 *
 * Call once at app startup (inside `pi-pct-handshake` or `PosProvider`).
 */
export function installGlobalErrorInterceptor(): void {
  if (typeof window === "undefined") return;

  const prevOnError = window.onerror;

  window.onerror = (
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error
  ): boolean => {
    piLog("error", PI_ERROR_CODES.UNKNOWN, String(message), {
      source: source ?? "unknown",
      lineno: lineno ?? 0,
      colno: colno ?? 0,
      stack: error?.stack ?? "no stack",
    });

    if (typeof prevOnError === "function") {
      return prevOnError(message, source, lineno, colno, error) as boolean;
    }
    return false;
  };

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? (reason.stack ?? "") : "";

    piLog("error", PI_ERROR_CODES.UNKNOWN, `Unhandled Promise rejection: ${message}`, {
      stack,
    });
  });
}
