/**
 * @fileoverview pi-tax-engine — Natively calculates and appends regional
 * VAT / Sales Tax to the Pi POS checkout payload.
 *
 * @module @devright/pi-pos-merchant/operations
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import type { TaxRegion, TaxCalculation } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Built-in tax region table
// ---------------------------------------------------------------------------

/**
 * A curated table of commonly-used tax regions.
 * Extend this or pass custom regions via {@link registerTaxRegion}.
 */
const TAX_REGIONS: TaxRegion[] = [
  // Americas
  { regionCode: "US", regionName: "United States (no federal tax)", rate: 0, taxType: "SalesTax" },
  { regionCode: "US-CA", regionName: "California, USA", rate: 0.0725, taxType: "SalesTax" },
  { regionCode: "US-NY", regionName: "New York, USA", rate: 0.08, taxType: "SalesTax" },
  { regionCode: "US-TX", regionName: "Texas, USA", rate: 0.0625, taxType: "SalesTax" },
  { regionCode: "US-FL", regionName: "Florida, USA", rate: 0.06, taxType: "SalesTax" },
  { regionCode: "CA", regionName: "Canada (GST)", rate: 0.05, taxType: "GST" },
  { regionCode: "MX", regionName: "Mexico (IVA)", rate: 0.16, taxType: "VAT" },
  { regionCode: "BS", regionName: "The Bahamas (VAT)", rate: 0.1, taxType: "VAT" },
  { regionCode: "JM", regionName: "Jamaica (GCT)", rate: 0.15, taxType: "VAT" },
  { regionCode: "TT", regionName: "Trinidad & Tobago (VAT)", rate: 0.125, taxType: "VAT" },
  { regionCode: "BB", regionName: "Barbados (VAT)", rate: 0.175, taxType: "VAT" },

  // Europe
  { regionCode: "GB", regionName: "United Kingdom (VAT)", rate: 0.2, taxType: "VAT" },
  { regionCode: "DE", regionName: "Germany (MwSt)", rate: 0.19, taxType: "VAT" },
  { regionCode: "FR", regionName: "France (TVA)", rate: 0.2, taxType: "VAT" },
  { regionCode: "ES", regionName: "Spain (IVA)", rate: 0.21, taxType: "VAT" },
  { regionCode: "IT", regionName: "Italy (IVA)", rate: 0.22, taxType: "VAT" },
  { regionCode: "NL", regionName: "Netherlands (BTW)", rate: 0.21, taxType: "VAT" },
  { regionCode: "SE", regionName: "Sweden (Moms)", rate: 0.25, taxType: "VAT" },
  { regionCode: "NO", regionName: "Norway (MVA)", rate: 0.25, taxType: "VAT" },

  // Asia-Pacific
  { regionCode: "AU", regionName: "Australia (GST)", rate: 0.1, taxType: "GST" },
  { regionCode: "NZ", regionName: "New Zealand (GST)", rate: 0.15, taxType: "GST" },
  { regionCode: "SG", regionName: "Singapore (GST)", rate: 0.09, taxType: "GST" },
  { regionCode: "JP", regionName: "Japan (Consumption Tax)", rate: 0.1, taxType: "VAT" },
  { regionCode: "IN", regionName: "India (GST 18%)", rate: 0.18, taxType: "GST" },
  { regionCode: "PH", regionName: "Philippines (VAT)", rate: 0.12, taxType: "VAT" },
  { regionCode: "ID", regionName: "Indonesia (PPN)", rate: 0.11, taxType: "VAT" },

  // Africa / Middle East
  { regionCode: "ZA", regionName: "South Africa (VAT)", rate: 0.15, taxType: "VAT" },
  { regionCode: "NG", regionName: "Nigeria (VAT)", rate: 0.075, taxType: "VAT" },
  { regionCode: "KE", regionName: "Kenya (VAT)", rate: 0.16, taxType: "VAT" },
  { regionCode: "AE", regionName: "UAE (VAT)", rate: 0.05, taxType: "VAT" },
  { regionCode: "SA", regionName: "Saudi Arabia (VAT)", rate: 0.15, taxType: "VAT" },

  // Zero-rated sentinel
  { regionCode: "NONE", regionName: "No Tax", rate: 0, taxType: "None" },
];

/** Mutable region registry (start from built-ins, allow extensions). */
const regionRegistry = new Map<string, TaxRegion>(
  TAX_REGIONS.map((r) => [r.regionCode, r])
);

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/**
 * Registers a custom tax region (or overrides an existing one).
 *
 * @param region - The {@link TaxRegion} to register.
 */
export function registerTaxRegion(region: TaxRegion): void {
  regionRegistry.set(region.regionCode, region);
}

/**
 * Returns the {@link TaxRegion} for a given region code, or `null` if unknown.
 *
 * @param regionCode - ISO 3166-1 alpha-2 or custom region code.
 */
export function getTaxRegion(regionCode: string): TaxRegion | null {
  return regionRegistry.get(regionCode) ?? null;
}

/**
 * Returns all registered tax regions.
 */
export function getAllTaxRegions(): ReadonlyArray<TaxRegion> {
  return Array.from(regionRegistry.values());
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

/**
 * Calculates tax for a given subtotal and region.
 *
 * @param subtotalPi - The pre-tax subtotal in Pi.
 * @param regionCode - The region code (ISO 3166-1 or custom).
 * @returns A {@link TaxCalculation} result.
 * @throws If `regionCode` is not registered.
 *
 * @example
 * ```ts
 * const tax = calculateTax(10.5, "GB");
 * // { regionCode: "GB", rate: 0.2, taxAmountPi: 2.1, totalWithTaxPi: 12.6, ... }
 * ```
 */
export function calculateTax(subtotalPi: number, regionCode: string): TaxCalculation {
  if (subtotalPi < 0) {
    piLog(
      "warn",
      PI_ERROR_CODES.OPS_TAX_CALC_FAILED,
      `calculateTax received negative subtotal: ${subtotalPi}. Treating as 0.`
    );
    subtotalPi = 0;
  }

  const region = regionRegistry.get(regionCode);

  if (!region) {
    piLog(
      "error",
      PI_ERROR_CODES.OPS_TAX_CALC_FAILED,
      `Unknown tax region: "${regionCode}". Defaulting to zero tax.`,
      { regionCode }
    );
    return {
      regionCode,
      taxType: "None",
      rate: 0,
      subtotalPi,
      taxAmountPi: 0,
      totalWithTaxPi: subtotalPi,
    };
  }

  const taxAmountPi = round8(subtotalPi * region.rate);
  const totalWithTaxPi = round8(subtotalPi + taxAmountPi);

  return {
    regionCode: region.regionCode,
    taxType: region.taxType,
    rate: region.rate,
    subtotalPi,
    taxAmountPi,
    totalWithTaxPi,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rounds to 8 decimal places (Pi precision). */
function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}
