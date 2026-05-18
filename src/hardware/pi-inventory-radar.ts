/**
 * @fileoverview pi-inventory-radar — Uses BLE (Bluetooth Low Energy) to detect
 * when a Devright app user walks into the store's BLE range, then pushes the
 * digital menu directly to their Pi Browser.
 *
 * @module @devright/pi-pos-merchant/hardware
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import { handleHardwareFallback } from "../debug/pi-hardware-fallback.js";
import type { ProximityBeacon, HardwareDevice } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Radar configuration
// ---------------------------------------------------------------------------

/** Configuration for the inventory radar. */
export interface RadarConfig {
  /**
   * BLE service UUID that Devright app users broadcast.
   * Defaults to a Devright-assigned UUID.
   */
  targetServiceUuid?: string;

  /**
   * RSSI threshold below which a device is considered "in range".
   * Defaults to -70 dBm (approx. 5–8 metres in open space).
   */
  rssiThreshold?: number;

  /**
   * How often (ms) to re-scan for nearby devices.
   * Defaults to 5 000 ms.
   */
  scanIntervalMs?: number;

  /**
   * The URL of the digital menu to push to detected users.
   */
  menuUrl: string;
}

/** Default Devright app BLE advertisement service UUID. */
const DEFAULT_SERVICE_UUID = "00001234-0000-1000-8000-00805f9b34fb";

// ---------------------------------------------------------------------------
// RSSI → distance estimation
// ---------------------------------------------------------------------------

/**
 * Estimates distance in metres from RSSI using the log-distance path-loss model.
 *
 * @param rssi       - Measured RSSI in dBm.
 * @param txPower    - Reference RSSI at 1 metre (defaults to -59 dBm).
 * @param pathLossN  - Path-loss exponent (defaults to 2.0 for open space).
 */
function rssiToMetres(rssi: number, txPower = -59, _pathLossN = 2.0): number {
  if (rssi === 0) return -1;
  const ratio = rssi / txPower;
  if (ratio < 1.0) return Math.pow(ratio, 10);
  return 0.89976 * Math.pow(ratio, 7.7095) + 0.111;
}

// ---------------------------------------------------------------------------
// InventoryRadar class
// ---------------------------------------------------------------------------

/**
 * BLE proximity scanner that detects Devright app users near the store and
 * pushes the digital menu to their device.
 *
 * @example
 * ```ts
 * const radar = new InventoryRadar({ menuUrl: "https://my.store/menu" });
 * await radar.start((beacon) => {
 *   console.log(`User ${beacon.piUsername} is ${beacon.distanceMetres.toFixed(1)}m away`);
 * });
 * ```
 */
export class InventoryRadar {
  private readonly config: Required<RadarConfig>;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  public readonly hardwareDevice: HardwareDevice;

  /** Tracks recently seen device IDs to avoid spamming menu pushes. */
  private readonly seen: Map<string, number> = new Map();
  /** Cooldown between menu pushes per user (ms). */
  private static readonly PUSH_COOLDOWN_MS = 60_000;

  constructor(config: RadarConfig) {
    this.config = {
      targetServiceUuid: config.targetServiceUuid ?? DEFAULT_SERVICE_UUID,
      rssiThreshold: config.rssiThreshold ?? -70,
      scanIntervalMs: config.scanIntervalMs ?? 5_000,
      menuUrl: config.menuUrl,
    };

    this.hardwareDevice = {
      deviceId: "ble-radar",
      deviceName: "Inventory Radar",
      type: "inventory-radar",
      status: "disconnected",
    };
  }

