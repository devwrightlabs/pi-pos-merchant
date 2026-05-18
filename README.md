# @devright/pi-pos-merchant

> **Production-ready TypeScript Point-of-Sale (POS) engine for the native Pi Network webview.**  
> PCT-compliant · Hardware-aware · Offline-resilient · Zero `any` types.

[![license](https://img.shields.io/npm/l/@devright/pi-pos-merchant)](./LICENSE)

---

## Overview

`@devright/pi-pos-merchant` is the **Universal Blueprint** Pi POS library built by [Devright Labs](https://devright.io). It solves ecosystem-wide problems (CORS drops, offline syncing, webview crashes) and provides universal debugging tools, while also integrating directly with Devright's physical retail hardware (thermal printers, cash drawers, NFC wristbands, BLE inventory radar).

### 16 Core Modules

| Module | Path | Purpose |
|---|---|---|
| `PosEngine` | `core/PosEngine` | Master class: cart, checkout, payments |
| `pi-pct-handshake` | `core/pi-pct-handshake` | Official Pi Core Team auth init |
| `pi-offline-queue` | `core/pi-offline-queue` | Wi-Fi drop queuing + bulk sync |
| `pi-memory-safe-cart` | `core/pi-memory-safe-cart` | GC for low-RAM tablets |
| `pi-universal-logger` | `debug/pi-universal-logger` | Webview crash interceptor + human-readable codes |
| `pi-cors-shield` | `debug/pi-cors-shield` | CORS block fallback + proxy routing |
| `pi-hardware-fallback` | `debug/pi-hardware-fallback` | Auto QR receipt when printer fails |
| `pi-receipt-printer` | `hardware/pi-receipt-printer` | ESC/POS BLE thermal printer |
| `pi-cash-drawer` | `hardware/pi-cash-drawer` | BLE/network RJ11 drawer kick |
| `pi-nfc-wristband` | `hardware/pi-nfc-wristband` | Fast-tap NFC employee login |
| `pi-inventory-radar` | `hardware/pi-inventory-radar` | BLE proximity menu push |
| `pi-shift-auth` | `operations/pi-shift-auth` | Open/close shifts without key exposure |
| `pi-tax-engine` | `operations/pi-tax-engine` | Regional VAT/Sales Tax calculation |
| `pi-tip-router` | `operations/pi-tip-router` | Tip separation to a dedicated wallet |
| `pi-fiat-peg` | `operations/pi-fiat-peg` | Pi → fiat rate oracle (USD, BSD, etc.) |
| `pi-loyalty-stamp` | `operations/pi-loyalty-stamp` | Post-purchase loyalty token issuance |

---

## Installation

```bash
npm install @devright/pi-pos-merchant
# peer dependencies
npm install react react-dom
```

---

## Quick Start

### 1. Wrap your app with `<PosProvider>`

```tsx
import { PosProvider } from "@devright/pi-pos-merchant";
import type { PosConfig } from "@devright/pi-pos-merchant";

const posConfig: PosConfig = {
  apiKey: "YOUR_PI_APP_API_KEY",
  merchantWalletAddress: "GDQP2K...YOUR_WALLET",
  merchantName: "Devright Café",
  tipWalletAddress: "GDQP2K...TIP_WALLET",
  defaultTaxRegion: "BS",
  fiatCurrency: "BSD",
  loyaltyEnabled: true,
  loyaltyPointsPerPi: 10,
  sandbox: false,
};

export default function App() {
  return (
    <PosProvider config={posConfig}>
      <YourPOSScreen />
    </PosProvider>
  );
}
```

### 2. Use the `usePos()` hook

```tsx
import { usePos } from "@devright/pi-pos-merchant";

function Checkout() {
  const { cart, addToCart, checkout, isOnline } = usePos();

  return (
    <div>
      <p>Total: {cart.totalPi} Pi</p>
      {!isOnline && <p>⚠ Offline — sales are queued</p>}
      <button onClick={() => checkout(`order_${Date.now()}`, "my_merchant_id")}>
        Pay with Pi
      </button>
    </div>
  );
}
```

### 3. Drop-in Register UI

```tsx
import { PosRegisterUI } from "@devright/pi-pos-merchant";

function POSScreen() {
  return (
    <PosRegisterUI
      products={myInventory}
      onCheckoutSuccess={(paymentId, txid) => console.log("Paid!", txid)}
    />
  );
}
```

---

## PCT Compliance

The `pi-pct-handshake` module strictly enforces the Pi Core Team authentication flow:

1. Validates `window.Pi` is present (Pi Browser guard).
2. Calls `window.Pi.authenticate()` with the correct scopes.
3. Handles `onIncompletePaymentFound` — **required by PCT** to recover unfinished payments.
4. Installs the global webview crash interceptor.
5. Logs all outcomes via `pi-universal-logger`.

```ts
import { initPiHandshake } from "@devright/pi-pos-merchant";

const result = await initPiHandshake(config, undefined, async (payment) => {
  await fetch("/api/payments/approve", {
    method: "POST",
    body: JSON.stringify({ paymentId: payment.identifier }),
  });
});

if (!result.success) {
  console.error("Pi SDK init failed:", result.error);
}
```

---

## Physical Hardware Pairing

### Receipt Printer (Bluetooth ESC/POS)

```ts
import { ReceiptPrinter } from "@devright/pi-pos-merchant";
import type { EscPosPrintJob } from "@devright/pi-pos-merchant";

const printer = new ReceiptPrinter();
await printer.connect();

const job: EscPosPrintJob = { ... };
const result = await printer.print(job);

if (result.qrFallbackDataUri) {
  showQrOnScreen(result.qrFallbackDataUri);
}

printer.disconnect();
```

### Cash Drawer

```ts
import { CashDrawer } from "@devright/pi-pos-merchant";

const drawer = new CashDrawer({ method: "bluetooth", targetAddress: "" });
await drawer.connect();
await drawer.open("pin2");
drawer.disconnect();
```

### NFC Wristband Employee Login

```ts
import { NfcWristbandReader, registerWristband } from "@devright/pi-pos-merchant";

registerWristband({
  serial: "04:AB:CD:EF:12:34",
  employeeId: "emp_001",
  employeeName: "Alice",
  role: "cashier",
});

const reader = new NfcWristbandReader();
const stop = await reader.startListening((payload) => {
  console.log(`Employee ${payload.employeeId} authenticated as ${payload.role}`);
});

stop();
```

### BLE Inventory Radar

```ts
import { InventoryRadar } from "@devright/pi-pos-merchant";

const radar = new InventoryRadar({ menuUrl: "https://my.store/menu" });
const stop = await radar.start((beacon) => {
  console.log(`@${beacon.piUsername} is ${beacon.distanceMetres.toFixed(1)}m away`);
});
```

---

## Universal Debugging Suite

### pi-universal-logger

```ts
import { piLog, PI_ERROR_CODES, subscribeLogs } from "@devright/pi-pos-merchant";

const unsub = subscribeLogs((entry) => {
  console.log(`[${entry.level}][${entry.code}] ${entry.message}`);
  console.log(`  ↳ HINT: ${entry.hint}`);
});

piLog("error", PI_ERROR_CODES.SDK_AUTH_FAILED, "Custom message", { extra: "context" });
```

### pi-cors-shield

```ts
import { shieldedFetch, configureCorsShield } from "@devright/pi-pos-merchant";

configureCorsShield({
  proxyBaseUrl: "https://my-backend.example.com/proxy",
  maxRetries: 2,
});

const res = await shieldedFetch("https://external-api.example.com/inventory");
```

---

## Offline Queue

```ts
import { watchConnectivity, bulkSyncOfflineQueue } from "@devright/pi-pos-merchant";

const unwatch = watchConnectivity(async (sale) => {
  await fetch("/api/payments/approve", {
    method: "POST",
    body: JSON.stringify(sale.paymentRequest),
  });
});
```

---

## License

MIT © [Devright Labs](https://devright.io)