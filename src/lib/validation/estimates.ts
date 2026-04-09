// src/lib/validation/estimates.ts
// ────────────────────────────────────────────────────────────
// Zod schemas for estimate server action inputs.
// ────────────────────────────────────────────────────────────

import { z } from "zod";

import { uuidSchema, estimateStatusSchema, rateSchema } from "./shared";

// ── Create estimate ─────────────────────────────────────────

export const createEstimateSchema = z.object({
  projectId: uuidSchema,
  name: z.string().min(1, "Estimate name is required.").max(255),
  description: z.string().max(5000).optional(),
  status: estimateStatusSchema.default("draft"),
  defaultContingencyRate: rateSchema.default(0),
  defaultOverheadRate: rateSchema.default(0),
  defaultMarkupRate: rateSchema.default(0),
  defaultTaxRate: rateSchema.default(0),
});

export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;

// ── Update estimate (partial, optimistic locking) ───────────

export const updateEstimateSchema = z.object({
  id: uuidSchema,
  version: z.number().int().min(1, "Version is required for optimistic locking."),
  name: z.string().min(1, "Estimate name is required.").max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  status: estimateStatusSchema.optional(),
  defaultContingencyRate: rateSchema.optional(),
  defaultOverheadRate: rateSchema.optional(),
  defaultMarkupRate: rateSchema.optional(),
  defaultTaxRate: rateSchema.optional(),
});

export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;

// ── Delete estimate ─────────────────────────────────────────

export const deleteEstimateSchema = z.object({
  id: uuidSchema,
});

export type DeleteEstimateInput = z.infer<typeof deleteEstimateSchema>;

// ── Get estimate ────────────────────────────────────────────

export const getEstimateSchema = z.object({
  id: uuidSchema,
});

export type GetEstimateInput = z.infer<typeof getEstimateSchema>;

// ── List estimates by project ───────────────────────────────

export const listEstimatesSchema = z.object({
  projectId: uuidSchema,
});

export type ListEstimatesInput = z.infer<typeof listEstimatesSchema>;

// ── Create version ──────────────────────────────────────────

export const createVersionSchema = z.object({
  sourceEstimateId: uuidSchema,
  versionLabel: z.string().min(1, "Version label is required.").max(255),
});

export type CreateVersionInput = z.infer<typeof createVersionSchema>;
