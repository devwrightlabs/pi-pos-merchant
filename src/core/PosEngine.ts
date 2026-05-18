/**
 * @fileoverview PosEngine — The master class orchestrating the complete Pi POS
 * lifecycle: cart management, PCT payment flow, tax, tips, loyalty, and
 * offline queuing.
 *
 * @module @devright/pi-pos-merchant/core
 */

import { MemorySafeCart } from "./pi-memory-safe-cart.js";
import { enqueueOfflineSale } from "./pi-offline-queue.js";
import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import { calculateTax } from "../operations/pi-tax-engine.js";
import { routeTip } from "../operations/pi-tip-router.js";
import { issueLoyaltyToken } from "../operations/pi-loyalty-stamp.js";
import type {
  PosConfig,
  PiSdk,
  CartState,
  CartItem,
  Product,
  PiPaymentRequest,
  PiPaymentDto,
  TaxCalculation,
  LoyaltyToken,
} from "../types/pos.js";

// ---------------------------------------------------------------------------
// PosEngine
// ---------------------------------------------------------------------------

/**
 * The master POS engine.  Instantiate once and pass through the React
 * {@link PosProvider}, or use standalone in non-React environments.
 *
 * @example
 * ```ts
 * const engine = new PosEngine(config, sdk);
 * engine.addToCart(product);
 * const result = await engine.checkout();
 * ```
 */
export class PosEngine {
  private readonly config: PosConfig;
  private readonly sdk: PiSdk | null;
  private readonly cart: MemorySafeCart;

  /** Current tip amount in Pi (set by merchant/customer). */
  private tipPi = 0;
  /** Current applied tax region code. */
  private taxRegion: string | null = null;

  constructor(config: PosConfig, sdk: PiSdk | null = null) {
    this.config = config;
    this.sdk = sdk;
    this.cart = new MemorySafeCart({ maxItems: 200 });
    this.cart.startMonitor();

    this.taxRegion = config.defaultTaxRegion ?? null;
  }

  // -------------------------------------------------------------------------
  // Cart operations
  // -------------------------------------------------------------------------

  /**
   * Adds a product to the shopping cart.
   *
   * @param product  - The product to add.
   * @param quantity - Quantity (defaults to 1).
   */
  addToCart(product: Product, quantity = 1): void {
    this.cart.addItem(product, quantity);
  }

  /**
   * Removes a product from the cart.
   *
   * @param productId - The product ID to remove.
   */
  removeFromCart(productId: string): void {
    this.cart.removeItem(productId);
  }

  /**
   * Updates the quantity of a cart line item.
   *
   * @param productId - The product ID to update.
   * @param quantity  - The new quantity (≤ 0 removes the item).
   */
  updateQuantity(productId: string, quantity: number): void {
    this.cart.updateQuantity(productId, quantity);
  }

  /**
   * Clears all items from the cart.
   */
  clearCart(): void {
    this.cart.clearCart();
    this.tipPi = 0;
  }

  /**
   * Sets the tip amount in Pi.
   *
   * @param amount - Tip in Pi (≥ 0).
   */
  setTip(amount: number): void {
    if (amount < 0) throw new Error("Tip amount must be non-negative.");
    this.tipPi = amount;
  }

  /**
   * Overrides the active tax region.
   *
   * @param regionCode - ISO 3166-1 alpha-2 country code.
   */
  setTaxRegion(regionCode: string): void {
    this.taxRegion = regionCode;
  }

  /**
   * Returns the current computed {@link CartState}.
   */
  getCartState(): CartState {
    const items: CartItem[] = this.cart.getItems();
    const subtotalPi = items.reduce(
      (sum, i) => sum + i.product.pricePi * i.quantity,
      0
    );

    let taxPi = 0;
    if (this.taxRegion) {
      try {
        const taxResult: TaxCalculation = calculateTax(subtotalPi, this.taxRegion);
        taxPi = taxResult.taxAmountPi;
      } catch {
        taxPi = 0;
      }
    }

    const totalPi = subtotalPi + taxPi + this.tipPi;

    return {
      items,
      subtotalPi,
      taxPi,
      tipPi: this.tipPi,
      totalPi,
      appliedTaxRegion: this.taxRegion,
      loyaltyTokens: [],
    };
  }

  // -------------------------------------------------------------------------
  // Checkout
  // -------------------------------------------------------------------------

