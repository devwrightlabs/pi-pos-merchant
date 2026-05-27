/**
 * @fileoverview pi-cors-shield — Universal CORS fallback utility that catches and
 * elegantly handles strict Pi Browser CORS blocks when the POS hits external APIs.
 *
 * Strategy:
 * 1. Attempt the original fetch request.
 * 2. On a CORS / network failure, log via pi-universal-logger.
 * 3. If a proxy URL is configured, retry through it transparently.
 * 4. Return a structured result indicating whether the fallback was used.
 *
 * @module @devright/pi-pos-merchant/debug
 */

import { piLog, PI_ERROR_CODES } from "./pi-universal-logger.js";
import type { CorsIntercept } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Global CORS shield configuration. */
export interface CorsShieldConfig {
  /**
   * A proxy endpoint that forwards blocked requests.
   * The original URL is appended as the `?url=` query parameter.
   * Example: "https://my-backend.example.com/proxy"
   */
  proxyBaseUrl?: string;

  /**
   * Maximum number of retry attempts when using the proxy.
   * Defaults to 2.
   */
  maxRetries?: number;
}

let shieldConfig: CorsShieldConfig = {};

/**
 * Configures the CORS shield globally.
 * Call this once during app startup (e.g., inside PosProvider or pi-pct-handshake).
 *
 * @param config - {@link CorsShieldConfig} options.
 */
export function configureCorsShield(config: CorsShieldConfig): void {
  shieldConfig = { ...config };
}

// ---------------------------------------------------------------------------
// Intercept log
// ---------------------------------------------------------------------------

const interceptLog: CorsIntercept[] = [];

/**
 * Returns a snapshot of all recorded CORS intercepts for this session.
 */
export function getCorsInterceptLog(): ReadonlyArray<CorsIntercept> {
  return [...interceptLog];
}

// ---------------------------------------------------------------------------
// Core shielded fetch
// ---------------------------------------------------------------------------

/**
 * A drop-in replacement for `fetch` that gracefully handles CORS errors in the
 * Pi Browser webview.
 *
 * @param url     - The target URL (string or URL object).
 * @param init    - Standard `RequestInit` options.
 * @returns A {@link Response} — either from the origin or the configured proxy.
 * @throws If all attempts (origin + proxy retries) fail.
 *
 * @example
 * ```ts
 * const res = await shieldedFetch("https://api.example.com/inventory");
 * const data = await res.json();
 * ```
 */
export async function shieldedFetch(
  url: string | URL,
  init?: RequestInit
): Promise<Response> {
  const urlStr = typeof url === "string" ? url : url.toString();
  const method = init?.method ?? "GET";

  // --- Attempt 1: direct request ---
  try {
    const response = await fetch(urlStr, init);

    if (!response.ok && response.status === 0) {
      // status 0 typically indicates a CORS / network block in the browser.
      throw new TypeError("CORS_BLOCKED: status 0 response");
    }

    return response;
  } catch (directError: unknown) {
    const isCors = isCorsError(directError);

    piLog(
      "warn",
      isCors ? PI_ERROR_CODES.NET_CORS_BLOCKED : PI_ERROR_CODES.NET_FETCH_FAILED,
      `Request to ${urlStr} failed: ${(directError as Error).message ?? String(directError)}`,
      { url: urlStr, method }
    );

    // If no proxy is configured, re-throw immediately.
    if (!shieldConfig.proxyBaseUrl) {
      recordIntercept(urlStr, method, false, undefined);
      throw directError;
    }
  }

  // --- Attempt 2+: route through proxy ---
  const proxyBase = shieldConfig.proxyBaseUrl!;
  const maxRetries = shieldConfig.maxRetries ?? 2;
  const proxyUrl = `${proxyBase}?url=${encodeURIComponent(urlStr)}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(proxyUrl, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          "X-Pi-Proxy-For": urlStr,
        },
      });

      recordIntercept(urlStr, method, true, proxyUrl);

      piLog("info", PI_ERROR_CODES.NET_CORS_BLOCKED, `CORS shield: served ${urlStr} via proxy (attempt ${attempt})`, {
        proxyUrl,
      });

      return response;
    } catch (proxyError: unknown) {
      lastError = proxyError;
      piLog(
        "warn",
        PI_ERROR_CODES.NET_FETCH_FAILED,
        `Proxy attempt ${attempt}/${maxRetries} failed for ${urlStr}`,
        { proxyUrl, error: (proxyError as Error).message ?? String(proxyError) }
      );
    }
  }

  recordIntercept(urlStr, method, false, proxyUrl);
  throw lastError;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heuristically determines whether an error is a CORS block.
 */
function isCorsError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("cors") ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    msg.includes("cors_blocked")
  );
}

/**
 * Appends an intercept record to the session log.
 */
function recordIntercept(
  url: string,
  method: string,
  fallbackUsed: boolean,
  fallbackUrl: string | undefined
): void {
  const record: CorsIntercept = {
    url,
    method,
    interceptedAt: Date.now(),
    fallbackUsed,
    ...(fallbackUrl !== undefined ? { fallbackUrl } : {}),
  };
  interceptLog.push(record);
}
