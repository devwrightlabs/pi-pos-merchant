/**
 * @fileoverview Exhaustive PCT-compliant TypeScript interfaces for @devright/pi-pos-merchant.
 * Zero `any` types. All payloads align with Pi Core Team (PCT) SDK v2 specifications.
 */

// ---------------------------------------------------------------------------
// Pi Network SDK types (window.Pi contract)
// ---------------------------------------------------------------------------

/** Scopes the merchant app is allowed to request from the Pi SDK. */
export type PiAuthScope =
  | "username"
  | "payments"
  | "wallet_address"
  | "platform";

/** Authentication result returned by window.Pi.authenticate(). */
export interface PiAuthResult {
  /** The user's Pi username. */
  readonly user: PiUser;
  /** Short-lived JWT credential used for server-side verification. */
  readonly accessToken: string;
}

/** A Pi Network user record. */
export interface PiUser {
  readonly uid: string;
  readonly username: string;
  /** Present only when wallet_address scope was granted. */
  readonly walletAddress?: string;
}

/** Payment creation request payload sent to window.Pi.createPayment(). */
export interface PiPaymentRequest {
  /** Amount in Pi (must be > 0). */
  readonly amount: number;
  /** Human-readable memo visible in the Pi Wallet. */
  readonly memo: string;
  /** Developer-defined metadata passed through the lifecycle callbacks. */
  readonly metadata: PiPaymentMetadata;
}

/** Free-form metadata attached to a Pi payment. */
export interface PiPaymentMetadata {
  readonly orderId: string;
  readonly merchantId: string;
  readonly items: ReadonlyArray<CartItemSnapshot>;
  /** Unix timestamp (ms) when the order was created. */
  readonly createdAt: number;
  /** Optional tip amount in Pi. */
  readonly tipAmount?: number;
  /** Optional loyalty token issued for this purchase. */
  readonly loyaltyToken?: string;
  /** ISO 3166-1 alpha-2 country code used for tax calculation. */
  readonly taxRegion?: string;
}

/** Snapshot of a cart item stored inside payment metadata. */
export interface CartItemSnapshot {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitPricePi: number;
  readonly category?: string;
}

/** Full Pi payment lifecycle DTO returned through SDK callbacks. */
export interface PiPaymentDto {
  readonly identifier: string;
  readonly user_uid: string;
  readonly amount: number;
  readonly memo: string;
  readonly metadata: PiPaymentMetadata;
  readonly from_address: string;
  readonly to_address: string;
  readonly direction: "user_to_app" | "app_to_user";
  readonly created_at: string;
  readonly network: "Pi Network" | "Pi Testnet";
  readonly status: PiPaymentStatus;
  readonly transaction: PiTransactionRecord | null;
}

/** Payment status union derived from the Pi SDK lifecycle. */
export interface PiPaymentStatus {
  readonly developer_approved: boolean;
  readonly transaction_verified: boolean;
  readonly developer_completed: boolean;
  readonly cancelled: boolean;
  readonly user_cancelled: boolean;
}

/** On-chain transaction record linked to a payment. */
export interface PiTransactionRecord {
  readonly txid: string;
  readonly verified: boolean;
  readonly _link: string;
}

/** Callbacks provided to window.Pi.createPayment(). */
export interface PiPaymentCallbacks {
  onReadyForServerApproval: (paymentId: string) => void;
  onReadyForServerCompletion: (paymentId: string, txid: string) => void;
  onCancel: (paymentId: string) => void;
  onError: (error: Error, payment: PiPaymentDto | null) => void;
}

/** Shape of the global window.Pi SDK object. */
export interface PiSdk {
  authenticate(
    scopes: PiAuthScope[],
    onIncompletePaymentFound: (payment: PiPaymentDto) => void
  ): Promise<PiAuthResult>;
  createPayment(
    paymentData: PiPaymentRequest,
    callbacks: PiPaymentCallbacks
  ): void;
  openShareDialog(title: string, message: string): void;
}

// ---------------------------------------------------------------------------
// Cart state
// ---------------------------------------------------------------------------

/** A single product available in the POS inventory. */
export interface Product {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Price in Pi. */
  readonly pricePi: number;
  /** Optional fiat price (used by pi-fiat-peg for display only). */
  readonly priceFiat?: number;
  readonly category: string;
  readonly imageUrl?: string;
  /** Whether the product is available (e.g. in stock). */
  readonly available: boolean;
}

/** A cart line item (product + quantity). */
export interface CartItem {
  readonly product: Product;
  quantity: number;
}

/** The full, computed cart state managed by PosEngine. */
export interface CartState {
  readonly items: CartItem[];
  readonly subtotalPi: number;
  readonly taxPi: number;
  readonly tipPi: number;
  readonly totalPi: number;
  readonly appliedTaxRegion: string | null;
  readonly loyaltyTokens: string[];
}

// ---------------------------------------------------------------------------
// Hardware connection state
// ---------------------------------------------------------------------------

/** Status of a Web Bluetooth or network hardware device. */
export type HardwareStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** Represents the state of any physical hardware device. */
export interface HardwareDevice {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly type: HardwareDeviceType;
  status: HardwareStatus;
  /** Error message if status === 'error'. */
  errorMessage?: string;
}

/** All supported hardware device types. */
export type HardwareDeviceType =
  | "receipt-printer"
  | "cash-drawer"
  | "nfc-wristband"
  | "inventory-radar";

/** ESC/POS print job payload. */
export interface EscPosPrintJob {
  readonly orderId: string;
  readonly merchantName: string;
  readonly items: ReadonlyArray<CartItemSnapshot>;
  readonly subtotalPi: number;
  readonly taxPi: number;
  readonly tipPi: number;
  readonly totalPi: number;
  readonly totalFiat?: number;
  readonly fiatCurrency?: string;
  readonly timestamp: number;
  /** UTF-8 QR code fallback data URI when printer is unavailable. */
  readonly qrFallbackDataUri?: string;
}

