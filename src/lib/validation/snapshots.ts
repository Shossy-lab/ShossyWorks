// src/lib/validation/snapshots.ts
// ────────────────────────────────────────────────────────────
// Zod schemas for estimate snapshot server action inputs.
// ────────────────────────────────────────────────────────────

import { z } from "zod";

import { uuidSchema, snapshotTypeSchema } from "./shared";

// ── Create snapshot ─────────────────────────────────────────

export const createSnapshotSchema = z.object({
  estimateId: uuidSchema,
  name: z.string().min(1, "Snapshot name is required.").max(255),
  description: z.string().max(1000).nullable().optional(),
  snapshotType: snapshotTypeSchema.default("milestone"),
});

export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;

// ── Restore snapshot ────────────────────────────────────────

export const restoreSnapshotSchema = z.object({
  snapshotId: uuidSchema,
  estimateVersion: z.number().int().min(1, "Estimate version is required for optimistic locking."),
  force: z.boolean().default(false),
});

export type RestoreSnapshotInput = z.infer<typeof restoreSnapshotSchema>;

// ── Delete snapshot ─────────────────────────────────────────

export const deleteSnapshotSchema = z.object({
  id: uuidSchema,
});

export type DeleteSnapshotInput = z.infer<typeof deleteSnapshotSchema>;

// ── Get snapshot ────────────────────────────────────────────

export const getSnapshotSchema = z.object({
  id: uuidSchema,
});

export type GetSnapshotInput = z.infer<typeof getSnapshotSchema>;

// ── List snapshots by estimate ──────────────────────────────

export const listSnapshotsSchema = z.object({
  estimateId: uuidSchema,
});

export type ListSnapshotsInput = z.infer<typeof listSnapshotsSchema>;

// ── Compare snapshots ───────────────────────────────────────

export const compareSnapshotsSchema = z.object({
  snapshotIdA: uuidSchema,
  snapshotIdB: uuidSchema,
});

export type CompareSnapshotsInput = z.infer<typeof compareSnapshotsSchema>;
