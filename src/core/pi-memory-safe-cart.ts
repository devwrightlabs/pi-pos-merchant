/**
 * @fileoverview pi-memory-safe-cart — Aggressive garbage-collection strategies
 * for the POS cart state, preventing older iPads and low-RAM Android tablets
 * from crashing when scanning massive product inventories.
 *
 * @module @devright/pi-pos-merchant/core
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import type { CartItem, Product } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Memory-safe cart configuration options. */
export interface MemorySafeCartConfig {
  /**
   * Maximum number of unique line items (SKUs) the cart may hold.
   * Defaults to 100.
   */
  maxItems?: number;

  /**
   * Target memory usage threshold in bytes.  When `performance.memory` is
   * available and used JS heap exceeds this value, a GC pass is triggered.
   * Defaults to 50 MB.
   */
  memoryThresholdBytes?: number;

  /**
   * How often (in milliseconds) the background memory monitor polls.
   * Defaults to 10 000 ms (10 seconds).
   */
  monitorIntervalMs?: number;
}

const DEFAULTS: Required<MemorySafeCartConfig> = {
  maxItems: 100,
  memoryThresholdBytes: 50 * 1024 * 1024, // 50 MB
  monitorIntervalMs: 10_000,
};

// ---------------------------------------------------------------------------
// MemorySafeCart class
// ---------------------------------------------------------------------------

/**
 * A cart implementation with aggressive memory management.
 *
 * Use this as the authoritative cart state inside {@link PosEngine}.  It
 * enforces item limits, runs periodic GC passes, and strips non-essential
 * product metadata from memory when pressure is detected.
 */
export class MemorySafeCart {
  private readonly config: Required<MemorySafeCartConfig>;
  private items: CartItem[] = [];
  private monitorHandle: ReturnType<typeof setInterval> | null = null;

  constructor(config: MemorySafeCartConfig = {}) {
    this.config = { ...DEFAULTS, ...config };
  }

  // -------------------------------------------------------------------------
  // Public cart API
  // -------------------------------------------------------------------------

  /**
   * Adds a product to the cart or increments its quantity.
   *
   * @param product  - The product to add.
   * @param quantity - How many units to add (defaults to 1).
   * @throws If adding the item would exceed {@link MemorySafeCartConfig.maxItems}.
   */
  addItem(product: Product, quantity = 1): void {
    const existing = this.items.find((i) => i.product.id === product.id);

    if (existing) {
      existing.quantity += quantity;
    } else {
      if (this.items.length >= this.config.maxItems) {
        piLog(
          "error",
          PI_ERROR_CODES.CART_OVERFLOW,
          `Cart item limit reached (${this.config.maxItems}). Cannot add "${product.name}".`,
          { productId: product.id, currentItems: this.items.length }
        );
        throw new Error(
          `Cart limit of ${this.config.maxItems} unique items exceeded.`
        );
      }
      // Clone the product to avoid retaining external object references.
      this.items.push({ product: { ...product }, quantity });
    }

    this.checkMemoryPressure();
  }

  /**
   * Removes a product from the cart entirely.
   *
   * @param productId - The ID of the product to remove.
   */
  removeItem(productId: string): void {
    this.items = this.items.filter((i) => i.product.id !== productId);
  }

  /**
   * Updates the quantity of a cart line item.  If quantity ≤ 0, the item is
   * removed.
   *
   * @param productId - The product ID to update.
   * @param quantity  - The new quantity.
   */
  updateQuantity(productId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeItem(productId);
      return;
    }
    const item = this.items.find((i) => i.product.id === productId);
    if (item) {
      item.quantity = quantity;
    }
  }

  /**
   * Empties the cart and runs a full GC pass to release heap memory.
   */
  clearCart(): void {
    this.items = [];
    this.runGarbageCollection();
  }

  /**
   * Returns a shallow clone of the current cart items.
   */
  getItems(): CartItem[] {
    return [...this.items];
  }

  /**
   * Returns the number of unique line items currently in the cart.
   */
  get itemCount(): number {
    return this.items.length;
  }

  // -------------------------------------------------------------------------
  // Memory monitoring
  // -------------------------------------------------------------------------

  /**
   * Starts the periodic background memory monitor.
   * Call once after construction.
   */
  startMonitor(): void {
    if (this.monitorHandle !== null) return;

    this.monitorHandle = setInterval(() => {
      this.checkMemoryPressure();
    }, this.config.monitorIntervalMs);
  }

  /**
   * Stops the background memory monitor and clears the interval handle.
   * Call during component unmount or app teardown.
   */
  stopMonitor(): void {
    if (this.monitorHandle !== null) {
      clearInterval(this.monitorHandle);
      this.monitorHandle = null;
    }
  }

  // -------------------------------------------------------------------------
  // GC helpers
  // -------------------------------------------------------------------------

  /**
   * Checks whether memory usage is above the configured threshold and, if so,
   * strips non-critical product metadata (description, imageUrl) from cart
   * items to reduce heap pressure.
   */
  private checkMemoryPressure(): void {
    const usedBytes = getUsedJsHeapBytes();
    if (usedBytes === null) return;

    if (usedBytes > this.config.memoryThresholdBytes) {
      piLog(
        "warn",
        PI_ERROR_CODES.CART_MEMORY_PRESSURE,
        `Memory pressure detected (${formatBytes(usedBytes)} used). Running GC pass on cart.`,
        {
          usedBytes,
          threshold: this.config.memoryThresholdBytes,
          itemCount: this.items.length,
        }
      );
      this.runGarbageCollection();
    }
  }

  /**
   * Strips non-essential fields from cart item product objects to reduce
   * the effective memory footprint.  Prices, IDs and names are preserved.
   */
  private runGarbageCollection(): void {
    this.items = this.items.map((item): CartItem => {
      // Reconstruct a minimal product object, omitting description/imageUrl.
      const lean: Product = {
        id: item.product.id,
        name: item.product.name,
        description: "",
        pricePi: item.product.pricePi,
        category: item.product.category,
        available: item.product.available,
      };
      return { product: lean, quantity: item.quantity };
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the current used JS heap size in bytes using the non-standard
 * `performance.memory` API (available in Chromium-based Pi Browser), or
 * `null` if the API is not available.
 */
function getUsedJsHeapBytes(): number | null {
  if (
    typeof performance !== "undefined" &&
    "memory" in performance &&
    typeof (performance as { memory?: { usedJSHeapSize?: number } }).memory
      ?.usedJSHeapSize === "number"
  ) {
    return (performance as { memory: { usedJSHeapSize: number } }).memory
      .usedJSHeapSize;
  }
  return null;
}

/**
 * Formats a byte count as a human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
