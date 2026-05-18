"use client";

/**
 * @fileoverview usePos — Custom React hook that exposes the complete 16-module
 * Pi POS suite to any component inside a {@link PosProvider}.
 *
 * @module @devright/pi-pos-merchant/react
 */

import { useMemo } from "react";
import { usePosContext } from "./PosProvider.js";
import { ReceiptPrinter } from "../hardware/pi-receipt-printer.js";
import { CashDrawer } from "../hardware/pi-cash-drawer.js";
import { NfcWristbandReader } from "../hardware/pi-nfc-wristband.js";
import { InventoryRadar } from "../hardware/pi-inventory-radar.js";
import { openShift, closeShift, validateShift, getActiveShifts } from "../operations/pi-shift-auth.js";
import { calculateTax, getTaxRegion, getAllTaxRegions, registerTaxRegion } from "../operations/pi-tax-engine.js";
import { routeTip, setTipRouteHandler } from "../operations/pi-tip-router.js";
import { FiatPeg } from "../operations/pi-fiat-peg.js";
import { issueLoyaltyToken, setLoyaltyIssuanceHandler } from "../operations/pi-loyalty-stamp.js";
import { getLogBuffer, clearLogBuffer, subscribeLogs } from "../debug/pi-universal-logger.js";
import { shieldedFetch, configureCorsShield, getCorsInterceptLog } from "../debug/pi-cors-shield.js";
import { handleHardwareFallback, generateReceiptQrFallback } from "../debug/pi-hardware-fallback.js";
import { bulkSyncOfflineQueue, enqueueOfflineSale, getOfflineQueue, watchConnectivity } from "../core/pi-offline-queue.js";
import type {
  CartState,
  PiAuthResult,
  Shift,
  FiatRateSnapshot,
  QueuedSale,
  PiLogEntry,
  PosContextValue,
} from "../types/pos.js";
import type { PosEngine } from "../core/PosEngine.js";

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

/** The complete suite exposed by `usePos()`. */
export interface UsePosReturn {
  // --- Core state ---
  /** The live computed cart state. */
  cart: CartState;
  /** The authenticated Pi user, or null before authentication. */
  auth: PiAuthResult | null;
  /** The currently active shift, or null. */
  activeShift: Shift | null;
  /** The most recent fiat rate snapshot, or null. */
  fiatRate: FiatRateSnapshot | null;
  /** Whether the device is currently online. */
  isOnline: boolean;
  /** Sales currently queued in the offline queue. */
  queuedSales: QueuedSale[];
  /** The raw POS engine instance. */
  engine: PosEngine;

  // --- Cart operations ---
  addToCart: PosEngine["addToCart"];
  removeFromCart: PosEngine["removeFromCart"];
  updateQuantity: PosEngine["updateQuantity"];
  clearCart: PosEngine["clearCart"];
  setTip: PosEngine["setTip"];
  setTaxRegion: PosEngine["setTaxRegion"];
  checkout: PosEngine["checkout"];

  // --- Hardware ---
  /** Creates a new receipt printer instance. */
  createReceiptPrinter: () => ReceiptPrinter;
  /** Creates a new cash drawer instance. */
  createCashDrawer: (trigger: { method: "bluetooth" | "network"; targetAddress: string }) => CashDrawer;
  /** Creates a new NFC wristband reader instance. */
  createNfcReader: () => NfcWristbandReader;
  /** Creates a new inventory radar instance. */
  createInventoryRadar: (config: { menuUrl: string; rssiThreshold?: number }) => InventoryRadar;

  // --- Operations ---
  openShift: typeof openShift;
  closeShift: typeof closeShift;
  validateShift: typeof validateShift;
  getActiveShifts: typeof getActiveShifts;
  calculateTax: typeof calculateTax;
  getTaxRegion: typeof getTaxRegion;
  getAllTaxRegions: typeof getAllTaxRegions;
  registerTaxRegion: typeof registerTaxRegion;
  routeTip: typeof routeTip;
  setTipRouteHandler: typeof setTipRouteHandler;
  createFiatPeg: (config: { currency: string; symbol: string; oracleUrl?: string }) => FiatPeg;
  issueLoyaltyToken: typeof issueLoyaltyToken;
  setLoyaltyIssuanceHandler: typeof setLoyaltyIssuanceHandler;

