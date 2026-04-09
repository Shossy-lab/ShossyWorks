// src/lib/validation/shared.ts
// ────────────────────────────────────────────────────────────
// Common Zod primitives and enum schemas used across all
// validation files. Import from here instead of duplicating.
// ────────────────────────────────────────────────────────────

import { z } from "zod";

import {
  PROJECT_STATUS_VALUES,
  ESTIMATE_STATUS_VALUES,
  NODE_TYPE_VALUES,
  CLIENT_VISIBILITY_VALUES,
  SNAPSHOT_TYPE_VALUES,
  OPTION_GROUP_TYPE_VALUES,
  APPROVAL_STATUS_VALUES,
  AUTHOR_TYPE_VALUES,
  APP_ROLE_VALUES,
} from "@/lib/types/enums";

// ── Shared primitives ────────────────────────────────────────

export const uuidSchema = z.string().uuid("Invalid ID format.");

export const nameSchema = z.string().min(1, "Name is required.").max(255);

export const descriptionSchema = z.string().max(5000).optional();

export const sortOrderSchema = z.number().int().min(0);

export const decimalSchema = z.number().min(0);

export const rateSchema = z.number().min(0).max(1);

export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

// ── Enum Helper ─────────────────────────────────────────────
// Converts a readonly string array to a Zod enum schema while
// preserving literal types. Replaces double-casts through `unknown`.

export function zodEnumFromValues<T extends string>(values: readonly T[]) {
  return z.enum(values as [T, ...T[]]);
}

// ── Enums as Zod schemas ─────────────────────────────────────
// Derived from the application enum const objects in enums.ts.

export const projectStatusSchema = zodEnumFromValues(PROJECT_STATUS_VALUES);

export const estimateStatusSchema = zodEnumFromValues(ESTIMATE_STATUS_VALUES);

export const nodeTypeSchema = zodEnumFromValues(NODE_TYPE_VALUES);

export const clientVisibilitySchema = zodEnumFromValues(CLIENT_VISIBILITY_VALUES);

export const snapshotTypeSchema = zodEnumFromValues(SNAPSHOT_TYPE_VALUES);

export const optionGroupTypeSchema = zodEnumFromValues(OPTION_GROUP_TYPE_VALUES);

export const approvalStatusSchema = zodEnumFromValues(APPROVAL_STATUS_VALUES);

export const authorTypeSchema = zodEnumFromValues(AUTHOR_TYPE_VALUES);

export const appRoleSchema = zodEnumFromValues(APP_ROLE_VALUES);

export const costTypeSchema = z.enum([
  "material",
  "labor",
  "equipment",
  "subcontractor",
  "other",
]);

export const qtyModeSchema = z.enum(["numeric", "formula", "ratio"]);

export const bidTypeSchema = z.enum(["bid", "allowance", "estimate"]);

export const allowanceStatusSchema = z.enum([
  "pending_selection",
  "selected",
  "finalized",
]);

export const noteFormatSchema = z.enum(["markdown", "html"]);
