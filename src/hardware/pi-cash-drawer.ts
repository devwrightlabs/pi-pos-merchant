/**
 * @fileoverview pi-cash-drawer — Sends a Bluetooth or network trigger to
 * kick open a physical RJ11 cash drawer attached to a thermal printer or
 * network interface.
 *
 * @module @devright/pi-pos-merchant/hardware
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import { handleHardwareFallback } from "../debug/pi-hardware-fallback.js";
import type { CashDrawerTrigger, HardwareDevice } from "../types/pos.js";

// ---------------------------------------------------------------------------
// ESC/POS cash drawer kick command
// ---------------------------------------------------------------------------

/** Standard ESC/POS drawer-kick pulse for pin 2 (most common). */
const CMD_DRAWER_KICK_PIN2 = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]);
/** Alternative pulse for pin 5 drawers. */
const CMD_DRAWER_KICK_PIN5 = new Uint8Array([0x1b, 0x70, 0x01, 0x19, 0xfa]);

/** Which RJ11 pin the cash drawer uses. */
export type DrawerPin = "pin2" | "pin5";

// ---------------------------------------------------------------------------
// BLE constants (Nordic UART Service — same as receipt printer)
// ---------------------------------------------------------------------------
const NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const NUS_TX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

// ---------------------------------------------------------------------------
// CashDrawer class
// ---------------------------------------------------------------------------

/**
 * Controls a physical cash drawer via Bluetooth ESC/POS or network TCP trigger.
 *
 * Most modern cash drawers are connected to a BLE receipt printer (which
 * passes through the ESC/POS kick command on its RJ11 port).  Network
 * drawers communicate via a simple HTTP endpoint or raw TCP socket.
 *
 * @example
 * ```ts
 * const drawer = new CashDrawer({ method: "bluetooth", targetAddress: "" });
 * await drawer.connect();
 * await drawer.open();
 * ```
 */
export class CashDrawer {
  private readonly trigger: CashDrawerTrigger;
  private btDevice: BluetoothDevice | null = null;
  private btTxChar: BluetoothRemoteGATTCharacteristic | null = null;
  public readonly hardwareDevice: HardwareDevice;

  constructor(trigger: CashDrawerTrigger) {
    this.trigger = trigger;
    this.hardwareDevice = {
      deviceId: trigger.targetAddress,
      deviceName: "Cash Drawer",
      type: "cash-drawer",
      status: "disconnected",
    };
  }

  /**
   * Connects to the cash drawer (Bluetooth path only).
   * Network-method drawers do not require a persistent connection.
   *
   * @throws If Bluetooth is unavailable or pairing fails.
   */
  async connect(): Promise<void> {
    if (this.trigger.method === "network") {
      // Network drawers are stateless — no persistent connection needed.
      (this.hardwareDevice as { status: string }).status = "connected";
      return;
    }

    if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
      piLog(
        "error",
        PI_ERROR_CODES.HW_BLUETOOTH_UNAVAILABLE,
        "Web Bluetooth unavailable for cash drawer."
      );
      (this.hardwareDevice as { status: string }).status = "error";
      throw new Error("Web Bluetooth API not available.");
    }

    (this.hardwareDevice as { status: string }).status = "connecting";

    try {
      this.btDevice = await navigator.bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE_UUID] }],
        optionalServices: [NUS_SERVICE_UUID],
      });

      const server = await this.btDevice.gatt!.connect();
      const service = await server.getPrimaryService(NUS_SERVICE_UUID);
      this.btTxChar = await service.getCharacteristic(NUS_TX_CHAR_UUID);

      (this.hardwareDevice as { deviceId: string }).deviceId = this.btDevice.id;
      (this.hardwareDevice as { deviceName: string }).deviceName =
        this.btDevice.name ?? "BLE Cash Drawer";
      (this.hardwareDevice as { status: string }).status = "connected";

      piLog(
        "info",
        PI_ERROR_CODES.HW_CASH_DRAWER_FAILED,
        `Cash drawer connected: ${this.hardwareDevice.deviceName}`
      );
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      (this.hardwareDevice as { status: string }).status = "error";
      (this.hardwareDevice as { errorMessage: string }).errorMessage = error.message;
      piLog(
        "error",
        PI_ERROR_CODES.HW_CASH_DRAWER_FAILED,
        `Cash drawer connect failed: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Sends the ESC/POS kick command to open the cash drawer.
   *
   * @param pin - Which RJ11 pin to use (defaults to `"pin2"`).
   * @throws If the trigger fails and there is no available fallback.
   */
  async open(pin: DrawerPin = "pin2"): Promise<void> {
    const cmd = pin === "pin2" ? CMD_DRAWER_KICK_PIN2 : CMD_DRAWER_KICK_PIN5;

    try {
      if (this.trigger.method === "bluetooth") {
        await this.openViaBluetooth(cmd);
      } else {
        await this.openViaNetwork(cmd);
      }

      piLog("info", PI_ERROR_CODES.HW_CASH_DRAWER_FAILED, `Cash drawer opened (${pin}).`);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      handleHardwareFallback("cash-drawer", error);
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async openViaBluetooth(cmd: Uint8Array): Promise<void> {
    if (!this.btTxChar) {
      throw new Error("Cash drawer BLE not connected. Call connect() first.");
    }
    await this.btTxChar.writeValueWithoutResponse(cmd.buffer as ArrayBuffer);
  }

  private async openViaNetwork(cmd: Uint8Array): Promise<void> {
    // Network cash drawers typically accept raw bytes via HTTP POST.
    const body = new Blob([cmd.buffer as ArrayBuffer], { type: "application/octet-stream" });
    const response = await fetch(this.trigger.targetAddress, {
      method: "POST",
      body,
    });

    if (!response.ok) {
      throw new Error(
        `Network cash drawer returned HTTP ${response.status}: ${response.statusText}`
      );
    }
  }

  /**
   * Disconnects the Bluetooth cash drawer adapter.
   */
  disconnect(): void {
    if (this.btDevice?.gatt?.connected) {
      this.btDevice.gatt.disconnect();
    }
    this.btDevice = null;
    this.btTxChar = null;
    (this.hardwareDevice as { status: string }).status = "disconnected";
    piLog("info", PI_ERROR_CODES.HW_CASH_DRAWER_FAILED, "Cash drawer disconnected.");
  }
}
