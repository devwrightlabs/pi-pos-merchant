"use client";

/**
 * @fileoverview PosRegisterUI — Premium checkout grid component for the Pi POS.
 * Dark theme (#0A0A0F background, #F0C040 accents).
 * Includes the "Blank Screen Killer" error boundary that catches fatal renders
 * and displays pi-universal-logger output on-screen.
 *
 * @module @devright/pi-pos-merchant/react
 */

import React, {
  Component,
  type ErrorInfo,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { usePos } from "./usePos.js";
import type { CartItem, Product, PiLogEntry } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const COLORS = {
  bg: "#0A0A0F",
  surface: "#13131A",
  border: "#1E1E2E",
  accent: "#F0C040",
  accentDim: "#A07A10",
  text: "#E0E0F0",
  textMuted: "#6B6B8A",
  error: "#FF4C6E",
  success: "#3EE0A0",
  warning: "#F0A040",
} as const;

// ---------------------------------------------------------------------------
// Blank Screen Killer — Error Boundary
// ---------------------------------------------------------------------------

interface BlankScreenKillerState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

interface BlankScreenKillerProps {
  logs: PiLogEntry[];
  children: ReactNode;
}

/**
 * Error boundary that catches fatal React render errors and displays a
 * diagnostic panel showing the pi-universal-logger error output.
 * Merchants see exactly what failed instead of a blank screen.
 */
class BlankScreenKiller extends Component<BlankScreenKillerProps, BlankScreenKillerState> {
  constructor(props: BlankScreenKillerProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<BlankScreenKillerState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error("[pi-pos][BlankScreenKiller] Fatal render error:", error, errorInfo);
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const errorLogs = this.props.logs.filter((l) => l.level === "error").slice(-5);

    return (
      <div
        role="alert"
        style={{
          backgroundColor: COLORS.bg,
          color: COLORS.text,
          fontFamily: "monospace",
          padding: "2rem",
          minHeight: "100vh",
          boxSizing: "border-box",
        }}
      >
        {/* Header */}
        <div
          style={{
            borderBottom: `2px solid ${COLORS.error}`,
            paddingBottom: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <h1
            style={{
              color: COLORS.error,
              margin: 0,
              fontSize: "1.4rem",
              fontWeight: "bold",
              letterSpacing: "0.05em",
            }}
          >
            ⚠ BLANK SCREEN KILLER — POS RENDER ERROR
          </h1>
          <p style={{ color: COLORS.textMuted, margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
            A fatal render error was caught. The logs below will help you diagnose the issue.
          </p>
        </div>

        {/* Error message */}
        <section style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ color: COLORS.accent, fontSize: "1rem", margin: "0 0 0.5rem" }}>
            ERROR MESSAGE
          </h2>
          <pre
            style={{
              backgroundColor: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: "4px",
              padding: "1rem",
              overflowX: "auto",
              color: COLORS.error,
              margin: 0,
              fontSize: "0.8rem",
            }}
          >
            {this.state.error?.message ?? "Unknown error"}
          </pre>
        </section>

        {/* Stack trace */}
        {this.state.error?.stack && (
          <section style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ color: COLORS.accent, fontSize: "1rem", margin: "0 0 0.5rem" }}>
              STACK TRACE
            </h2>
            <pre
              style={{
                backgroundColor: COLORS.surface,
                border: `1px solid ${COLORS.border}`,
                borderRadius: "4px",
                padding: "1rem",
                overflowX: "auto",
                color: COLORS.textMuted,
                margin: 0,
                fontSize: "0.75rem",
                maxHeight: "200px",
              }}
            >
              {this.state.error.stack}
            </pre>
          </section>
        )}

        {/* pi-universal-logger entries */}
        {errorLogs.length > 0 && (
          <section style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ color: COLORS.accent, fontSize: "1rem", margin: "0 0 0.5rem" }}>
              PI-UNIVERSAL-LOGGER — RECENT ERRORS
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {errorLogs.map((entry) => (
                <div
                  key={`${entry.timestamp}-${entry.code}`}
                  style={{
                    backgroundColor: COLORS.surface,
                    border: `1px solid ${COLORS.border}`,
                    borderLeft: `3px solid ${COLORS.error}`,
                    borderRadius: "4px",
                    padding: "0.75rem",
                  }}
                >
                  <div style={{ color: COLORS.error, fontWeight: "bold", fontSize: "0.8rem" }}>
                    [{entry.code}] {entry.message}
                  </div>
                  <div style={{ color: COLORS.accent, fontSize: "0.75rem", marginTop: "0.25rem" }}>
                    ↳ {entry.hint}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Reload button */}
        <button
          onClick={() => window.location.reload()}
          style={{
            backgroundColor: COLORS.accent,
            color: COLORS.bg,
            border: "none",
            borderRadius: "6px",
            padding: "0.75rem 2rem",
            fontFamily: "monospace",
            fontWeight: "bold",
            fontSize: "0.9rem",
            cursor: "pointer",
            letterSpacing: "0.05em",
          }}
        >
          RELOAD POS
        </button>
      </div>
    );
  }
}

// ---------------------------------------------------------------------------
// Cart item row
// ---------------------------------------------------------------------------

interface CartItemRowProps {
  item: CartItem;
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
  onRemove: (id: string) => void;
}

function CartItemRow({ item, onIncrement, onDecrement, onRemove }: CartItemRowProps): React.ReactElement {
  const total = (item.product.pricePi * item.quantity).toFixed(4);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0.75rem",
        borderBottom: `1px solid ${COLORS.border}`,
        gap: "0.5rem",
      }}
    >
      {/* Product name */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: COLORS.text,
            fontWeight: "bold",
            fontSize: "0.9rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.product.name}
        </div>
        <div style={{ color: COLORS.textMuted, fontSize: "0.75rem" }}>
          {item.product.pricePi.toFixed(4)} π each
        </div>
      </div>

      {/* Quantity controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
        <button
          aria-label={`Decrease quantity of ${item.product.name}`}
          onClick={() => onDecrement(item.product.id)}
          style={qtyBtnStyle}
        >
          −
        </button>
        <span
          style={{
            color: COLORS.text,
            fontWeight: "bold",
            minWidth: "2rem",
            textAlign: "center",
            fontSize: "0.9rem",
          }}
        >
          {item.quantity}
        </span>
        <button
          aria-label={`Increase quantity of ${item.product.name}`}
          onClick={() => onIncrement(item.product.id)}
          style={qtyBtnStyle}
        >
          +
        </button>
      </div>

      {/* Line total */}
      <div
        style={{
          color: COLORS.accent,
          fontWeight: "bold",
          fontSize: "0.9rem",
          minWidth: "5rem",
          textAlign: "right",
        }}
      >
        {total} π
      </div>

      {/* Remove */}
      <button
        aria-label={`Remove ${item.product.name} from cart`}
        onClick={() => onRemove(item.product.id)}
        style={{
          background: "none",
          border: "none",
          color: COLORS.error,
          cursor: "pointer",
          fontSize: "1rem",
          padding: "0.25rem",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

const qtyBtnStyle: React.CSSProperties = {
  backgroundColor: COLORS.border,
  border: "none",
  borderRadius: "4px",
  color: COLORS.text,
  cursor: "pointer",
  fontSize: "1rem",
  width: "2rem",
  height: "2rem",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

// ---------------------------------------------------------------------------
// Product grid tile
// ---------------------------------------------------------------------------

interface ProductTileProps {
  product: Product;
  onAdd: (product: Product) => void;
}

function ProductTile({ product, onAdd }: ProductTileProps): React.ReactElement {
  return (
    <button
      onClick={() => onAdd(product)}
      disabled={!product.available}
      style={{
        backgroundColor: COLORS.surface,
        border: `1px solid ${product.available ? COLORS.border : COLORS.textMuted}`,
        borderRadius: "8px",
        padding: "0.75rem",
        cursor: product.available ? "pointer" : "not-allowed",
        textAlign: "left",
        color: COLORS.text,
        opacity: product.available ? 1 : 0.5,
        transition: "border-color 0.15s",
      }}
      aria-label={`Add ${product.name} to cart — ${product.pricePi} Pi`}
    >
      <div
        style={{
          fontWeight: "bold",
          fontSize: "0.85rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginBottom: "0.25rem",
        }}
      >
        {product.name}
      </div>
      <div style={{ color: COLORS.accent, fontSize: "0.8rem", fontWeight: "bold" }}>
        {product.pricePi.toFixed(4)} π
      </div>
      {!product.available && (
        <div style={{ color: COLORS.error, fontSize: "0.7rem", marginTop: "0.25rem" }}>
          Out of stock
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PosRegisterUI
// ---------------------------------------------------------------------------

/** Props for {@link PosRegisterUI}. */
export interface PosRegisterUIProps {
  /**
   * The product catalogue to display in the grid.
   * Pass your full inventory here; the component handles display and filtering.
   */
  products: Product[];
  /** Called after a successful checkout with the payment ID and txid. */
  onCheckoutSuccess?: (paymentId: string, txid: string) => void;
  /** Called when the user cancels a checkout. */
  onCheckoutCancel?: () => void;
  /** Optional merchant-facing order ID generator.  Defaults to a timestamp-based ID. */
  generateOrderId?: () => string;
}

/**
 * Premium Pi POS checkout grid component.
 *
 * Renders a two-column layout:
 * - Left: scrollable product grid (tap to add to cart).
 * - Right: live cart summary with subtotal, tax, tip, and checkout button.
 *
 * Wrapped in the {@link BlankScreenKiller} error boundary.
 *
 * @example
 * ```tsx
 * <PosRegisterUI
 *   products={inventory}
 *   onCheckoutSuccess={(id, txid) => console.log("Paid!", txid)}
 * />
 * ```
 */
export function PosRegisterUI({
  products,
  onCheckoutSuccess,
  onCheckoutCancel,
  generateOrderId,
}: PosRegisterUIProps): React.ReactElement {
  const { cart, addToCart, removeFromCart, updateQuantity, checkout, isOnline, logs } =
    usePos();

  const [checkoutState, setCheckoutState] = useState<
    "idle" | "processing" | "success" | "cancelled" | "error"
  >("idle");
  const [checkoutMsg, setCheckoutMsg] = useState<string>("");
  const [tipInput, setTipInput] = useState<string>("0");
  const { setTip, engine } = usePos();

  const handleAddToCart = useCallback(
    (product: Product) => {
      try {
        addToCart(product, 1);
      } catch (err: unknown) {
        setCheckoutMsg((err as Error).message);
        setCheckoutState("error");
      }
    },
    [addToCart]
  );

  const handleTipChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setTipInput(val);
      const parsed = parseFloat(val);
      if (!isNaN(parsed) && parsed >= 0) {
        setTip(parsed);
      }
    },
    [setTip]
  );

  const handleCheckout = useCallback(async () => {
    if (cart.items.length === 0) return;
    setCheckoutState("processing");
    const orderId = generateOrderId?.() ?? `order_${Date.now()}`;
    try {
      const result = await checkout(orderId, engine.constructor.name);
      switch (result.status) {
        case "success":
          setCheckoutState("success");
          setCheckoutMsg(`Payment complete! txid: ${result.txid.slice(0, 16)}…`);
          onCheckoutSuccess?.(result.paymentId, result.txid);
          break;
        case "queued":
          setCheckoutState("success");
          setCheckoutMsg(`Offline — sale queued (${result.queueId.slice(0, 12)}…)`);
          break;
        case "cancelled":
          setCheckoutState("cancelled");
          setCheckoutMsg("Payment cancelled by user.");
          onCheckoutCancel?.();
          break;
        case "error":
          setCheckoutState("error");
          setCheckoutMsg(result.error);
          break;
      }
    } catch (err: unknown) {
      setCheckoutState("error");
      setCheckoutMsg((err as Error).message ?? "Unknown checkout error.");
    }
  }, [cart, checkout, engine, generateOrderId, onCheckoutSuccess, onCheckoutCancel]);

  const handleReset = useCallback(() => {
    setCheckoutState("idle");
    setCheckoutMsg("");
  }, []);

  return (
    <BlankScreenKiller logs={logs}>
      <div
        style={{
          backgroundColor: COLORS.bg,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          fontFamily: "'Inter', 'Segoe UI', monospace, sans-serif",
          color: COLORS.text,
        }}
      >
        {/* Top bar */}
        <header
          style={{
            backgroundColor: COLORS.surface,
            borderBottom: `1px solid ${COLORS.border}`,
            padding: "0.75rem 1.5rem",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "1.1rem",
              fontWeight: "bold",
              color: COLORS.accent,
              letterSpacing: "0.08em",
            }}
          >
            PI POS
          </h1>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "0.75rem",
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: isOnline ? COLORS.success : COLORS.error,
                display: "inline-block",
              }}
            />
            <span style={{ color: COLORS.textMuted }}>
              {isOnline ? "Online" : "Offline — queueing sales"}
            </span>
          </div>
        </header>

        {/* Main content */}
        <div
          style={{
            flex: 1,
            display: "flex",
            overflow: "hidden",
          }}
        >
          {/* Product grid — left panel */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "1rem",
              borderRight: `1px solid ${COLORS.border}`,
            }}
          >
            <h2
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.85rem",
                fontWeight: "bold",
                color: COLORS.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              Products
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: "0.5rem",
              }}
            >
              {products.map((product) => (
                <ProductTile
                  key={product.id}
                  product={product}
                  onAdd={handleAddToCart}
                />
              ))}
            </div>
          </div>

          {/* Cart — right panel */}
          <div
            style={{
              width: "340px",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              backgroundColor: COLORS.surface,
            }}
          >
            {/* Cart header */}
            <div
              style={{
                padding: "0.75rem 1rem",
                borderBottom: `1px solid ${COLORS.border}`,
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: "0.85rem",
                  fontWeight: "bold",
                  color: COLORS.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  flex: 1,
                }}
              >
                Cart ({cart.items.reduce((s, i) => s + i.quantity, 0)} items)
              </h2>
              {cart.items.length > 0 && (
                <button
                  onClick={() => { removeFromCart("__clear__"); }}
                  style={{
                    background: "none",
                    border: "none",
                    color: COLORS.textMuted,
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Cart items */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {cart.items.length === 0 ? (
                <div
                  style={{
                    padding: "2rem",
                    textAlign: "center",
                    color: COLORS.textMuted,
                    fontSize: "0.85rem",
                  }}
                >
                  Cart is empty.{"\n"}Tap a product to add it.
                </div>
              ) : (
                cart.items.map((item) => (
                  <CartItemRow
                    key={item.product.id}
                    item={item}
                    onIncrement={(id) => updateQuantity(id, item.quantity + 1)}
                    onDecrement={(id) => updateQuantity(id, item.quantity - 1)}
                    onRemove={removeFromCart}
                  />
                ))
              )}
            </div>

            {/* Totals */}
            <div
              style={{
                borderTop: `1px solid ${COLORS.border}`,
                padding: "0.75rem 1rem",
              }}
            >
              <div style={totalsRowStyle}>
                <span style={{ color: COLORS.textMuted }}>Subtotal</span>
                <span>{cart.subtotalPi.toFixed(4)} π</span>
              </div>
              {cart.taxPi > 0 && (
                <div style={totalsRowStyle}>
                  <span style={{ color: COLORS.textMuted }}>
                    Tax {cart.appliedTaxRegion ? `(${cart.appliedTaxRegion})` : ""}
                  </span>
                  <span>{cart.taxPi.toFixed(4)} π</span>
                </div>
              )}

              {/* Tip input */}
              <div style={{ ...totalsRowStyle, alignItems: "center" }}>
                <label
                  htmlFor="pi-pos-tip"
                  style={{ color: COLORS.textMuted, fontSize: "0.85rem" }}
                >
                  Tip
                </label>
                <input
                  id="pi-pos-tip"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={tipInput}
                  onChange={handleTipChange}
                  style={{
                    width: "80px",
                    backgroundColor: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: "4px",
                    color: COLORS.text,
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.85rem",
                    textAlign: "right",
                  }}
                />
              </div>

              <div
                style={{
                  ...totalsRowStyle,
                  borderTop: `1px solid ${COLORS.border}`,
                  paddingTop: "0.5rem",
                  marginTop: "0.5rem",
                }}
              >
                <span style={{ fontWeight: "bold", color: COLORS.text, fontSize: "1rem" }}>
                  TOTAL
                </span>
                <span
                  style={{
                    fontWeight: "bold",
                    color: COLORS.accent,
                    fontSize: "1.1rem",
                  }}
                >
                  {cart.totalPi.toFixed(4)} π
                </span>
              </div>
            </div>

            {/* Checkout button / status */}
            <div style={{ padding: "0.75rem 1rem", borderTop: `1px solid ${COLORS.border}` }}>
              {checkoutState === "idle" || checkoutState === "error" || checkoutState === "cancelled" ? (
                <>
                  {checkoutMsg && (
                    <div
                      style={{
                        backgroundColor:
                          checkoutState === "error" ? "#2A0A0F" : "#0A1A13",
                        border: `1px solid ${checkoutState === "error" ? COLORS.error : COLORS.warning}`,
                        borderRadius: "4px",
                        padding: "0.5rem",
                        fontSize: "0.75rem",
                        color: checkoutState === "error" ? COLORS.error : COLORS.warning,
                        marginBottom: "0.5rem",
                        wordBreak: "break-word",
                      }}
                    >
                      {checkoutMsg}
                    </div>
                  )}
                  <button
                    onClick={() => void handleCheckout()}
                    disabled={cart.items.length === 0}
                    style={{
                      width: "100%",
                      backgroundColor:
                        cart.items.length === 0 ? COLORS.textMuted : COLORS.accent,
                      color: COLORS.bg,
                      border: "none",
                      borderRadius: "8px",
                      padding: "0.875rem",
                      fontWeight: "bold",
                      fontSize: "1rem",
                      cursor: cart.items.length === 0 ? "not-allowed" : "pointer",
                      letterSpacing: "0.05em",
                      transition: "background-color 0.15s",
                    }}
                  >
                    {cart.items.length === 0 ? "ADD ITEMS TO CHECKOUT" : `PAY ${cart.totalPi.toFixed(4)} π`}
                  </button>
                </>
              ) : checkoutState === "processing" ? (
                <div
                  style={{
                    textAlign: "center",
                    color: COLORS.textMuted,
                    padding: "0.875rem",
                    fontSize: "0.9rem",
                  }}
                >
                  ⏳ Processing payment…
                </div>
              ) : (
                /* success */
                <div>
                  <div
                    style={{
                      backgroundColor: "#0A1A13",
                      border: `1px solid ${COLORS.success}`,
                      borderRadius: "4px",
                      padding: "0.5rem",
                      fontSize: "0.75rem",
                      color: COLORS.success,
                      marginBottom: "0.5rem",
                      wordBreak: "break-word",
                    }}
                  >
                    ✓ {checkoutMsg}
                  </div>
                  <button
                    onClick={handleReset}
                    style={{
                      width: "100%",
                      backgroundColor: COLORS.border,
                      color: COLORS.text,
                      border: "none",
                      borderRadius: "8px",
                      padding: "0.875rem",
                      fontWeight: "bold",
                      fontSize: "0.9rem",
                      cursor: "pointer",
                    }}
                  >
                    NEW SALE
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </BlankScreenKiller>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const totalsRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: "0.85rem",
  marginBottom: "0.4rem",
  color: COLORS.text,
};
