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

// ── Snapshot Type ──────────────────────────────────────────

export const SNAPSHOT_TYPE = {
  MILESTONE: 'milestone',
  CHECKPOINT: 'checkpoint',
} as const;

export type SnapshotType = (typeof SNAPSHOT_TYPE)[keyof typeof SNAPSHOT_TYPE];

/** All snapshot type values */
export const SNAPSHOT_TYPE_VALUES: readonly SnapshotType[] = [
  SNAPSHOT_TYPE.MILESTONE,
  SNAPSHOT_TYPE.CHECKPOINT,
] as const;

/** Human-readable labels for UI display */
export const SNAPSHOT_TYPE_LABELS: Record<SnapshotType, string> = {
  milestone: 'Milestone',
  checkpoint: 'Checkpoint',
} as const;

// ── Option Group Type ──────────────────────────────────────

export const OPTION_GROUP_TYPE = {
  SELECTION: 'selection',
  TOGGLE: 'toggle',
} as const;

export type OptionGroupType = (typeof OPTION_GROUP_TYPE)[keyof typeof OPTION_GROUP_TYPE];

/** All option group type values */
export const OPTION_GROUP_TYPE_VALUES: readonly OptionGroupType[] = [
  OPTION_GROUP_TYPE.SELECTION,
  OPTION_GROUP_TYPE.TOGGLE,
] as const;

/** Human-readable labels for UI display */
export const OPTION_GROUP_TYPE_LABELS: Record<OptionGroupType, string> = {
  selection: 'Selection',
  toggle: 'Toggle',
} as const;

// ── Approval Status ────────────────────────────────────────

export const APPROVAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export type ApprovalStatus = (typeof APPROVAL_STATUS)[keyof typeof APPROVAL_STATUS];

/** All approval status values */
export const APPROVAL_STATUS_VALUES: readonly ApprovalStatus[] = [
  APPROVAL_STATUS.PENDING,
  APPROVAL_STATUS.APPROVED,
  APPROVAL_STATUS.REJECTED,
] as const;

/** Human-readable labels for UI display */
export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;

// ── Author Type ────────────────────────────────────────────

export const AUTHOR_TYPE = {
  USER: 'user',
  SHARE: 'share',
} as const;

export type AuthorType = (typeof AUTHOR_TYPE)[keyof typeof AUTHOR_TYPE];

/** All author type values */
export const AUTHOR_TYPE_VALUES: readonly AuthorType[] = [
  AUTHOR_TYPE.USER,
  AUTHOR_TYPE.SHARE,
] as const;

/** Human-readable labels for UI display */
export const AUTHOR_TYPE_LABELS: Record<AuthorType, string> = {
  user: 'User',
  share: 'Share',
} as const;

// ── App Role ───────────────────────────────────────────────

export const APP_ROLE = {
  OWNER: 'owner',
  EMPLOYEE: 'employee',
  CLIENT: 'client',
  PENDING: 'pending',
} as const;

export type AppRole = (typeof APP_ROLE)[keyof typeof APP_ROLE];

/** All app role values */
export const APP_ROLE_VALUES: readonly AppRole[] = [
  APP_ROLE.OWNER,
  APP_ROLE.EMPLOYEE,
  APP_ROLE.CLIENT,
  APP_ROLE.PENDING,
] as const;

/** Human-readable labels for UI display */
export const APP_ROLE_LABELS: Record<AppRole, string> = {
  owner: 'Owner',
  employee: 'Employee',
  client: 'Client',
  pending: 'Pending',
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

/** Check if a string is a valid SnapshotType */
export function isSnapshotType(value: string): value is SnapshotType {
  return SNAPSHOT_TYPE_VALUES.includes(value as SnapshotType);
}

/** Check if a string is a valid OptionGroupType */
export function isOptionGroupType(value: string): value is OptionGroupType {
  return OPTION_GROUP_TYPE_VALUES.includes(value as OptionGroupType);
}

/** Check if a string is a valid ApprovalStatus */
export function isApprovalStatus(value: string): value is ApprovalStatus {
  return APPROVAL_STATUS_VALUES.includes(value as ApprovalStatus);
}

/** Check if a string is a valid AuthorType */
export function isAuthorType(value: string): value is AuthorType {
  return AUTHOR_TYPE_VALUES.includes(value as AuthorType);
}

/** Check if a string is a valid AppRole */
export function isAppRole(value: string): value is AppRole {
  return APP_ROLE_VALUES.includes(value as AppRole);
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
