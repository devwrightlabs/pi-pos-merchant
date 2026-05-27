"use client";

/**
 * @fileoverview PosProvider — React context provider that initialises the
 * PosEngine, PCT handshake, offline queue watcher, and connectivity monitor,
 * then exposes the full POS state to child components via context.
 *
 * @module @devright/pi-pos-merchant/react
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PosEngine } from "../core/PosEngine.js";
import { initPiHandshake } from "../core/pi-pct-handshake.js";
import { watchConnectivity, getOfflineQueue } from "../core/pi-offline-queue.js";
import { subscribeLogs, getLogBuffer } from "../debug/pi-universal-logger.js";
import type {
  PosConfig,
  PiAuthResult,
  CartState,
  Shift,
  FiatRateSnapshot,
  QueuedSale,
  PiLogEntry,
  PosContextValue,
  PiPaymentDto,
} from "../types/pos.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** @internal */
export const PosContext = createContext<PosContextValue | null>(null);

/**
 * Accesses the POS context value.  Must be used inside a {@link PosProvider}.
 *
 * @throws If called outside a `<PosProvider>`.
 */
export function usePosContext(): PosContextValue {
  const ctx = useContext(PosContext);
  if (!ctx) {
    throw new Error(
      "[pi-pos] usePosContext() must be called inside a <PosProvider>. " +
        "Wrap your app with <PosProvider config={...}>."
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Props for {@link PosProvider}. */
export interface PosProviderProps {
  /** POS configuration (merchant credentials, feature flags, etc.). */
  config: PosConfig;
  /**
   * Optional handler for incomplete payments found during Pi authentication.
   * Called when the Pi SDK finds a payment that was not completed in a prior session.
   * Your implementation should call your backend to approve/complete it.
   */
  onIncompletePayment?: (payment: PiPaymentDto) => void;
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// PosProvider
// ---------------------------------------------------------------------------

/**
 * Root context provider for the Pi POS system.
 *
 * Wrap your application (or POS screen) with this provider.  It will:
 * - Run the PCT handshake and authenticate the user.
 * - Instantiate the {@link PosEngine}.
 * - Monitor network connectivity and trigger offline queue sync on reconnect.
 * - Collect real-time log entries for the debug panel.
 *
 * @example
 * ```tsx
 * <PosProvider config={posConfig}>
 *   <PosRegisterUI />
 * </PosProvider>
 * ```
 */
export function PosProvider({
  config,
  onIncompletePayment,
  children,
}: PosProviderProps): React.ReactElement {
  const [auth, setAuth] = useState<PiAuthResult | null>(null);
  const [cart, setCart] = useState<CartState>(() => emptyCart());
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [fiatRate, setFiatRate] = useState<FiatRateSnapshot | null>(null);
  const [logs, setLogs] = useState<PiLogEntry[]>(() => [...getLogBuffer()]);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [queuedSales, setQueuedSales] = useState<QueuedSale[]>(() =>
    getOfflineQueue()
  );

  // Stable ref to the PosEngine instance.
  const engineRef = useRef<PosEngine | null>(null);

  // -------------------------------------------------------------------------
  // Initialise engine + PCT handshake
  // -------------------------------------------------------------------------

  useEffect(() => {
    let destroyed = false;

    const init = async (): Promise<void> => {
      const result = await initPiHandshake(config, undefined, onIncompletePayment);

      if (destroyed) return;

      const sdk = result.sdk;
      const engine = new PosEngine(config, sdk);
      engineRef.current = engine;

      if (result.success && result.auth) {
        setAuth(result.auth);
      }

      // Kick initial cart sync.
      setCart(engine.getCartState());
    };

    void init();

    return () => {
      destroyed = true;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.apiKey]);

  // -------------------------------------------------------------------------
  // Log subscription
  // -------------------------------------------------------------------------

  useEffect(() => {
    const unsub = subscribeLogs((entry) => {
      setLogs((prev) => [...prev.slice(-199), entry]);
    });
    return unsub;
  }, []);

  // -------------------------------------------------------------------------
  // Connectivity + offline queue watcher
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleOnline = (): void => {
      setIsOnline(true);
      setQueuedSales(getOfflineQueue());
    };
    const handleOffline = (): void => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Default no-op sync handler — integrators should override via the engine.
    const unwatch = watchConnectivity(async () => {
      setQueuedSales(getOfflineQueue());
    });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unwatch();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Stable cart refresh callback
  // -------------------------------------------------------------------------

  const refreshCart = useCallback((): void => {
    if (engineRef.current) {
      setCart(engineRef.current.getCartState());
    }
  }, []);

  // Expose refreshCart on the engine instance so it can be called post-mutation.
  // We patch the engine's methods to call refreshCart automatically.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    const _add = engine.addToCart.bind(engine);
    const _remove = engine.removeFromCart.bind(engine);
    const _update = engine.updateQuantity.bind(engine);
    const _clear = engine.clearCart.bind(engine);
    const _setTip = engine.setTip.bind(engine);
    const _setTax = engine.setTaxRegion.bind(engine);

    engine.addToCart = (...args) => { _add(...args); refreshCart(); };
    engine.removeFromCart = (...args) => { _remove(...args); refreshCart(); };
    engine.updateQuantity = (...args) => { _update(...args); refreshCart(); };
    engine.clearCart = (...args) => { _clear(...args); refreshCart(); };
    engine.setTip = (...args) => { _setTip(...args); refreshCart(); };
    engine.setTaxRegion = (...args) => { _setTax(...args); refreshCart(); };
  }, [refreshCart]);

  // -------------------------------------------------------------------------
  // Context value
  // -------------------------------------------------------------------------

  const engine = engineRef.current ?? new PosEngine(config, null);

  const value = useMemo<PosContextValue>(
    () => ({
      engine,
      cart,
      auth,
      activeShift,
      fiatRate,
      logs,
      isOnline,
      queuedSales,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, cart, auth, activeShift, fiatRate, logs, isOnline, queuedSales]
  );

  // Expose setters so hooks can mutate context.
  // We attach these to the context value via a private extended interface.
  (value as PosContextValue & { _setActiveShift: typeof setActiveShift })
    ._setActiveShift = setActiveShift;
  (value as PosContextValue & { _setFiatRate: typeof setFiatRate })
    ._setFiatRate = setFiatRate;

  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyCart(): CartState {
  return {
    items: [],
    subtotalPi: 0,
    taxPi: 0,
    tipPi: 0,
    totalPi: 0,
    appliedTaxRegion: null,
    loyaltyTokens: [],
  };
}
