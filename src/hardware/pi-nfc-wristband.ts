/**
 * @fileoverview pi-nfc-wristband — Fast-tap NFC employee authentication for
 * the Pi POS.  Employees tap their NFC wristband to instantly log in and
 * identify their role, replacing PIN-based logins on the POS terminal.
 *
 * Uses the Web NFC API (`NDEFReader`) available in Chromium-based browsers
 * with the NFC permission granted.
 *
 * @module @devright/pi-pos-merchant/hardware
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import { handleHardwareFallback } from "../debug/pi-hardware-fallback.js";
import type { NfcAuthPayload, EmployeeRole, HardwareDevice } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Web NFC type augmentation (not yet in lib.dom.d.ts in all environments)
// ---------------------------------------------------------------------------

interface NDEFRecord {
  readonly recordType: string;
  readonly data: DataView | null;
  readonly id: string;
  readonly mediaType: string;
  readonly encoding: string;
  readonly lang: string;
  toRecords?(): NDEFRecord[];
}

interface NDEFMessage {
  readonly records: NDEFRecord[];
}

interface NDEFReadingEvent extends Event {
  readonly message: NDEFMessage;
  readonly serialNumber: string;
}

interface NDEFReader extends EventTarget {
  onreading: ((event: NDEFReadingEvent) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
  scan(options?: { signal?: AbortSignal }): Promise<void>;
}

interface NDEFReaderConstructor {
  new (): NDEFReader;
}

declare global {
  interface Window {
    NDEFReader?: NDEFReaderConstructor;
  }
}

// ---------------------------------------------------------------------------
// Known wristband registry (in-memory; extend with a server call in production)
// ---------------------------------------------------------------------------

export interface WristbandRecord {
  readonly serial: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly role: EmployeeRole;
}

/** In-memory registry of enrolled wristbands. */
const wristbandRegistry = new Map<string, WristbandRecord>();

/**
 * Registers an NFC wristband serial number to an employee.
 *
 * @param record - The {@link WristbandRecord} to register.
 */
export function registerWristband(record: WristbandRecord): void {
  wristbandRegistry.set(record.serial, record);
  piLog(
    "info",
    PI_ERROR_CODES.HW_INFO,
    `Wristband registered for employee ${record.employeeName} (${record.role})`,
    { serial: record.serial }
  );
}

/**
 * Removes a wristband from the registry (e.g., on employee offboarding).
 *
 * @param serial - The wristband serial to remove.
 */
export function deregisterWristband(serial: string): void {
  wristbandRegistry.delete(serial);
}

// ---------------------------------------------------------------------------
// NfcWristbandReader class
// ---------------------------------------------------------------------------

/**
 * NFC wristband authentication reader.
 *
 * @example
 * ```ts
 * const reader = new NfcWristbandReader();
 * const unlisten = await reader.startListening((payload) => {
 *   console.log(`Employee ${payload.employeeId} authenticated as ${payload.role}`);
 * });
 * // Later...
 * unlisten();
 * ```
 */
export class NfcWristbandReader {
  private abortController: AbortController | null = null;
  public readonly hardwareDevice: HardwareDevice;

  constructor() {
    this.hardwareDevice = {
      deviceId: "nfc-builtin",
      deviceName: "NFC Reader",
      type: "nfc-wristband",
      status: "disconnected",
    };
  }

  /**
   * Starts listening for NFC wristband taps.
   * Calls `onAuth` with a validated {@link NfcAuthPayload} on each successful read.
   *
   * @param onAuth - Callback invoked when a known wristband is scanned.
   * @returns An async function that stops the listener when called.
   * @throws If Web NFC is unavailable or permission is denied.
   */
  async startListening(
    onAuth: (payload: NfcAuthPayload) => void
  ): Promise<() => void> {
    if (typeof window === "undefined" || !window.NDEFReader) {
      const err = new Error("Web NFC API (NDEFReader) is not available.");
      handleHardwareFallback("nfc-wristband", err);
      piLog("error", PI_ERROR_CODES.HW_NFC_UNAVAILABLE, err.message);
      throw err;
    }

    (this.hardwareDevice as { status: string }).status = "connecting";

    this.abortController = new AbortController();

    try {
      const reader = new window.NDEFReader();

      reader.onreading = (event: NDEFReadingEvent) => {
        this.handleNfcRead(event, onAuth);
      };

      reader.onreadingerror = (_event: Event) => {
        piLog(
          "error",
          PI_ERROR_CODES.HW_NFC_READ_FAILED,
          "NFC reading error — wristband may be damaged or too far from the reader."
        );
      };

      await reader.scan({ signal: this.abortController.signal });

      (this.hardwareDevice as { status: string }).status = "connected";
      piLog("info", PI_ERROR_CODES.HW_INFO, "NFC wristband reader active and listening.");

      return () => this.stopListening();
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      (this.hardwareDevice as { status: string }).status = "error";
      (this.hardwareDevice as { errorMessage: string }).errorMessage = error.message;

      handleHardwareFallback("nfc-wristband", error);
      throw error;
    }
  }

  /**
   * Stops the NFC listener.
   */
  stopListening(): void {
    this.abortController?.abort();
    this.abortController = null;
    (this.hardwareDevice as { status: string }).status = "disconnected";
    piLog("info", PI_ERROR_CODES.HW_INFO, "NFC wristband reader stopped.");
  }

  // -------------------------------------------------------------------------
  // Private handlers
  // -------------------------------------------------------------------------

  private handleNfcRead(
    event: NDEFReadingEvent,
    onAuth: (payload: NfcAuthPayload) => void
  ): void {
    const serial = event.serialNumber;

    const record = wristbandRegistry.get(serial);

    if (!record) {
      piLog(
        "warn",
        PI_ERROR_CODES.HW_NFC_READ_FAILED,
        `Unknown wristband scanned: ${serial}. Not registered in this POS.`,
        { serial }
      );
      return;
    }

    const payload: NfcAuthPayload = {
      employeeId: record.employeeId,
      role: record.role,
      wristbandSerial: serial,
      timestamp: Date.now(),
    };

    piLog(
      "info",
      PI_ERROR_CODES.HW_INFO,
      `Wristband auth: ${record.employeeName} (${record.role}) — tap confirmed.`,
      { employeeId: record.employeeId, serial }
    );

    try {
      onAuth(payload);
    } catch (callbackErr: unknown) {
      piLog(
        "error",
        PI_ERROR_CODES.HW_NFC_READ_FAILED,
        `NFC onAuth callback threw: ${(callbackErr as Error).message ?? String(callbackErr)}`
      );
    }
  }
}
