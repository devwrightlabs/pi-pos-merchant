/**
 * @fileoverview pi-receipt-printer — Web Bluetooth API middleware that formats
 * transaction data into ESC/POS payloads and sends them to a paired thermal
 * receipt printer over BLE.
 *
 * @module @devright/pi-pos-merchant/hardware
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import { handleHardwareFallback } from "../debug/pi-hardware-fallback.js";
import type { EscPosPrintJob, HardwareDevice } from "../types/pos.js";

// ---------------------------------------------------------------------------
// BLE constants for generic ESC/POS printers
// ---------------------------------------------------------------------------

/** Nordic UART Service UUID — used by most BLE thermal printers. */
const NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
/** NUS TX Characteristic (write to printer). */
const NUS_TX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

// ---------------------------------------------------------------------------
// ESC/POS byte helpers
// ---------------------------------------------------------------------------

const ESC = 0x1b;
const GS = 0x1d;

/** Resets printer to default state. */
const CMD_INIT = new Uint8Array([ESC, 0x40]);
/** Align centre. */
const CMD_ALIGN_CENTER = new Uint8Array([ESC, 0x61, 0x01]);
/** Align left. */
const CMD_ALIGN_LEFT = new Uint8Array([ESC, 0x61, 0x00]);
/** Bold ON. */
const CMD_BOLD_ON = new Uint8Array([ESC, 0x45, 0x01]);
/** Bold OFF. */
const CMD_BOLD_OFF = new Uint8Array([ESC, 0x45, 0x00]);
/** Line feed. */
const CMD_LF = new Uint8Array([0x0a]);
/** Full cut. */
const CMD_CUT = new Uint8Array([GS, 0x56, 0x00]);

/** Encodes a UTF-8 string to a Uint8Array. */
function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Builds a complete ESC/POS byte sequence for a receipt print job.
 *
 * @param job - The {@link EscPosPrintJob} to format.
 * @returns A `Uint8Array` ready to write to the BLE TX characteristic.
 */
