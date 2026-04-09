// src/lib/validation/nodes.ts
// ────────────────────────────────────────────────────────────
// Zod schemas for estimate node server action inputs.
// Uses discriminated union for create to enforce type-specific
// detail requirements (items need item details, etc.).
// ────────────────────────────────────────────────────────────

import { z } from "zod";

import {
  uuidSchema,
  nodeTypeSchema,
  clientVisibilitySchema,
  costTypeSchema,
  qtyModeSchema,
  bidTypeSchema,
  allowanceStatusSchema,
  sortOrderSchema,
  rateSchema,
} from "./shared";

// ── Item details sub-schema ──────────────────────────────────

const itemDetailsSchema = z.object({
  quantity: z.number().min(0).default(0),
  unitId: uuidSchema.nullable().optional(),
  unitCost: z.number().min(0).default(0),
  laborRate: z.number().min(0).nullable().optional(),
  laborHours: z.number().min(0).nullable().optional(),
  laborCost: z.number().min(0).nullable().optional(),
  materialCost: z.number().min(0).nullable().optional(),
  equipmentCost: z.number().min(0).nullable().optional(),
  subcontractorCost: z.number().min(0).nullable().optional(),
  overheadRate: rateSchema.nullable().optional(),
  markupRate: rateSchema.nullable().optional(),
  taxRate: rateSchema.nullable().optional(),
  isAllowance: z.boolean().default(false),
  allowanceBudget: z.number().min(0).nullable().optional(),
  allowanceStatus: allowanceStatusSchema.nullable().optional(),
  vendorId: uuidSchema.nullable().optional(),
  purchasingNotes: z.string().nullable().optional(),
  specifications: z.string().nullable().optional(),
});

export type ItemDetailsInput = z.infer<typeof itemDetailsSchema>;

// ── Assembly details sub-schema ──────────────────────────────

const assemblyDetailsSchema = z.object({
  unitId: uuidSchema.nullable().optional(),
  quantity: z.number().min(0).nullable().optional(),
  assemblyUnitCost: z.number().min(0).nullable().optional(),
  ratioBase: z.string().nullable().optional(),
  specifications: z.string().nullable().optional(),
});

export type AssemblyDetailsInput = z.infer<typeof assemblyDetailsSchema>;

// ── Shared base fields for node creation ─────────────────────

const nodeBaseFields = {
  estimateId: uuidSchema,
  name: z.string().min(1, "Node name is required.").max(255),
  description: z.string().max(5000).nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
  clientVisibility: clientVisibilitySchema.default("visible"),
  catalogSourceId: uuidSchema.nullable().optional(),
} as const;

// ── Create node (discriminated union on nodeType) ────────────

export const createNodeSchema = z.discriminatedUnion("nodeType", [
  z.object({
    nodeType: z.literal("group"),
    parentId: uuidSchema.nullable(),
    ...nodeBaseFields,
  }),
  z.object({
    nodeType: z.literal("assembly"),
    parentId: uuidSchema, // assemblies cannot be root
    ...nodeBaseFields,
    details: assemblyDetailsSchema,
  }),
  z.object({
    nodeType: z.literal("item"),
    parentId: uuidSchema, // items cannot be root
    ...nodeBaseFields,
    details: itemDetailsSchema,
  }),
]);

export type CreateNodeInput = z.infer<typeof createNodeSchema>;

// ── Convenience: create item node ────────────────────────────

export const createItemNodeSchema = z.object({
  nodeType: z.literal("item"),
  estimateId: uuidSchema,
  parentId: uuidSchema,
  name: z.string().min(1, "Node name is required.").max(255),
  description: z.string().max(5000).nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
  clientVisibility: clientVisibilitySchema.default("visible"),
  catalogSourceId: uuidSchema.nullable().optional(),
  details: itemDetailsSchema,
});

export type CreateItemNodeInput = z.infer<typeof createItemNodeSchema>;

// ── Convenience: create assembly node ────────────────────────

export const createAssemblyNodeSchema = z.object({
  nodeType: z.literal("assembly"),
  estimateId: uuidSchema,
  parentId: uuidSchema,
  name: z.string().min(1, "Node name is required.").max(255),
  description: z.string().max(5000).nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
  clientVisibility: clientVisibilitySchema.default("visible"),
  catalogSourceId: uuidSchema.nullable().optional(),
  details: assemblyDetailsSchema,
});

export type CreateAssemblyNodeInput = z.infer<typeof createAssemblyNodeSchema>;

// ── Update node (base fields only) ──────────────────────────

export const updateNodeSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1, "Node name is required.").max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  sortOrder: sortOrderSchema.optional(),
  clientVisibility: clientVisibilitySchema.optional(),
  flagged: z.boolean().optional(),
});

export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;

// ── Update item details ──────────────────────────────────────

export const updateItemDetailsSchema = z.object({
  nodeId: uuidSchema,
  ...itemDetailsSchema.shape,
});

export type UpdateItemDetailsInput = z.infer<typeof updateItemDetailsSchema>;

// ── Update assembly details ──────────────────────────────────

export const updateAssemblyDetailsSchema = z.object({
  nodeId: uuidSchema,
  ...assemblyDetailsSchema.shape,
});

export type UpdateAssemblyDetailsInput = z.infer<typeof updateAssemblyDetailsSchema>;

// ── Delete node ─────────────────────────────────────────────

export const deleteNodeSchema = z.object({
  id: uuidSchema,
});

export type DeleteNodeInput = z.infer<typeof deleteNodeSchema>;

// ── Move node ───────────────────────────────────────────────

export const moveNodeSchema = z.object({
  id: uuidSchema,
  newParentId: uuidSchema.nullable(),
  newSortOrder: sortOrderSchema,
});

export type MoveNodeInput = z.infer<typeof moveNodeSchema>;

// ── Duplicate node ──────────────────────────────────────────

export const duplicateNodeSchema = z.object({
  sourceNodeId: uuidSchema,
  includeChildren: z.boolean().default(true),
  includeNotes: z.boolean().default(true),
  includeDetails: z.boolean().default(true),
});

export type DuplicateNodeInput = z.infer<typeof duplicateNodeSchema>;

// ── Convert node type ───────────────────────────────────────

export const convertNodeTypeSchema = z.object({
  nodeId: uuidSchema,
  targetType: nodeTypeSchema,
  assemblyDetails: assemblyDetailsSchema.optional(),
});

export type ConvertNodeTypeInput = z.infer<typeof convertNodeTypeSchema>;

// ── Batch reorder siblings ──────────────────────────────────

export const reorderSiblingsSchema = z.object({
  parentId: uuidSchema.nullable(),
  estimateId: uuidSchema,
  orderedNodeIds: z.array(uuidSchema).min(1),
});

export type ReorderSiblingsInput = z.infer<typeof reorderSiblingsSchema>;
