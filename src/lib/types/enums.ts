// src/lib/types/enums.ts
// ────────────────────────────────────────────────────────────
// Application-level enum definitions mirroring PostgreSQL types.
// These are the ONLY place status values should be referenced
// in application code. Never use raw string literals.
// ────────────────────────────────────────────────────────────

// ── Project Status ──────────────────────────────────────────

export const PROJECT_STATUS = {
  LEAD: 'lead',
  IN_DESIGN: 'in_design',
  BIDDING: 'bidding',
  UNDER_CONTRACT: 'under_contract',
  VALUE_ENGINEERING: 'value_engineering',
  ACTIVE_CONSTRUCTION: 'active_construction',
  CLOSING_OUT: 'closing_out',
  WARRANTY_PERIOD: 'warranty_period',
  CLOSED: 'closed',
  ARCHIVED: 'archived',
} as const;

export type ProjectStatus = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];

/** All project status values in lifecycle order */
export const PROJECT_STATUS_VALUES: readonly ProjectStatus[] = [
  PROJECT_STATUS.LEAD,
  PROJECT_STATUS.IN_DESIGN,
  PROJECT_STATUS.BIDDING,
  PROJECT_STATUS.UNDER_CONTRACT,
  PROJECT_STATUS.VALUE_ENGINEERING,
  PROJECT_STATUS.ACTIVE_CONSTRUCTION,
  PROJECT_STATUS.CLOSING_OUT,
  PROJECT_STATUS.WARRANTY_PERIOD,
  PROJECT_STATUS.CLOSED,
  PROJECT_STATUS.ARCHIVED,
] as const;

/** Human-readable labels for UI display */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  lead: 'Lead',
  in_design: 'In Design',
  bidding: 'Bidding',
  under_contract: 'Under Contract',
  value_engineering: 'Value Engineering',
  active_construction: 'Active Construction',
  closing_out: 'Closing Out',
  warranty_period: 'Warranty Period',
  closed: 'Closed',
  archived: 'Archived',
} as const;

/** Short descriptions for tooltips / help text */
export const PROJECT_STATUS_DESCRIPTIONS: Record<ProjectStatus, string> = {
  lead: 'Initial inquiry or prospect, not yet committed',
  in_design: 'Design phase, plans being developed with architect',
  bidding: 'Estimates being prepared and submitted for pricing',
  under_contract: 'Contract signed, pre-construction activities',
  value_engineering: 'Scope and cost adjustments before construction',
  active_construction: 'Construction is underway on site',
  closing_out: 'Punch list, final inspections, documentation',
  warranty_period: 'Post-completion warranty coverage period',
  closed: 'All obligations fulfilled, project complete',
  archived: 'Removed from active views, retained for reference',
} as const;

// ── Estimate Status ─────────────────────────────────────────

export const ESTIMATE_STATUS = {
  DRAFT: 'draft',
  PRELIMINARY: 'preliminary',
  ACTIVE: 'active',
  COMPLETE: 'complete',
} as const;

export type EstimateStatus = (typeof ESTIMATE_STATUS)[keyof typeof ESTIMATE_STATUS];

/** All estimate status values in maturity order */
export const ESTIMATE_STATUS_VALUES: readonly EstimateStatus[] = [
  ESTIMATE_STATUS.DRAFT,
  ESTIMATE_STATUS.PRELIMINARY,
  ESTIMATE_STATUS.ACTIVE,
  ESTIMATE_STATUS.COMPLETE,
] as const;

/** Human-readable labels for UI display */
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: 'Draft',
  preliminary: 'Preliminary',
  active: 'Active',
  complete: 'Complete',
} as const;

/** Short descriptions for tooltips / help text */
export const ESTIMATE_STATUS_DESCRIPTIONS: Record<EstimateStatus, string> = {
  draft: 'Work in progress, not yet shared with anyone',
  preliminary: 'Rough estimate for budgeting purposes',
  active: 'Live estimate used for bidding or contract',
  complete: 'Finalized, all actuals reconciled',
} as const;

// ── Node Type ───────────────────────────────────────────────

export const NODE_TYPE = {
  GROUP: 'group',
  ASSEMBLY: 'assembly',
  ITEM: 'item',
} as const;

export type NodeType = (typeof NODE_TYPE)[keyof typeof NODE_TYPE];

/** All node type values */
export const NODE_TYPE_VALUES: readonly NodeType[] = [
  NODE_TYPE.GROUP,
  NODE_TYPE.ASSEMBLY,
  NODE_TYPE.ITEM,
] as const;

/** Human-readable labels for UI display */
export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  group: 'Group',
  assembly: 'Assembly',
  item: 'Item',
} as const;

// ── Client Visibility ───────────────────────────────────────

export const CLIENT_VISIBILITY = {
  VISIBLE: 'visible',
  HIDDEN: 'hidden',
  SUMMARY_ONLY: 'summary_only',
} as const;

export type ClientVisibility = (typeof CLIENT_VISIBILITY)[keyof typeof CLIENT_VISIBILITY];

/** All client visibility values */
export const CLIENT_VISIBILITY_VALUES: readonly ClientVisibility[] = [
  CLIENT_VISIBILITY.VISIBLE,
  CLIENT_VISIBILITY.HIDDEN,
  CLIENT_VISIBILITY.SUMMARY_ONLY,
] as const;

/** Human-readable labels for UI display */
export const CLIENT_VISIBILITY_LABELS: Record<ClientVisibility, string> = {
  visible: 'Visible',
  hidden: 'Hidden',
  summary_only: 'Summary Only',
} as const;

// ── Type Guards ─────────────────────────────────────────────

/** Check if a string is a valid ProjectStatus */
export function isProjectStatus(value: string): value is ProjectStatus {
  return PROJECT_STATUS_VALUES.includes(value as ProjectStatus);
}

/** Check if a string is a valid EstimateStatus */
export function isEstimateStatus(value: string): value is EstimateStatus {
  return ESTIMATE_STATUS_VALUES.includes(value as EstimateStatus);
}

/** Check if a string is a valid NodeType */
export function isNodeType(value: string): value is NodeType {
  return NODE_TYPE_VALUES.includes(value as NodeType);
}

/** Check if a string is a valid ClientVisibility */
export function isClientVisibility(value: string): value is ClientVisibility {
  return CLIENT_VISIBILITY_VALUES.includes(value as ClientVisibility);
}

// ── Ordinal Helpers ─────────────────────────────────────────

/**
 * Get the ordinal position of a project status (0-indexed).
 * Useful for comparing progression: isAfter = ordinal(a) > ordinal(b)
 */
export function projectStatusOrdinal(status: ProjectStatus): number {
  return PROJECT_STATUS_VALUES.indexOf(status);
}

/**
 * Get the ordinal position of an estimate status (0-indexed).
 */
export function estimateStatusOrdinal(status: EstimateStatus): number {
  return ESTIMATE_STATUS_VALUES.indexOf(status);
}