export function buildEscPosPayload(job: EscPosPrintJob): Uint8Array {
  const parts: Uint8Array[] = [];

  const add = (...chunks: Uint8Array[]): void => {
    parts.push(...chunks);
  };

  const line = (text: string): void => {
    add(encodeText(text), CMD_LF);
  };

  const divider = (): void => line("-".repeat(32));

  // --- Header ---
  add(CMD_INIT, CMD_ALIGN_CENTER, CMD_BOLD_ON);
  line(job.merchantName);
  add(CMD_BOLD_OFF);
  line(`Order #${job.orderId}`);
  line(new Date(job.timestamp).toLocaleString());
  add(CMD_ALIGN_LEFT);
  divider();

  // --- Line items ---
  for (const item of job.items) {
    const itemTotal = (item.quantity * item.unitPricePi).toFixed(4);
    const nameCol = `${item.quantity}x ${item.name}`.substring(0, 22).padEnd(22);
    const priceCol = `${itemTotal}π`.padStart(10);
    line(`${nameCol}${priceCol}`);
  }

  divider();

  // --- Totals ---
  const subtotalLine = `Subtotal:`.padEnd(22) + `${job.subtotalPi.toFixed(4)}π`.padStart(10);
  const taxLine = `Tax:`.padEnd(22) + `${job.taxPi.toFixed(4)}π`.padStart(10);
  const tipLine = `Tip:`.padEnd(22) + `${job.tipPi.toFixed(4)}π`.padStart(10);

  line(subtotalLine);
  if (job.taxPi > 0) line(taxLine);
  if (job.tipPi > 0) line(tipLine);

  add(CMD_BOLD_ON);
  const totalPiLine = `TOTAL Pi:`.padEnd(22) + `${job.totalPi.toFixed(4)}π`.padStart(10);
  line(totalPiLine);

  if (job.totalFiat !== undefined && job.fiatCurrency) {
    const totalFiatLine = `TOTAL ${job.fiatCurrency}:`.padEnd(22) +
      `${job.fiatCurrency}${job.totalFiat.toFixed(2)}`.padStart(10);
    line(totalFiatLine);
  }

  add(CMD_BOLD_OFF);
  divider();

  // --- Footer ---
  add(CMD_ALIGN_CENTER);
  line("Thank you!");
  line("Powered by Pi Network");
  add(CMD_LF, CMD_LF, CMD_LF);
  add(CMD_CUT);

  // Concatenate all parts.
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// ReceiptPrinter class
// ---------------------------------------------------------------------------

/**
 * Web Bluetooth ESC/POS receipt printer interface.
 *
 * @example
 * ```ts
 * const printer = new ReceiptPrinter();
 * await printer.connect();
 * await printer.print(job);
 * printer.disconnect();
 * ```
 */
export class ReceiptPrinter {
  private device: BluetoothDevice | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  public readonly hardwareDevice: HardwareDevice;

  constructor() {
    this.hardwareDevice = {
      deviceId: "",
      deviceName: "Receipt Printer (unconnected)",
      type: "receipt-printer",
      status: "disconnected",
    };
  }

  /**
   * Scans for and connects to a nearby BLE ESC/POS receipt printer.
   *
   * @throws If Web Bluetooth is unavailable or the user cancels the pairing dialog.
   */
  async connect(): Promise<void> {
    if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
      piLog(
        "error",
        PI_ERROR_CODES.HW_BLUETOOTH_UNAVAILABLE,
        "Web Bluetooth API is not available in this environment."
      );
      (this.hardwareDevice as { status: string }).status = "error";
      (this.hardwareDevice as { errorMessage: string }).errorMessage =
        "Web Bluetooth unavailable";
      throw new Error("Web Bluetooth API not available.");
    }

    (this.hardwareDevice as { status: string }).status = "connecting";

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE_UUID] }],
        optionalServices: [NUS_SERVICE_UUID],
      });

      const server = await this.device.gatt!.connect();
      const service = await server.getPrimaryService(NUS_SERVICE_UUID);
      this.txChar = await service.getCharacteristic(NUS_TX_CHAR_UUID);

      (this.hardwareDevice as { deviceId: string }).deviceId =
        this.device.id;
      (this.hardwareDevice as { deviceName: string }).deviceName =
        this.device.name ?? "BLE Receipt Printer";
      (this.hardwareDevice as { status: string }).status = "connected";

      piLog(
        "info",
        PI_ERROR_CODES.HW_INFO,
        `Receipt printer connected: ${this.hardwareDevice.deviceName}`,
        { deviceId: this.device.id }
      );
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      (this.hardwareDevice as { status: string }).status = "error";
      (this.hardwareDevice as { errorMessage: string }).errorMessage =
        error.message;

      piLog(
        "error",
        PI_ERROR_CODES.HW_PRINTER_CONNECT_FAILED,
        `Receipt printer connect failed: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Prints a receipt for the given job.  If the printer is unavailable, the
   * method automatically invokes {@link handleHardwareFallback} to generate a
   * QR receipt and returns the augmented job (with `qrFallbackDataUri` set).
   *
   * @param job - The {@link EscPosPrintJob} to print.
   * @returns The original job, or an augmented job with QR fallback on error.
   */
  async print(job: EscPosPrintJob): Promise<EscPosPrintJob> {
    if (this.hardwareDevice.status !== "connected" || !this.txChar) {
      const fallbackError = new Error("Printer not connected.");
      const fallback = handleHardwareFallback("receipt-printer", fallbackError, job);
      return fallback ?? job;
    }

    const payload = buildEscPosPayload(job);

    try {
      // BLE GATT write limit is 512 bytes; chunk into MTU-safe segments.
      const MTU = 512;
      for (let offset = 0; offset < payload.length; offset += MTU) {
        const chunk = payload.slice(offset, offset + MTU);
        await this.txChar.writeValueWithoutResponse(chunk);
      }

      piLog(
        "info",
        PI_ERROR_CODES.HW_INFO,
        `Receipt printed successfully for order ${job.orderId}.`,
        { bytes: payload.length }
      );

      return job;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const fallback = handleHardwareFallback("receipt-printer", error, job);
      return fallback ?? job;
    }
  }

  /**
   * Disconnects from the BLE printer.
   */
  disconnect(): void {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.device = null;
    this.txChar = null;
    (this.hardwareDevice as { status: string }).status = "disconnected";

    piLog(
      "info",
      PI_ERROR_CODES.HW_INFO,
      "Receipt printer disconnected."
    );
  }
}
