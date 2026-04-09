// src/lib/validation/projects.ts
// ────────────────────────────────────────────────────────────
// Zod schemas for project server action inputs.
// ────────────────────────────────────────────────────────────

import { z } from "zod";

import { uuidSchema, projectStatusSchema } from "./shared";

// ── Create project ──────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(1, "Project name is required.").max(255),
  projectNumber: z.string().max(50).optional(),
  description: z.string().max(5000).optional(),
  status: projectStatusSchema.default("lead"),
  // Client info
  clientName: z.string().max(255).optional(),
  clientEmail: z.string().email("Invalid email address.").max(255).optional(),
  clientPhone: z.string().max(50).optional(),
  // Address
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zip: z.string().max(20).optional(),
  // Dates
  startDate: z.string().date("Invalid date format.").optional(),
  endDate: z.string().date("Invalid date format.").optional(),
  bidDate: z.string().date("Invalid date format.").optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// ── Update project (partial) ────────────────────────────────

export const updateProjectSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1, "Project name is required.").max(255).optional(),
  projectNumber: z.string().max(50).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  status: projectStatusSchema.optional(),
  // Client info
  clientName: z.string().max(255).nullable().optional(),
  clientEmail: z.string().email("Invalid email address.").max(255).nullable().optional(),
  clientPhone: z.string().max(50).nullable().optional(),
  // Address
  addressLine1: z.string().max(255).nullable().optional(),
  addressLine2: z.string().max(255).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(50).nullable().optional(),
  zip: z.string().max(20).nullable().optional(),
  // Dates
  startDate: z.string().date("Invalid date format.").nullable().optional(),
  endDate: z.string().date("Invalid date format.").nullable().optional(),
  bidDate: z.string().date("Invalid date format.").nullable().optional(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// ── Delete project ──────────────────────────────────────────

export const deleteProjectSchema = z.object({
  id: uuidSchema,
});

export type DeleteProjectInput = z.infer<typeof deleteProjectSchema>;

// ── Get project ─────────────────────────────────────────────

export const getProjectSchema = z.object({
  id: uuidSchema,
});

export type GetProjectInput = z.infer<typeof getProjectSchema>;