  // --- Debug ---
  logs: PiLogEntry[];
  getLogBuffer: typeof getLogBuffer;
  clearLogBuffer: typeof clearLogBuffer;
  subscribeLogs: typeof subscribeLogs;
  shieldedFetch: typeof shieldedFetch;
  configureCorsShield: typeof configureCorsShield;
  getCorsInterceptLog: typeof getCorsInterceptLog;
  handleHardwareFallback: typeof handleHardwareFallback;
  generateReceiptQrFallback: typeof generateReceiptQrFallback;

  // --- Offline queue ---
  enqueueOfflineSale: typeof enqueueOfflineSale;
  getOfflineQueue: typeof getOfflineQueue;
  bulkSyncOfflineQueue: typeof bulkSyncOfflineQueue;
  watchConnectivity: typeof watchConnectivity;

  // --- Context ---
  _ctx: PosContextValue;
}

// ---------------------------------------------------------------------------
// usePos hook
// ---------------------------------------------------------------------------

/**
 * Exposes the complete Pi POS module suite to any React component.
 *
 * Must be called inside a `<PosProvider>`.
 *
 * @returns A {@link UsePosReturn} object containing the full POS API.
 *
 * @example
 * ```tsx
 * function Checkout() {
 *   const { cart, checkout, engine } = usePos();
 *   return <button onClick={() => checkout("order_1", "merchant_1")}>Pay {cart.totalPi} Pi</button>;
 * }
 * ```
 */
export function usePos(): UsePosReturn {
  const ctx = usePosContext();
  const { engine } = ctx;

  return useMemo<UsePosReturn>(
    () => ({
      // --- Core state ---
      cart: ctx.cart,
      auth: ctx.auth,
      activeShift: ctx.activeShift,
      fiatRate: ctx.fiatRate,
      isOnline: ctx.isOnline,
      queuedSales: ctx.queuedSales,
      engine,

      // --- Cart operations (bound to engine) ---
      addToCart: engine.addToCart.bind(engine),
      removeFromCart: engine.removeFromCart.bind(engine),
      updateQuantity: engine.updateQuantity.bind(engine),
      clearCart: engine.clearCart.bind(engine),
      setTip: engine.setTip.bind(engine),
      setTaxRegion: engine.setTaxRegion.bind(engine),
      checkout: engine.checkout.bind(engine),

      // --- Hardware factories ---
      createReceiptPrinter: () => new ReceiptPrinter(),
      createCashDrawer: (trigger) => new CashDrawer(trigger),
      createNfcReader: () => new NfcWristbandReader(),
      createInventoryRadar: (cfg) => new InventoryRadar({
        menuUrl: cfg.menuUrl,
        ...(cfg.rssiThreshold !== undefined ? { rssiThreshold: cfg.rssiThreshold } : {}),
      }),

      // --- Operations ---
      openShift,
      closeShift,
      validateShift,
      getActiveShifts,
      calculateTax,
      getTaxRegion,
      getAllTaxRegions,
      registerTaxRegion,
      routeTip,
      setTipRouteHandler,
      createFiatPeg: (cfg) => new FiatPeg(cfg),
      issueLoyaltyToken,
      setLoyaltyIssuanceHandler,

      // --- Debug ---
      logs: ctx.logs,
      getLogBuffer,
      clearLogBuffer,
      subscribeLogs,
      shieldedFetch,
      configureCorsShield,
      getCorsInterceptLog,
      handleHardwareFallback,
      generateReceiptQrFallback,

      // --- Offline queue ---
      enqueueOfflineSale,
      getOfflineQueue,
      bulkSyncOfflineQueue,
      watchConnectivity,

      // --- Context (for advanced use) ---
      _ctx: ctx,
    }),
    // Re-compute when the engine, cart, auth, or derived state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, engine]
  );
}
