/**
 * @fileoverview @devright/pi-pos-merchant — Main entry point.
 *
 * Exports all 16 modules, types, hooks, and React components.
 *
 * @module @devright/pi-pos-merchant
 */

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------
export { PosEngine } from "./core/PosEngine.js";
export type { CheckoutResult } from "./core/PosEngine.js";

export { initPiHandshake } from "./core/pi-pct-handshake.js";
export type { HandshakeResult } from "./core/pi-pct-handshake.js";

export {
  enqueueOfflineSale,
  dequeueOfflineSale,
  getOfflineQueue,
  bulkSyncOfflineQueue,
  watchConnectivity,
} from "./core/pi-offline-queue.js";
export type { SyncSaleHandler } from "./core/pi-offline-queue.js";

export { MemorySafeCart } from "./core/pi-memory-safe-cart.js";
export type { MemorySafeCartConfig } from "./core/pi-memory-safe-cart.js";

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------
export {
  piLog,
  subscribeLogs,
  getLogBuffer,
  clearLogBuffer,
  installGlobalErrorInterceptor,
  PI_ERROR_CODES,
} from "./debug/pi-universal-logger.js";
export type { PiErrorCode } from "./debug/pi-universal-logger.js";

export {
  shieldedFetch,
  configureCorsShield,
  getCorsInterceptLog,
} from "./debug/pi-cors-shield.js";
export type { CorsShieldConfig } from "./debug/pi-cors-shield.js";

export {
  handleHardwareFallback,
  generateReceiptQrFallback,
} from "./debug/pi-hardware-fallback.js";

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------
export { ReceiptPrinter, buildEscPosPayload } from "./hardware/pi-receipt-printer.js";

export { CashDrawer } from "./hardware/pi-cash-drawer.js";
export type { DrawerPin } from "./hardware/pi-cash-drawer.js";

export {
  NfcWristbandReader,
  registerWristband,
  deregisterWristband,
} from "./hardware/pi-nfc-wristband.js";
export type { WristbandRecord } from "./hardware/pi-nfc-wristband.js";

export { InventoryRadar } from "./hardware/pi-inventory-radar.js";
export type { RadarConfig } from "./hardware/pi-inventory-radar.js";

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export {
  openShift,
  closeShift,
  validateShift,
  getActiveShifts,
} from "./operations/pi-shift-auth.js";

export {
  calculateTax,
  getTaxRegion,
  getAllTaxRegions,
  registerTaxRegion,
} from "./operations/pi-tax-engine.js";

export {
  routeTip,
  setTipRouteHandler,
  getTipRouteHandler,
} from "./operations/pi-tip-router.js";
export type { TipRoutingResult, TipRouteHandler } from "./operations/pi-tip-router.js";

export { FiatPeg } from "./operations/pi-fiat-peg.js";
export type { FiatPegConfig } from "./operations/pi-fiat-peg.js";

export {
  issueLoyaltyToken,
  setLoyaltyIssuanceHandler,
  getLoyaltyIssuanceHandler,
} from "./operations/pi-loyalty-stamp.js";
export type {
  LoyaltyIssuanceParams,
  LoyaltyIssuanceHandler,
} from "./operations/pi-loyalty-stamp.js";

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------
export { PosProvider, usePosContext } from "./react/PosProvider.js";
export type { PosProviderProps } from "./react/PosProvider.js";

export { usePos } from "./react/usePos.js";
export type { UsePosReturn } from "./react/usePos.js";

export { PosRegisterUI } from "./react/PosRegisterUI.js";
export type { PosRegisterUIProps } from "./react/PosRegisterUI.js";

// ---------------------------------------------------------------------------
// Types (re-exported for consumer convenience)
// ---------------------------------------------------------------------------
export type {
  // Pi SDK
  PiSdk,
  PiAuthResult,
  PiUser,
  PiAuthScope,
  PiPaymentRequest,
  PiPaymentMetadata,
  PiPaymentDto,
  PiPaymentStatus,
  PiPaymentCallbacks,
  PiTransactionRecord,
  CartItemSnapshot,
  // Cart
  Product,
  CartItem,
  CartState,
  // Hardware
  HardwareDevice,
  HardwareDeviceType,
  HardwareStatus,
  EscPosPrintJob,
  CashDrawerTrigger,
  NfcAuthPayload,
  EmployeeRole,
  ProximityBeacon,
  // Offline queue
  QueuedSale,
  // Shift
  Shift,
  // Tax
  TaxRegion,
  TaxCalculation,
  // Fiat
  FiatRateSnapshot,
  // Loyalty
  LoyaltyToken,
  // Config
  PosConfig,
  // Debug
  PiLogEntry,
  CorsIntercept,
  // Context
  PosContextValue,
} from "./types/pos.js";
