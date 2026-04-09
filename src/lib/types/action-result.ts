// src/lib/types/action-result.ts
// ────────────────────────────────────────────────────────────
// Discriminated union for server action return values.
// Server actions ALWAYS return ActionResult -- never throw.
// ────────────────────────────────────────────────────────────

// ── Error code const object ─────────────────────────────────
// Organized by domain. Client code can switch on these for
// specific error handling (retry, redirect, field highlighting).

export const ERROR_CODE = {
  // Auth / authorization
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',

  // Not found
  NOT_FOUND: 'NOT_FOUND',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // Conflict / constraint violation
  CONFLICT: 'CONFLICT',
  OPTIMISTIC_LOCK_FAILED: 'OPTIMISTIC_LOCK_FAILED',

  // Snapshot operations
  SNAPSHOT_RESTORE_BLOCKED: 'SNAPSHOT_RESTORE_BLOCKED',

  // Tree operations
  TREE_CYCLE_DETECTED: 'TREE_CYCLE_DETECTED',
  ITEM_HAS_CHILDREN: 'ITEM_HAS_CHILDREN',

  // Server / database
  SERVER_ERROR: 'SERVER_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

// ── ActionResult<T> ─────────────────────────────────────────
// Discriminated union on `success`. Server actions ALWAYS return this.
// NEVER throw from a server action -- return ActionResult instead.

export type ActionResult<T = void> = ActionSuccess<T> | ActionError;

export interface ActionSuccess<T = void> {
  readonly success: true;
  readonly data: T;
}

export interface ActionError {
  readonly success: false;
  readonly error: string;
  readonly code: ErrorCode;
  readonly fieldErrors?: Readonly<Record<string, string[]>>;
}

// ── Factory functions ───────────────────────────────────────
// Enforce consistent creation. Never construct ActionResult manually.

export function ok(): ActionResult<void>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T> {
  return { success: true, data: data as T };
}

export function err(
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionError {
  return {
    success: false,
    error: message,
    code,
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

// ── Convenience error constructors ──────────────────────────

export function validationError(
  message: string,
  fieldErrors?: Record<string, string[]>,
): ActionError {
  return err(ERROR_CODE.VALIDATION_ERROR, message, fieldErrors);
}

export function notFound(entity: string): ActionError {
  return err(ERROR_CODE.NOT_FOUND, `${entity} not found.`);
}

export function unauthorized(): ActionError {
  return err(
    ERROR_CODE.UNAUTHORIZED,
    'You must be signed in to perform this action.',
  );
}

export function forbidden(): ActionError {
  return err(
    ERROR_CODE.FORBIDDEN,
    'You do not have permission to perform this action.',
  );
}

export function optimisticLockFailed(): ActionError {
  return err(
    ERROR_CODE.OPTIMISTIC_LOCK_FAILED,
    'This record was modified by another user. Please refresh and try again.',
  );
}