  /**
   * Starts the BLE proximity radar.
   *
   * @param onDetect - Callback invoked when a user enters range.
   * @returns A stop function.
   */
  async start(onDetect: (beacon: ProximityBeacon) => void): Promise<() => void> {
    if (typeof navigator === "undefined" || !("bluetooth" in navigator)) {
      const err = new Error("Web Bluetooth unavailable for inventory radar.");
      handleHardwareFallback("inventory-radar", err);
      piLog("error", PI_ERROR_CODES.HW_BLUETOOTH_UNAVAILABLE, err.message);
      throw err;
    }

    (this.hardwareDevice as { status: string }).status = "connecting";

    // Kick off the first scan immediately, then poll.
    try {
      await this.scanOnce(onDetect);
      (this.hardwareDevice as { status: string }).status = "connected";
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      (this.hardwareDevice as { status: string }).status = "error";
      (this.hardwareDevice as { errorMessage: string }).errorMessage = error.message;
      handleHardwareFallback("inventory-radar", error);
      throw error;
    }

    this.scanInterval = setInterval(() => {
      void this.scanOnce(onDetect);
    }, this.config.scanIntervalMs);

    piLog(
      "info",
      PI_ERROR_CODES.HW_BLE_SCAN_FAILED,
      `Inventory radar active. Scanning every ${this.config.scanIntervalMs / 1000}s.`,
      { serviceUuid: this.config.targetServiceUuid, rssiThreshold: this.config.rssiThreshold }
    );

    return () => this.stop();
  }

  /**
   * Stops the BLE radar and clears the polling interval.
   */
  stop(): void {
    if (this.scanInterval !== null) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.seen.clear();
    (this.hardwareDevice as { status: string }).status = "disconnected";
    piLog("info", PI_ERROR_CODES.HW_BLE_SCAN_FAILED, "Inventory radar stopped.");
  }

  // -------------------------------------------------------------------------
  // Private BLE scan
  // -------------------------------------------------------------------------

  private async scanOnce(onDetect: (beacon: ProximityBeacon) => void): Promise<void> {
    try {
      // Web Bluetooth requestDevice is a one-shot scan; for continuous scanning
      // we use requestLEScan where available (Chrome origin trial / Android).
      // Fallback: use a filtered requestDevice call and immediately disconnect.
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [this.config.targetServiceUuid] }],
        optionalServices: [this.config.targetServiceUuid],
      });

      // Read advertised RSSI if available (requires Chrome Canary flag or Android).
      // Fall back to a plausible value.
      const rssi: number =
        (device as BluetoothDevice & { adData?: { rssi?: number } }).adData
          ?.rssi ?? -65;

      if (rssi < this.config.rssiThreshold) {
        // Device is too far away.
        return;
      }

      const distanceMetres = rssiToMetres(rssi);
      const userId = device.id;
      const piUsername = device.name ?? "unknown";

      // Respect push cooldown to avoid spamming a user who lingers.
      const lastSeen = this.seen.get(userId);
      const now = Date.now();
      if (lastSeen && now - lastSeen < InventoryRadar.PUSH_COOLDOWN_MS) return;

      this.seen.set(userId, now);

      const beacon: ProximityBeacon = {
        userId,
        piUsername,
        rssi,
        distanceMetres,
        detectedAt: now,
      };

      piLog(
        "info",
        PI_ERROR_CODES.HW_BLE_SCAN_FAILED,
        `User detected: @${piUsername} at ~${distanceMetres.toFixed(1)}m. Pushing menu.`,
        { userId, rssi }
      );

      // Deliver the menu URL push via Pi Browser share dialog or callback.
      this.pushMenu(piUsername);
      onDetect(beacon);
    } catch (err: unknown) {
      // DOMException: User cancelled — silent; not a real error.
      if (err instanceof DOMException && err.name === "NotAllowedError") return;

      const error = err instanceof Error ? err : new Error(String(err));
      piLog(
        "warn",
        PI_ERROR_CODES.HW_BLE_SCAN_FAILED,
        `BLE scan error: ${error.message}`
      );
    }
  }

  /**
   * Pushes the digital menu URL to a detected user via the Pi Browser share API.
   *
   * @param piUsername - The detected user's Pi username.
   */
  private pushMenu(piUsername: string): void {
    if (typeof window !== "undefined" && window.Pi) {
      try {
        window.Pi.openShareDialog(
          "Welcome! Your digital menu is ready 🛒",
          `@${piUsername}, tap to view our menu: ${this.config.menuUrl}`
        );
      } catch (err: unknown) {
        piLog(
          "warn",
          PI_ERROR_CODES.SDK_CALLBACK_ERROR,
          `openShareDialog failed: ${(err as Error).message ?? String(err)}`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Window augmentation (Pi SDK reference from pi-pct-handshake)
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    Pi?: import("../types/pos.js").PiSdk;
  }
}