/** Cash drawer trigger command. */
export interface CashDrawerTrigger {
  readonly method: "bluetooth" | "network";
  readonly targetAddress: string;
}

/** NFC wristband authentication payload. */
export interface NfcAuthPayload {
  readonly employeeId: string;
  readonly role: EmployeeRole;
  readonly wristbandSerial: string;
  readonly timestamp: number;
}

/** Employee roles for shift-based access control. */
export type EmployeeRole = "owner" | "manager" | "cashier" | "viewer";

/** BLE proximity beacon from pi-inventory-radar. */
export interface ProximityBeacon {
  readonly userId: string;
  readonly piUsername: string;
  readonly rssi: number;
  /** Estimated distance in metres. */
  readonly distanceMetres: number;
  readonly detectedAt: number;
}

// ---------------------------------------------------------------------------
// Offline queue
// ---------------------------------------------------------------------------

/** A queued sale stored locally when the network is unavailable. */
export interface QueuedSale {
  readonly queueId: string;
  readonly paymentRequest: PiPaymentRequest;
  readonly cartSnapshot: CartState;
  readonly queuedAt: number;
  syncStatus: "pending" | "syncing" | "synced" | "failed";
  syncAttempts: number;
  lastSyncError?: string;
}

// ---------------------------------------------------------------------------
// Shift authentication
// ---------------------------------------------------------------------------

/** A merchant shift record. */
export interface Shift {
  readonly shiftId: string;
  readonly openedBy: string;
  readonly openedAt: number;
  closedAt: number | null;
  readonly role: EmployeeRole;
  /** Hashed session token (never raw key). */
  readonly sessionToken: string;
}

// ---------------------------------------------------------------------------
// Tax engine
// ---------------------------------------------------------------------------

/** A tax region definition. */
export interface TaxRegion {
  readonly regionCode: string;
  readonly regionName: string;
  /** Tax rate as a decimal fraction, e.g. 0.075 = 7.5 %. */
  readonly rate: number;
  readonly taxType: "VAT" | "SalesTax" | "GST" | "None";
}

/** Tax calculation result. */
export interface TaxCalculation {
  readonly regionCode: string;
  readonly taxType: string;
  readonly rate: number;
  readonly subtotalPi: number;
  readonly taxAmountPi: number;
  readonly totalWithTaxPi: number;
}

// ---------------------------------------------------------------------------
// Fiat oracle / peg
// ---------------------------------------------------------------------------

/** A fiat currency oracle rate snapshot. */
export interface FiatRateSnapshot {
  readonly currency: string;
  readonly symbol: string;
  readonly piToFiatRate: number;
  readonly fetchedAt: number;
  /** True when the rate was served from cache. */
  readonly fromCache: boolean;
}

// ---------------------------------------------------------------------------
// Loyalty
// ---------------------------------------------------------------------------

/** A cryptographic loyalty token issued to a customer's wallet. */
export interface LoyaltyToken {
  readonly tokenId: string;
  readonly issuedTo: string;
  readonly issuedAt: number;
  readonly orderId: string;
  readonly pointsAwarded: number;
  /** On-chain transaction ID for verification. */
  readonly txid?: string;
}

// ---------------------------------------------------------------------------
// POS engine configuration
// ---------------------------------------------------------------------------

/** Top-level configuration passed to PosEngine / PosProvider. */
export interface PosConfig {
  /** Your Pi app API key from the developer portal. */
  readonly apiKey: string;
  /** Your merchant Pi wallet address. */
  readonly merchantWalletAddress: string;
  readonly merchantName: string;
  /** Tip wallet address (separate from merchant wallet). */
  readonly tipWalletAddress?: string;
  /** ISO 3166-1 alpha-2 country code for automatic tax calculation. */
  readonly defaultTaxRegion?: string;
  /** Fiat currency ISO code for display (e.g., "BSD", "USD"). */
  readonly fiatCurrency?: string;
  /** Whether to issue loyalty tokens after each purchase. */
  readonly loyaltyEnabled?: boolean;
  /** Points multiplier for loyalty programme. Defaults to 1. */
  readonly loyaltyPointsPerPi?: number;
  /** Sandbox mode — uses Pi Testnet. */
  readonly sandbox?: boolean;
}

// ---------------------------------------------------------------------------
// Debug / logger
// ---------------------------------------------------------------------------

/** Structured log entry emitted by pi-universal-logger. */
export interface PiLogEntry {
  readonly level: "info" | "warn" | "error" | "debug";
  readonly code: string;
  readonly message: string;
  readonly hint: string;
  readonly timestamp: number;
  readonly context?: Record<string, unknown>;
}

/** A CORS intercept record from pi-cors-shield. */
export interface CorsIntercept {
  readonly url: string;
  readonly method: string;
  readonly interceptedAt: number;
  readonly fallbackUsed: boolean;
  readonly fallbackUrl?: string;
}

// ---------------------------------------------------------------------------
// React context
// ---------------------------------------------------------------------------

/** Full shape of the POS context value exposed by PosProvider. */
export interface PosContextValue {
  readonly engine: import("../core/PosEngine.js").PosEngine;
  readonly cart: CartState;
  readonly auth: PiAuthResult | null;
  readonly activeShift: Shift | null;
  readonly fiatRate: FiatRateSnapshot | null;
  readonly logs: PiLogEntry[];
  readonly isOnline: boolean;
  readonly queuedSales: QueuedSale[];
}
