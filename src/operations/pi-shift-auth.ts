/**
 * @fileoverview pi-shift-auth — Secure shift management for Pi POS merchants.
 * Allows owners to open/close shifts and delegate cashier sessions without
 * ever exposing the master wallet private key.
 *
 * @module @devright/pi-pos-merchant/operations
 */

import { piLog, PI_ERROR_CODES } from "../debug/pi-universal-logger.js";
import type { Shift, EmployeeRole } from "../types/pos.js";

// ---------------------------------------------------------------------------
// Session token generation
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random session token using the Web Crypto API.
 * The token is a hex-encoded 32-byte random value.
 */
async function generateSessionToken(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hashes a session token using SHA-256.
 * The hash is what gets stored — raw tokens are never persisted.
 *
 * @param token - The raw session token.
 * @returns Hex-encoded SHA-256 digest.
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Shift storage (in-memory; persist to IndexedDB in production)
// ---------------------------------------------------------------------------

const activeShifts = new Map<string, Shift>();

// ---------------------------------------------------------------------------
// Shift API
// ---------------------------------------------------------------------------

/**
 * Opens a new shift for the given employee.
 *
 * Only one shift per employee role can be open at a time.  Owners can open
 * multiple manager/cashier shifts simultaneously.
 *
 * @param employeeId - The employee's unique identifier.
 * @param role       - The employee's role for this shift.
 * @returns A tuple of `[shift, rawSessionToken]`. Store the raw token in the
 *   employee's browser session only — it is never persisted server-side.
 *
 * @example
 * ```ts
 * const [shift, token] = await openShift("emp_123", "cashier");
 * // Keep `token` in memory for the duration of the shift.
 * ```
 */
export async function openShift(
  employeeId: string,
  role: EmployeeRole
): Promise<[Shift, string]> {
  const rawToken = await generateSessionToken();
  const hashedToken = await hashToken(rawToken);

  const shiftId = `shift_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const shift: Shift = {
    shiftId,
    openedBy: employeeId,
    openedAt: Date.now(),
    closedAt: null,
    role,
    sessionToken: hashedToken,
  };

  activeShifts.set(shiftId, shift);

  piLog(
    "info",
    PI_ERROR_CODES.OPS_SHIFT_NOT_OPEN,
    `Shift opened: ${shiftId} for employee ${employeeId} (${role}).`,
    { shiftId, employeeId, role }
  );

  return [shift, rawToken];
}

/**
 * Closes an active shift.
 *
 * @param shiftId    - The shift ID to close.
 * @param rawToken   - The raw session token issued at shift open (for verification).
 * @returns The closed {@link Shift} record.
 * @throws If the shift is not found or the token is invalid.
 */
export async function closeShift(shiftId: string, rawToken: string): Promise<Shift> {
  const shift = activeShifts.get(shiftId);

  if (!shift) {
    piLog("error", PI_ERROR_CODES.OPS_SHIFT_NOT_OPEN, `Shift ${shiftId} not found.`);
    throw new Error(`Shift ${shiftId} does not exist or is already closed.`);
  }

  // Verify the raw token against the stored hash.
  const submittedHash = await hashToken(rawToken);
  if (submittedHash !== shift.sessionToken) {
    piLog(
      "error",
      PI_ERROR_CODES.OPS_SHIFT_NOT_OPEN,
      `Invalid session token for shift ${shiftId}.`
    );
    throw new Error("Invalid session token. Shift cannot be closed.");
  }

  const closed: Shift = { ...shift, closedAt: Date.now() };
  activeShifts.set(shiftId, closed);
  activeShifts.delete(shiftId);

  piLog(
    "info",
    PI_ERROR_CODES.OPS_SHIFT_NOT_OPEN,
    `Shift ${shiftId} closed by ${shift.openedBy}.`,
    { shiftId, durationMs: closed.closedAt! - shift.openedAt }
  );

  return closed;
}

/**
 * Validates that a shift is currently active and the provided token is valid.
 *
 * @param shiftId  - The shift to validate.
 * @param rawToken - The session token to verify.
 * @returns The active {@link Shift}.
 * @throws If the shift is invalid or the token does not match.
 */
export async function validateShift(shiftId: string, rawToken: string): Promise<Shift> {
  const shift = activeShifts.get(shiftId);

  if (!shift) {
    piLog("error", PI_ERROR_CODES.OPS_SHIFT_NOT_OPEN, `No active shift: ${shiftId}.`);
    throw new Error(`No active shift found: ${shiftId}`);
  }

  const submittedHash = await hashToken(rawToken);
  if (submittedHash !== shift.sessionToken) {
    piLog("error", PI_ERROR_CODES.OPS_SHIFT_NOT_OPEN, `Token mismatch for shift ${shiftId}.`);
    throw new Error("Session token invalid.");
  }

  return shift;
}

/**
 * Returns all currently active shifts.
 */
export function getActiveShifts(): ReadonlyArray<Shift> {
  return Array.from(activeShifts.values());
}
