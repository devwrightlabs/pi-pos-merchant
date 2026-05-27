/**
 * @fileoverview pi-offline-queue — Universal fallback for offline retail
 * scenarios.  When the store's Wi-Fi drops, sales are securely queued to
 * `localStorage` and bulk-synced to the blockchain via PCT-approved async
 * methods when connectivity returns.
 *
 * @module @devright/pi-pos-merchant/core
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import type { QueuedSale, PiPaymentRequest, CartState } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "pi_pos_offline_queue";
const MAX_SYNC_ATTEMPTS = 5;
/** Back-off delay in ms: attempt 1→2s, 2→4s, 3→8s … */
const BASE_BACKOFF_MS = 2000;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/** Reads the queue from localStorage.  Returns an empty array on parse failure. */
function readQueue(): QueuedSale[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedSale[];
  } catch {
    return [];
  }
}

/** Persists the queue to localStorage. */
function writeQueue(queue: QueuedSale[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (e: unknown) {
    piLog("warn", PI_ERROR_CODES.NET_SYNC_FAILED, "Failed to write offline queue to localStorage.", {
      error: (e as Error).message ?? String(e),
    });
  }
}

// ---------------------------------------------------------------------------
// Queue management
// ---------------------------------------------------------------------------

/**
 * Returns the current in-memory + persisted offline queue.
 */
export function getOfflineQueue(): QueuedSale[] {
  return readQueue();
}

/**
 * Enqueues a sale for later synchronisation.
 *
 * @param paymentRequest - The Pi payment request that could not be sent.
 * @param cartSnapshot   - A snapshot of the cart at the time of the sale.
 * @returns The newly created {@link QueuedSale} entry.
 */
export function enqueueOfflineSale(
  paymentRequest: PiPaymentRequest,
  cartSnapshot: CartState
): QueuedSale {
  const queue = readQueue();

  const entry: QueuedSale = {
    queueId: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    paymentRequest,
    cartSnapshot,
    queuedAt: Date.now(),
    syncStatus: "pending",
    syncAttempts: 0,
  };

  queue.push(entry);
  writeQueue(queue);

  piLog("info", PI_ERROR_CODES.NET_OFFLINE, `Sale queued offline. Queue depth: ${queue.length}`, {
    queueId: entry.queueId,
    amount: paymentRequest.amount,
  });

  return entry;
}

/**
 * Removes a successfully synced sale from the queue.
 *
 * @param queueId - The ID of the sale to remove.
 */
export function dequeueOfflineSale(queueId: string): void {
  const queue = readQueue().filter((s) => s.queueId !== queueId);
  writeQueue(queue);
}

// ---------------------------------------------------------------------------
// Sync orchestrator
// ---------------------------------------------------------------------------

/**
 * The function signature for a server-side approval + completion call.
 * Your backend should call the Pi platform API to approve and complete the payment.
 */
export type SyncSaleHandler = (sale: QueuedSale) => Promise<void>;

/**
 * Attempts to bulk-sync all pending offline sales to the Pi blockchain.
 *
 * Each sale is processed sequentially to avoid flooding the Pi network.
 * Exponential back-off is applied per failed attempt.  Sales that exceed
 * {@link MAX_SYNC_ATTEMPTS} are marked `"failed"` and kept in the queue for
 * manual review.
 *
 * @param handler - An async function that performs server-side approval/completion for one sale.
 *
 * @example
 * ```ts
 * window.addEventListener("online", () => {
 *   bulkSyncOfflineQueue(async (sale) => {
 *     await fetch("/api/payments/approve", {
 *       method: "POST",
 *       body: JSON.stringify(sale.paymentRequest),
 *     });
 *   });
 * });
 * ```
 */
export async function bulkSyncOfflineQueue(handler: SyncSaleHandler): Promise<void> {
  const queue = readQueue();
  const pending = queue.filter((s) => s.syncStatus === "pending" || s.syncStatus === "failed");

  if (pending.length === 0) {
    piLog("info", PI_ERROR_CODES.NET_OFFLINE, "Offline queue is empty — nothing to sync.");
    return;
  }

  piLog("info", PI_ERROR_CODES.NET_OFFLINE, `Starting offline sync for ${pending.length} sale(s).`);

  for (const sale of pending) {
    // Skip sales that have already exhausted retry attempts.
    if (sale.syncAttempts >= MAX_SYNC_ATTEMPTS) {
      piLog(
        "warn",
        PI_ERROR_CODES.NET_SYNC_FAILED,
        `Sale ${sale.queueId} exceeded max sync attempts (${MAX_SYNC_ATTEMPTS}). Marking failed.`,
        { queueId: sale.queueId }
      );
      updateQueueEntry(sale.queueId, { syncStatus: "failed" });
      continue;
    }

    // Exponential back-off between retries.
    if (sale.syncAttempts > 0) {
      const delay = BASE_BACKOFF_MS * Math.pow(2, sale.syncAttempts - 1);
      await sleep(delay);
    }

    updateQueueEntry(sale.queueId, { syncStatus: "syncing", syncAttempts: sale.syncAttempts + 1 });

    try {
      await handler({ ...sale, syncAttempts: sale.syncAttempts + 1 });

      dequeueOfflineSale(sale.queueId);

      piLog("info", PI_ERROR_CODES.NET_OFFLINE, `Sale ${sale.queueId} synced successfully.`, {
        queueId: sale.queueId,
      });
    } catch (err: unknown) {
      const message = (err as Error).message ?? String(err);

      updateQueueEntry(sale.queueId, {
        syncStatus: "failed",
        lastSyncError: message,
      });

      piLog(
        "error",
        PI_ERROR_CODES.NET_SYNC_FAILED,
        `Failed to sync sale ${sale.queueId}: ${message}`,
        { queueId: sale.queueId, attempt: sale.syncAttempts + 1 }
      );
    }
  }

  const remaining = readQueue().filter((s) => s.syncStatus !== "synced");
  piLog(
    "info",
    PI_ERROR_CODES.NET_OFFLINE,
    `Offline sync complete. ${remaining.length} sale(s) still pending.`
  );
}

// ---------------------------------------------------------------------------
// Connectivity watcher
// ---------------------------------------------------------------------------

/**
 * Installs browser `online` / `offline` event listeners.
 * When the device comes back online, `bulkSyncOfflineQueue` is automatically
 * invoked with the provided handler.
 *
 * @param handler - The sync handler to call when connectivity returns.
 * @returns An uninstall function that removes the event listeners.
 */
export function watchConnectivity(handler: SyncSaleHandler): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onOnline = (): void => {
    piLog("info", PI_ERROR_CODES.NET_OFFLINE, "Network connectivity restored. Attempting offline queue sync…");
    void bulkSyncOfflineQueue(handler);
  };

  const onOffline = (): void => {
    piLog("warn", PI_ERROR_CODES.NET_OFFLINE, "Network connectivity lost. Sales will be queued locally.");
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateQueueEntry(
  queueId: string,
  updates: Partial<Pick<QueuedSale, "syncStatus" | "syncAttempts" | "lastSyncError">>
): void {
  const queue = readQueue();
  const idx = queue.findIndex((s) => s.queueId === queueId);
  if (idx === -1) return;
  queue[idx] = { ...queue[idx]!, ...updates };
  writeQueue(queue);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
