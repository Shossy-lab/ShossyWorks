// src/lib/types/status-transitions.ts
// ────────────────────────────────────────────────────────────
// Application-level transition guardrails for project and
// estimate statuses. These are SOFT warnings only -- the user
// always has final say. No transitions are blocked.
// ────────────────────────────────────────────────────────────

import {
  ESTIMATE_STATUS,
  ESTIMATE_STATUS_LABELS,
  ESTIMATE_STATUS_VALUES,
  PROJECT_STATUS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_VALUES,
} from '@/lib/types/enums';

import type { EstimateStatus, ProjectStatus } from '@/lib/types/enums';

// ── Transition result types ─────────────────────────────────

/**
 * Transition warning levels:
 * - 'none': transition is normal, no confirmation needed
 * - 'confirm': unusual transition, show confirmation dialog
 * - 'warn': potentially destructive, show warning with explanation
 */
export type TransitionLevel = 'none' | 'confirm' | 'warn';

export interface TransitionResult {
  readonly level: TransitionLevel;
  readonly message: string | null;
  /** Suggest creating a snapshot before this transition */
  readonly suggestSnapshot: boolean;
}

// ── Helpers ─────────────────────────────────────────────────

const NO_OP: TransitionResult = {
  level: 'none',
  message: null,
  suggestSnapshot: false,
};

// ── Project Status Transitions ──────────────────────────────

/**
 * Evaluate a project status transition and return any warnings.
 * This does NOT block the transition -- the user always has final say.
 */
export function evaluateProjectTransition(
  from: ProjectStatus,
  to: ProjectStatus,
): TransitionResult {
  // Same status -- no-op
  if (from === to) {
    return NO_OP;
  }

  // Moving to archived -- always confirm
  if (to === PROJECT_STATUS.ARCHIVED) {
    return {
      level: 'confirm',
      message:
        'Archiving will remove this project from active views. You can unarchive later.',
      suggestSnapshot: false,
    };
  }

  const fromIdx = PROJECT_STATUS_VALUES.indexOf(from);
  const toIdx = PROJECT_STATUS_VALUES.indexOf(to);

  // Moving from closed/warranty back to active phases
  if (
    (from === PROJECT_STATUS.CLOSED ||
      from === PROJECT_STATUS.WARRANTY_PERIOD) &&
    toIdx <= PROJECT_STATUS_VALUES.indexOf(PROJECT_STATUS.CLOSING_OUT)
  ) {
    return {
      level: 'warn',
      message: `Reopening a ${PROJECT_STATUS_LABELS[from].toLowerCase()} project to "${PROJECT_STATUS_LABELS[to]}" is unusual. This typically means additional work was discovered.`,
      suggestSnapshot: false,
    };
  }

  // Moving backward more than 2 stages
  if (toIdx < fromIdx - 2) {
    return {
      level: 'confirm',
      message: `Moving from "${PROJECT_STATUS_LABELS[from]}" back to "${PROJECT_STATUS_LABELS[to]}" skips several stages. Are you sure?`,
      suggestSnapshot: false,
    };
  }

  // Skipping forward more than 2 stages (archived already handled above)
  if (toIdx > fromIdx + 2) {
    return {
      level: 'confirm',
      message: `Jumping from "${PROJECT_STATUS_LABELS[from]}" to "${PROJECT_STATUS_LABELS[to]}" skips intermediate stages. Proceed?`,
      suggestSnapshot: false,
    };
  }

  // Normal transition
  return NO_OP;
}

// ── Estimate Status Transitions ─────────────────────────────

/**
 * Evaluate an estimate status transition and return any warnings.
 * This does NOT block the transition -- the user always has final say.
 */
export function evaluateEstimateTransition(
  from: EstimateStatus,
  to: EstimateStatus,
): TransitionResult {
  // Same status -- no-op
  if (from === to) {
    return NO_OP;
  }

  // Moving FROM complete to anything -- warn, suggest snapshot
  if (from === ESTIMATE_STATUS.COMPLETE) {
    return {
      level: 'warn',
      message:
        'Reverting a completed estimate will allow edits. A snapshot of the current state is recommended.',
      suggestSnapshot: true,
    };
  }

  // Moving FROM active to draft (skipping preliminary) -- confirm
  if (
    from === ESTIMATE_STATUS.ACTIVE &&
    to === ESTIMATE_STATUS.DRAFT
  ) {
    return {
      level: 'confirm',
      message:
        'Moving an active estimate back to draft. If this estimate has been shared with clients, they will no longer see updates.',
      suggestSnapshot: true,
    };
  }

  // Moving TO complete -- suggest snapshot
  if (to === ESTIMATE_STATUS.COMPLETE) {
    return {
      level: 'confirm',
      message:
        'Marking as complete indicates all pricing is final. A snapshot will be created automatically.',
      suggestSnapshot: true,
    };
  }

  // Normal transition (including any revert)
  return NO_OP;
}