  /**
   * Initiates the Pi payment checkout flow.
   *
   * Behaviour:
   * 1. Validates the cart is non-empty and a shift is active.
   * 2. If offline, enqueues the sale locally and resolves with a queued status.
   * 3. Otherwise, calls `window.Pi.createPayment()` following the PCT flow.
   * 4. On completion, routes tip to separate wallet and optionally issues loyalty token.
   *
   * @param orderId    - A unique order ID (UUID recommended).
   * @param merchantId - Your merchant identifier.
   * @returns A promise that resolves when the payment is complete or queued.
   */
  async checkout(orderId: string, merchantId: string): Promise<CheckoutResult> {
    const cartState = this.getCartState();

    if (cartState.items.length === 0) {
      return { status: "error", error: "Cart is empty." };
    }

    const paymentRequest: PiPaymentRequest = {
      amount: cartState.totalPi,
      memo: `Purchase at ${this.config.merchantName} — Order #${orderId}`,
      metadata: {
        orderId,
        merchantId,
        items: cartState.items.map((i) => ({
          productId: i.product.id,
          name: i.product.name,
          quantity: i.quantity,
          unitPricePi: i.product.pricePi,
          category: i.product.category,
        })),
        createdAt: Date.now(),
        ...(this.tipPi > 0 ? { tipAmount: this.tipPi } : {}),
        ...(this.taxRegion !== null ? { taxRegion: this.taxRegion } : {}),
      },
    };

    // --- Offline path ---
    if (!navigator.onLine) {
      const queued = enqueueOfflineSale(paymentRequest, cartState);
      this.clearCart();
      return { status: "queued", queueId: queued.queueId };
    }

    // --- Online path ---
    if (!this.sdk) {
      piLog(
        "error",
        PI_ERROR_CODES.SDK_NOT_FOUND,
        "PosEngine.checkout() called but SDK is null. Re-initialise via initPiHandshake()."
      );
      return { status: "error", error: "Pi SDK not available." };
    }

    return new Promise<CheckoutResult>((resolve) => {
      this.sdk!.createPayment(paymentRequest, {
        onReadyForServerApproval: (paymentId: string) => {
          piLog("info", PI_ERROR_CODES.SDK_NOT_FOUND, `Payment ${paymentId} ready for server approval.`, {
            paymentId,
            orderId,
          });
          // In production: call your backend /payments/approve here.
        },

        onReadyForServerCompletion: async (paymentId: string, txid: string) => {
          piLog("info", PI_ERROR_CODES.SDK_NOT_FOUND, `Payment ${paymentId} complete. txid: ${txid}`, {
            paymentId,
            txid,
            orderId,
          });

          let loyaltyToken: LoyaltyToken | null = null;

          // Route tip if present.
          if (this.tipPi > 0 && this.config.tipWalletAddress) {
            try {
              await routeTip(this.tipPi, this.config.tipWalletAddress, orderId);
            } catch (tipErr: unknown) {
              piLog(
                "error",
                PI_ERROR_CODES.OPS_TIP_ROUTE_FAILED,
                `Tip routing failed: ${(tipErr as Error).message}`,
                { orderId, tipPi: this.tipPi }
              );
            }
          }

          // Issue loyalty token if enabled.
          if (this.config.loyaltyEnabled && paymentRequest.metadata.items[0]) {
            try {
              loyaltyToken = await issueLoyaltyToken({
                recipientUid: merchantId, // In practice this is the customer UID.
                orderId,
                totalPi: cartState.totalPi,
                pointsPerPi: this.config.loyaltyPointsPerPi ?? 1,
              });
            } catch (loyaltyErr: unknown) {
              piLog(
                "error",
                PI_ERROR_CODES.OPS_LOYALTY_ISSUE_FAILED,
                `Loyalty token issuance failed: ${(loyaltyErr as Error).message}`,
                { orderId }
              );
            }
          }

          this.clearCart();

          resolve({
            status: "success",
            paymentId,
            txid,
            ...(loyaltyToken !== null ? { loyaltyToken } : {}),
          });
        },

        onCancel: (paymentId: string) => {
          piLog("warn", PI_ERROR_CODES.SDK_PAYMENT_CANCELLED, `Payment ${paymentId} cancelled by user.`, {
            paymentId,
            orderId,
          });
          resolve({ status: "cancelled", paymentId });
        },

        onError: (error: Error, payment: PiPaymentDto | null) => {
          piLog(
            "error",
            PI_ERROR_CODES.SDK_CALLBACK_ERROR,
            `Payment error: ${error.message}`,
            { orderId, paymentId: payment?.identifier ?? "unknown", stack: error.stack ?? "" }
          );
          resolve({ status: "error", error: error.message });
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /**
   * Tears down the engine, stopping the memory monitor and clearing state.
   * Call when the merchant session ends.
   */
  destroy(): void {
    this.cart.stopMonitor();
    this.cart.clearCart();
  }
}

// ---------------------------------------------------------------------------
// Checkout result type
// ---------------------------------------------------------------------------

/** The result of a {@link PosEngine.checkout} call. */
export type CheckoutResult =
  | { status: "success"; paymentId: string; txid: string; loyaltyToken?: LoyaltyToken }
  | { status: "queued"; queueId: string }
  | { status: "cancelled"; paymentId: string }
  | { status: "error"; error: string };
