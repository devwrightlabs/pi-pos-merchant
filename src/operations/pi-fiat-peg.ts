/**
 * @fileoverview pi-fiat-peg — Standardized fiat oracle integration for the
 * Pi POS.  Fetches real-time Pi → fiat exchange rates (e.g., USD, BSD) and
 * provides display-ready conversions for the physical register UI.
 *
 * @module @devright/pi-pos-merchant/operations
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import { shieldedFetch } from "../debug/pi-cors-shield.js";
import type { FiatRateSnapshot } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Oracle configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the fiat peg oracle.
 */
export interface FiatPegConfig {
  /**
   * The fiat currency ISO 4217 code (e.g., "USD", "BSD", "EUR").
   */
  currency: string;

  /**
   * The currency symbol for display (e.g., "$", "B$", "€").
   */
  symbol: string;

  /**
   * Optional custom oracle URL.
   * Expected response: `{ "pi_price": <number> }` in the target currency.
   * If omitted, a fallback CoinGecko-compatible URL is used.
   */
  oracleUrl?: string;

  /**
   * Cache TTL in milliseconds.  Defaults to 60 000 ms (1 minute).
   */
  cacheTtlMs?: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  snapshot: FiatRateSnapshot;
  expiresAt: number;
}

const rateCache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// FiatPeg class
// ---------------------------------------------------------------------------

/**
 * Fiat oracle integration for Pi → local currency conversion.
 *
 * @example
 * ```ts
 * const peg = new FiatPeg({ currency: "USD", symbol: "$" });
 * const rate = await peg.getRate();
 * console.log(`1 Pi = $${rate.piToFiatRate}`);
 * ```
 */
export class FiatPeg {
  private readonly config: Required<FiatPegConfig>;

  constructor(config: FiatPegConfig) {
    this.config = {
      currency: config.currency.toUpperCase(),
      symbol: config.symbol,
      oracleUrl:
        config.oracleUrl ??
        `https://api.coingecko.com/api/v3/simple/price?ids=pi-network&vs_currencies=${config.currency.toLowerCase()}`,
      cacheTtlMs: config.cacheTtlMs ?? 60_000,
    };
  }

  /**
   * Fetches the current Pi → fiat rate.
   * Returns a cached snapshot if the TTL has not expired.
   *
   * @returns A {@link FiatRateSnapshot}.
   */
  async getRate(): Promise<FiatRateSnapshot> {
    const cacheKey = this.config.currency;
    const cached = rateCache.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt) {
      return { ...cached.snapshot, fromCache: true };
    }

    try {
      const response = await shieldedFetch(this.config.oracleUrl);

      if (!response.ok) {
        throw new Error(`Oracle HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as unknown;
      const rate = this.extractRate(data);

      const snapshot: FiatRateSnapshot = {
        currency: this.config.currency,
        symbol: this.config.symbol,
        piToFiatRate: rate,
        fetchedAt: Date.now(),
        fromCache: false,
      };

      rateCache.set(cacheKey, {
        snapshot,
        expiresAt: Date.now() + this.config.cacheTtlMs,
      });

      piLog(
        "info",
        PI_ERROR_CODES.OPS_FIAT_FETCH_FAILED,
        `Fiat rate updated: 1 Pi = ${this.config.symbol}${rate} ${this.config.currency}`,
        { currency: this.config.currency, rate }
      );

      return snapshot;
    } catch (err: unknown) {
      const message = (err as Error).message ?? String(err);

      piLog(
        "warn",
        PI_ERROR_CODES.OPS_FIAT_FETCH_FAILED,
        `Fiat oracle fetch failed: ${message}. Serving stale cache or default.`,
        { currency: this.config.currency }
      );

      // Return stale cache if available.
      if (cached) {
        return { ...cached.snapshot, fromCache: true };
      }

      // Last-resort hardcoded fallback to avoid a crash.
      return {
        currency: this.config.currency,
        symbol: this.config.symbol,
        piToFiatRate: 0,
        fetchedAt: Date.now(),
        fromCache: true,
      };
    }
  }

  /**
   * Converts a Pi amount to the configured fiat currency.
   *
   * @param amountPi - Amount in Pi.
   * @returns The fiat equivalent, or `null` if the rate is unavailable.
   */
  async convertPiToFiat(amountPi: number): Promise<number | null> {
    const snapshot = await this.getRate();
    if (snapshot.piToFiatRate === 0) return null;
    return Math.round(amountPi * snapshot.piToFiatRate * 100) / 100;
  }

  /**
   * Formats a Pi amount as a fiat price string (e.g., "$12.50").
   *
   * @param amountPi - Amount in Pi.
   * @returns A formatted string, or `"—"` if the rate is unavailable.
   */
  async formatFiat(amountPi: number): Promise<string> {
    const fiat = await this.convertPiToFiat(amountPi);
    if (fiat === null) return "—";
    return `${this.config.symbol}${fiat.toFixed(2)}`;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extracts the Pi→fiat rate from a CoinGecko-compatible response.
   * Falls back to a direct `pi_price` key for custom oracle responses.
   */
  private extractRate(data: unknown): number {
    if (typeof data !== "object" || data === null) {
      throw new Error("Oracle response is not an object.");
    }

    const obj = data as Record<string, unknown>;

    // CoinGecko format: { "pi-network": { "usd": 3.14 } }
    const piNetwork = obj["pi-network"];
    if (typeof piNetwork === "object" && piNetwork !== null) {
      const inner = piNetwork as Record<string, unknown>;
      const rate = inner[this.config.currency.toLowerCase()];
      if (typeof rate === "number") return rate;
    }

    // Custom oracle format: { "pi_price": 3.14 }
    if (typeof obj["pi_price"] === "number") {
      return obj["pi_price"] as number;
    }

    // Generic fallback: find any numeric value
    for (const val of Object.values(obj)) {
      if (typeof val === "number" && val > 0) return val;
    }

    throw new Error("Could not extract Pi price from oracle response.");
  }
}
