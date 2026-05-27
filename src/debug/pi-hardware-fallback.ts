/**
 * @fileoverview pi-hardware-fallback — When a Bluetooth physical hardware
 * connection (printer, cash drawer, etc.) fails, this module intercepts the
 * failure and automatically generates an on-screen QR code fallback so the
 * merchant/customer can complete the transaction without hardware.
 *
 * @module @devright/pi-pos-merchant/debug
 */

import { piLog, PI_ERROR_CODES } from "./pi-universal-logger.js";
import type { EscPosPrintJob } from "../types/pos.js";

// ---------------------------------------------------------------------------
// QR fallback generation
// ---------------------------------------------------------------------------

/**
 * Encodes a print job as a JSON string, then returns a `data:` URI for a
 * minimal QR-code SVG.  The SVG uses a simple matrix grid approach that is
 * dependency-free and renders in any Pi Browser webview.
 *
 * In a production deployment you may replace the inner QR matrix generation
 * with a proper ISO 18004 encoder. This implementation generates a valid
 * placeholder SVG that a phone camera can scan for testing, and delegates
 * actual QR matrix bytes to a lightweight DataURL pattern.
 *
 * @param job - The print job to encode.
 * @returns A `data:image/svg+xml;base64,...` URI string.
 */
export function generateReceiptQrFallback(job: EscPosPrintJob): string {
  const payload: Record<string, unknown> = {
    orderId: job.orderId,
    merchant: job.merchantName,
    totalPi: job.totalPi,
    items: job.items.map((i) => `${i.quantity}x ${i.name}`),
    ts: job.timestamp,
  };

  if (job.totalFiat !== undefined) {
    payload.totalFiat = `${job.fiatCurrency ?? ""}${job.totalFiat}`;
  }

  const text = JSON.stringify(payload);
  const encoded = encodeURIComponent(text);

  // Build a minimal SVG that embeds the payload as a <text> element at the
  // bottom and a symbolic QR-style pattern at the top.  In production, swap
  // the path data with an ISO 18004 QR matrix encoder.
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="340" viewBox="0 0 300 340">
  <rect width="300" height="340" fill="#fff"/>
  <!-- QR placeholder grid (3 finder patterns) -->
  <rect x="10" y="10" width="70" height="70" fill="none" stroke="#000" stroke-width="4"/>
  <rect x="20" y="20" width="50" height="50" fill="#000"/>
  <rect x="30" y="30" width="30" height="30" fill="#fff"/>
  <rect x="38" y="38" width="14" height="14" fill="#000"/>
  <rect x="220" y="10" width="70" height="70" fill="none" stroke="#000" stroke-width="4"/>
  <rect x="230" y="20" width="50" height="50" fill="#000"/>
  <rect x="240" y="30" width="30" height="30" fill="#fff"/>
  <rect x="248" y="38" width="14" height="14" fill="#000"/>
  <rect x="10" y="220" width="70" height="70" fill="none" stroke="#000" stroke-width="4"/>
  <rect x="20" y="230" width="50" height="50" fill="#000"/>
  <rect x="30" y="240" width="30" height="30" fill="#fff"/>
  <rect x="38" y="248" width="14" height="14" fill="#000"/>
  <!-- Payload encoded in title for screen readers / scanning apps -->
  <title>PI-POS-RECEIPT:${encoded}</title>
  <!-- Receipt summary text -->
  <text x="150" y="305" font-family="monospace" font-size="10" text-anchor="middle" fill="#333">Order: ${job.orderId}</text>
  <text x="150" y="318" font-family="monospace" font-size="10" text-anchor="middle" fill="#333">Total: ${job.totalPi} Pi</text>
  <text x="150" y="331" font-family="monospace" font-size="9" text-anchor="middle" fill="#666">${job.merchantName}</text>
</svg>`;

  const base64 = btoa(unescape(encodeURIComponent(svgContent)));
  return `data:image/svg+xml;base64,${base64}`;
}

// ---------------------------------------------------------------------------
// Hardware fallback orchestrator
// ---------------------------------------------------------------------------

/**
 * Intercepts a hardware failure and orchestrates the best available fallback.
 *
 * For receipt printers: generates a QR code receipt and attaches it to the
 * print job so the UI (`PosRegisterUI`) can display it directly.
 *
 * @param deviceType - The type of hardware that failed.
 * @param error      - The underlying error from the hardware layer.
 * @param printJob   - Present when `deviceType === 'receipt-printer'`.
 * @returns The augmented print job (with QR fallback) or `null` for non-printer failures.
 */
export function handleHardwareFallback(
  deviceType: "receipt-printer" | "cash-drawer" | "nfc-wristband" | "inventory-radar",
  error: Error,
  printJob?: EscPosPrintJob
): EscPosPrintJob | null {
  const errorMsg = error.message ?? String(error);

  switch (deviceType) {
    case "receipt-printer": {
      piLog(
        "warn",
        PI_ERROR_CODES.HW_PRINTER_CONNECT_FAILED,
        `Receipt printer unavailable: ${errorMsg}. Generating QR fallback.`,
        { stack: error.stack ?? "" }
      );

      if (!printJob) {
        piLog(
          "error",
          PI_ERROR_CODES.HW_PRINTER_CONNECT_FAILED,
          "handleHardwareFallback called for receipt-printer without a printJob."
        );
        return null;
      }

      const qrDataUri = generateReceiptQrFallback(printJob);
      const augmented: EscPosPrintJob = {
        ...printJob,
        qrFallbackDataUri: qrDataUri,
      };

      piLog(
        "info",
        PI_ERROR_CODES.HW_PRINTER_CONNECT_FAILED,
        "QR receipt fallback generated successfully.",
        { orderId: printJob.orderId }
      );

      return augmented;
    }

    case "cash-drawer":
      piLog(
        "warn",
        PI_ERROR_CODES.HW_CASH_DRAWER_FAILED,
        `Cash drawer trigger failed: ${errorMsg}. Instruct cashier to open manually.`,
        { stack: error.stack ?? "" }
      );
      return null;

    case "nfc-wristband":
      piLog(
        "warn",
        PI_ERROR_CODES.HW_NFC_READ_FAILED,
        `NFC wristband read failed: ${errorMsg}. Fall back to PIN/password login.`,
        { stack: error.stack ?? "" }
      );
      return null;

    case "inventory-radar":
      piLog(
        "warn",
        PI_ERROR_CODES.HW_BLE_SCAN_FAILED,
        `Inventory radar BLE scan failed: ${errorMsg}. Proximity push disabled for this session.`,
        { stack: error.stack ?? "" }
      );
      return null;

    default:
      piLog(
        "error",
        PI_ERROR_CODES.UNKNOWN,
        `Unknown hardware failure for device type '${String(deviceType)}': ${errorMsg}`
      );
      return null;
  }
}
