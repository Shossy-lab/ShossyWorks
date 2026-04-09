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

// ── Enums as Zod schemas ─────────────────────────────────────
// Derived from the application enum const objects in enums.ts.

export const projectStatusSchema = z.enum(
  PROJECT_STATUS_VALUES as unknown as [string, ...string[]],
);

export const estimateStatusSchema = z.enum(
  ESTIMATE_STATUS_VALUES as unknown as [string, ...string[]],
);

export const nodeTypeSchema = z.enum(
  NODE_TYPE_VALUES as unknown as [string, ...string[]],
);

export const clientVisibilitySchema = z.enum(
  CLIENT_VISIBILITY_VALUES as unknown as [string, ...string[]],
);

// Enums not yet in enums.ts — defined inline from DB enum values.
export const snapshotTypeSchema = z.enum(["milestone", "checkpoint"]);

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
