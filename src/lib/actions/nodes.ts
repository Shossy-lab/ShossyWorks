// src/lib/actions/nodes.ts
// ────────────────────────────────────────────────────────────
// Server actions for estimate nodes (tree CRUD, move, duplicate).
// Follows the same pattern as projects.ts: authenticate,
// validate, query, return ActionResult.
// ────────────────────────────────────────────────────────────
"use server";

import { ok, err, validationError, notFound } from "@/lib/types/action-result";
import { ERROR_CODE } from "@/lib/types/action-result";
import {
  createNodeSchema,
  updateNodeSchema,
  updateItemDetailsSchema,
  updateAssemblyDetailsSchema,
  moveNodeSchema,
  duplicateNodeSchema,
} from "@/lib/validation/nodes";
import { formatZodError } from "@/lib/validation/format-error";
import { getAuthenticatedClient, handleSupabaseError } from "./_shared";

import type { ActionResult } from "@/lib/types/action-result";
import type { Database } from "@/lib/types/supabase";
import type { NodeWithDetails } from "@/lib/types/domain/nodes";

type EstimateNode = Database["public"]["Tables"]["estimate_nodes"]["Row"];
type NodeItemDetails = Database["public"]["Tables"]["node_item_details"]["Row"];
type NodeAssemblyDetails = Database["public"]["Tables"]["node_assembly_details"]["Row"];
type NodeType = Database["public"]["Enums"]["node_type"];
type ClientVisibility = Database["public"]["Enums"]["client_visibility"];

// ── Helpers ───────────────────────────────────────────────────

/**
 * Attach detail records to raw nodes, producing NodeWithDetails[].
 * Groups get `details: null`; items and assemblies get their
 * respective detail rows.
 */
function attachDetails(
  nodes: EstimateNode[],
  itemDetails: NodeItemDetails[],
  assemblyDetails: NodeAssemblyDetails[],
): NodeWithDetails[] {
  const itemMap = new Map(itemDetails.map((d) => [d.node_id, d]));
  const assemblyMap = new Map(assemblyDetails.map((d) => [d.node_id, d]));

  return nodes.map((node) => {
    if (node.node_type === "item") {
      return {
        ...node,
        node_type: "item" as const,
        details: itemMap.get(node.id) ?? null,
      } as NodeWithDetails;
    }
    if (node.node_type === "assembly") {
      return {
        ...node,
        node_type: "assembly" as const,
        details: assemblyMap.get(node.id) ?? null,
      } as NodeWithDetails;
    }
    return {
      ...node,
      node_type: "group" as const,
      details: null,
    } as NodeWithDetails;
  });
}

// ── Create ─────────────────────────────────────────────────

export async function createNode(
  input: unknown,
): Promise<ActionResult<NodeWithDetails>> {
  const { user, supabase } = await getAuthenticatedClient();

  // Validate
  const parsed = createNodeSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(
      "Invalid node data.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  // Insert base node
  const { data: node, error: nodeError } = await supabase
    .from("estimate_nodes")
    .insert({
      estimate_id: v.estimateId,
      parent_id: v.parentId ?? null,
      name: v.name,
      description: v.description ?? null,
      node_type: v.nodeType as NodeType,
      sort_order: v.sortOrder ?? 0,
      client_visibility: v.clientVisibility as ClientVisibility,
      catalog_source_id: v.catalogSourceId ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (nodeError) return handleSupabaseError(nodeError);

  // Insert type-specific detail row
  if (v.nodeType === "item") {
    const d = v.details;
    const { error: detailError } = await supabase
      .from("node_item_details")
      .insert({
        node_id: node.id,
        quantity: d.quantity,
        unit_id: d.unitId ?? null,
        unit_cost: d.unitCost,
        labor_rate: d.laborRate ?? null,
        labor_hours: d.laborHours ?? null,
        labor_cost: d.laborCost ?? null,
        material_cost: d.materialCost ?? null,
        equipment_cost: d.equipmentCost ?? null,
        subcontractor_cost: d.subcontractorCost ?? null,
        overhead_rate: d.overheadRate ?? null,
        markup_rate: d.markupRate ?? null,
        tax_rate: d.taxRate ?? null,
        is_allowance: d.isAllowance,
        allowance_budget: d.allowanceBudget ?? null,
        allowance_status: d.allowanceStatus ?? null,
        vendor_id: d.vendorId ?? null,
        purchasing_notes: d.purchasingNotes ?? null,
        specifications: d.specifications ?? null,
      });

    if (detailError) {
      // Clean up the base node if detail insert fails
      await supabase.from("estimate_nodes").delete().eq("id", node.id);
      return handleSupabaseError(detailError);
    }
  }

  if (v.nodeType === "assembly") {
    const d = v.details;
    const { error: detailError } = await supabase
      .from("node_assembly_details")
      .insert({
        node_id: node.id,
        unit_id: d.unitId ?? null,
        quantity: d.quantity ?? null,
        assembly_unit_cost: d.assemblyUnitCost ?? null,
        ratio_base: d.ratioBase ?? null,
        specifications: d.specifications ?? null,
      });

    if (detailError) {
      await supabase.from("estimate_nodes").delete().eq("id", node.id);
      return handleSupabaseError(detailError);
    }
  }

  // Re-fetch with details attached
  return getNode(node.id);
}

// ── Read (list by estimate) ───────────────────────────────

export async function getNodes(
  estimateId: string,
): Promise<ActionResult<NodeWithDetails[]>> {
  const { supabase } = await getAuthenticatedClient();

  if (!estimateId) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Estimate ID is required.");
  }

  // Fetch all base nodes for this estimate
  const { data: nodes, error: nodesError } = await supabase
    .from("estimate_nodes")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("sort_order", { ascending: true });

  if (nodesError) return handleSupabaseError(nodesError);

  if (!nodes || nodes.length === 0) {
    return ok([]);
  }

  const nodeIds = nodes.map((n) => n.id);

  // Fetch item and assembly details in parallel
  const [itemResult, assemblyResult] = await Promise.all([
    supabase
      .from("node_item_details")
      .select("*")
      .in("node_id", nodeIds),
    supabase
      .from("node_assembly_details")
      .select("*")
      .in("node_id", nodeIds),
  ]);

  if (itemResult.error) return handleSupabaseError(itemResult.error);
  if (assemblyResult.error) return handleSupabaseError(assemblyResult.error);

  return ok(attachDetails(nodes, itemResult.data ?? [], assemblyResult.data ?? []));
}

// ── Read (single) ──────────────────────────────────────────

export async function getNode(
  id: string,
): Promise<ActionResult<NodeWithDetails>> {
  const { supabase } = await getAuthenticatedClient();

  if (!id) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Node ID is required.");
  }

  const { data: node, error: nodeError } = await supabase
    .from("estimate_nodes")
    .select("*")
    .eq("id", id)
    .single();

  if (nodeError) return handleSupabaseError(nodeError);

  // Fetch the appropriate detail row based on node_type
  if (node.node_type === "item") {
    const { data: details, error: detailError } = await supabase
      .from("node_item_details")
      .select("*")
      .eq("node_id", id)
      .single();

    if (detailError) return handleSupabaseError(detailError);

    return ok({
      ...node,
      node_type: "item" as const,
      details,
    } as NodeWithDetails);
  }

  if (node.node_type === "assembly") {
    const { data: details, error: detailError } = await supabase
      .from("node_assembly_details")
      .select("*")
      .eq("node_id", id)
      .single();

    if (detailError) return handleSupabaseError(detailError);

    return ok({
      ...node,
      node_type: "assembly" as const,
      details,
    } as NodeWithDetails);
  }

  // Group nodes have no details
  return ok({
    ...node,
    node_type: "group" as const,
    details: null,
  } as NodeWithDetails);
}

// ── Update (base node fields) ──────────────────────────────

export async function updateNode(
  id: string,
  input: unknown,
): Promise<ActionResult<NodeWithDetails>> {
  const { supabase } = await getAuthenticatedClient();

  const parsed = updateNodeSchema.safeParse({ ...Object(input), id });
  if (!parsed.success) {
    return validationError(
      "Invalid node data.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  // Build update payload — only include fields that were provided
  const updates: Database["public"]["Tables"]["estimate_nodes"]["Update"] = {};

  if (v.name !== undefined) updates.name = v.name;
  if (v.description !== undefined) updates.description = v.description;
  if (v.sortOrder !== undefined) updates.sort_order = v.sortOrder;
  if (v.clientVisibility !== undefined) {
    updates.client_visibility = v.clientVisibility as ClientVisibility;
  }
  if (v.flagged !== undefined) updates.flagged = v.flagged;

  const { data, error } = await supabase
    .from("estimate_nodes")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return handleSupabaseError(error);

  // Re-fetch with details attached
  return getNode(data.id);
}

// ── Update item details ────────────────────────────────────

export async function updateItemDetails(
  nodeId: string,
  input: unknown,
): Promise<ActionResult<NodeWithDetails>> {
  const { supabase } = await getAuthenticatedClient();

  const parsed = updateItemDetailsSchema.safeParse({ ...Object(input), nodeId });
  if (!parsed.success) {
    return validationError(
      "Invalid item details.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  const updates: Database["public"]["Tables"]["node_item_details"]["Update"] = {};

  if (v.quantity !== undefined) updates.quantity = v.quantity;
  if (v.unitId !== undefined) updates.unit_id = v.unitId;
  if (v.unitCost !== undefined) updates.unit_cost = v.unitCost;
  if (v.laborRate !== undefined) updates.labor_rate = v.laborRate;
  if (v.laborHours !== undefined) updates.labor_hours = v.laborHours;
  if (v.laborCost !== undefined) updates.labor_cost = v.laborCost;
  if (v.materialCost !== undefined) updates.material_cost = v.materialCost;
  if (v.equipmentCost !== undefined) updates.equipment_cost = v.equipmentCost;
  if (v.subcontractorCost !== undefined) updates.subcontractor_cost = v.subcontractorCost;
  if (v.overheadRate !== undefined) updates.overhead_rate = v.overheadRate;
  if (v.markupRate !== undefined) updates.markup_rate = v.markupRate;
  if (v.taxRate !== undefined) updates.tax_rate = v.taxRate;
  if (v.isAllowance !== undefined) updates.is_allowance = v.isAllowance;
  if (v.allowanceBudget !== undefined) updates.allowance_budget = v.allowanceBudget;
  if (v.allowanceStatus !== undefined) updates.allowance_status = v.allowanceStatus;
  if (v.vendorId !== undefined) updates.vendor_id = v.vendorId;
  if (v.purchasingNotes !== undefined) updates.purchasing_notes = v.purchasingNotes;
  if (v.specifications !== undefined) updates.specifications = v.specifications;

  const { error } = await supabase
    .from("node_item_details")
    .update(updates)
    .eq("node_id", nodeId);

  if (error) return handleSupabaseError(error);

  return getNode(nodeId);
}

// ── Update assembly details ────────────────────────────────

export async function updateAssemblyDetails(
  nodeId: string,
  input: unknown,
): Promise<ActionResult<NodeWithDetails>> {
  const { supabase } = await getAuthenticatedClient();

  const parsed = updateAssemblyDetailsSchema.safeParse({ ...Object(input), nodeId });
  if (!parsed.success) {
    return validationError(
      "Invalid assembly details.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  const updates: Database["public"]["Tables"]["node_assembly_details"]["Update"] = {};

  if (v.unitId !== undefined) updates.unit_id = v.unitId;
  if (v.quantity !== undefined) updates.quantity = v.quantity;
  if (v.assemblyUnitCost !== undefined) updates.assembly_unit_cost = v.assemblyUnitCost;
  if (v.ratioBase !== undefined) updates.ratio_base = v.ratioBase;
  if (v.specifications !== undefined) updates.specifications = v.specifications;

  const { error } = await supabase
    .from("node_assembly_details")
    .update(updates)
    .eq("node_id", nodeId);

  if (error) return handleSupabaseError(error);

  return getNode(nodeId);
}

// ── Move node ──────────────────────────────────────────────

export async function moveNode(
  input: unknown,
): Promise<ActionResult<NodeWithDetails>> {
  const { supabase } = await getAuthenticatedClient();

  const parsed = moveNodeSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(
      "Invalid move data.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  // Update parent_id and sort_order; the DB trigger handles ltree path
  const { data, error } = await supabase
    .from("estimate_nodes")
    .update({
      parent_id: v.newParentId,
      sort_order: v.newSortOrder,
    })
    .eq("id", v.id)
    .select()
    .single();

  if (error) return handleSupabaseError(error);

  return getNode(data.id);
}

// ── Delete ─────────────────────────────────────────────────

export async function deleteNode(
  id: string,
): Promise<ActionResult<void>> {
  const { supabase } = await getAuthenticatedClient();

  if (!id) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Node ID is required.");
  }

  // Hard delete — CASCADE handles children, details, notes
  const { error } = await supabase
    .from("estimate_nodes")
    .delete()
    .eq("id", id);

  if (error) return handleSupabaseError(error);

  return ok();
}

// ── Duplicate ──────────────────────────────────────────────

export async function duplicateNode(
  nodeId: string,
  includeNotes: boolean = true,
): Promise<ActionResult<NodeWithDetails>> {
  const { user, supabase } = await getAuthenticatedClient();

  if (!nodeId) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Node ID is required.");
  }

  // Fetch the source node with details
  const sourceResult = await getNode(nodeId);
  if (!sourceResult.success) return sourceResult;
  const source = sourceResult.data;

  // Insert duplicate base node
  const { data: newNode, error: nodeError } = await supabase
    .from("estimate_nodes")
    .insert({
      estimate_id: source.estimate_id,
      parent_id: source.parent_id,
      name: `${source.name} (copy)`,
      description: source.description,
      node_type: source.node_type as NodeType,
      sort_order: source.sort_order + 1,
      client_visibility: source.client_visibility as ClientVisibility,
      catalog_source_id: source.catalog_source_id,
      flagged: source.flagged,
      created_by: user.id,
    })
    .select()
    .single();

  if (nodeError) return handleSupabaseError(nodeError);

  // Duplicate detail row if applicable
  if (source.node_type === "item" && source.details) {
    const d = source.details;
    const { error: detailError } = await supabase
      .from("node_item_details")
      .insert({
        node_id: newNode.id,
        quantity: d.quantity,
        unit_id: d.unit_id,
        unit_cost: d.unit_cost,
        labor_rate: d.labor_rate,
        labor_hours: d.labor_hours,
        labor_cost: d.labor_cost,
        material_cost: d.material_cost,
        equipment_cost: d.equipment_cost,
        subcontractor_cost: d.subcontractor_cost,
        overhead_rate: d.overhead_rate,
        markup_rate: d.markup_rate,
        tax_rate: d.tax_rate,
        is_allowance: d.is_allowance,
        allowance_budget: d.allowance_budget,
        allowance_status: d.allowance_status,
        vendor_id: d.vendor_id,
        purchasing_notes: d.purchasing_notes,
        specifications: d.specifications,
      });

    if (detailError) {
      await supabase.from("estimate_nodes").delete().eq("id", newNode.id);
      return handleSupabaseError(detailError);
    }
  }

  if (source.node_type === "assembly" && source.details) {
    const d = source.details;
    const { error: detailError } = await supabase
      .from("node_assembly_details")
      .insert({
        node_id: newNode.id,
        unit_id: d.unit_id,
        quantity: d.quantity,
        assembly_unit_cost: d.assembly_unit_cost,
        ratio_base: d.ratio_base,
        specifications: d.specifications,
      });

    if (detailError) {
      await supabase.from("estimate_nodes").delete().eq("id", newNode.id);
      return handleSupabaseError(detailError);
    }
  }

  // Duplicate notes if requested
  if (includeNotes) {
    const { data: notes, error: notesError } = await supabase
      .from("node_notes")
      .select("*")
      .eq("node_id", nodeId);

    if (!notesError && notes && notes.length > 0) {
      const noteInserts = notes.map((note) => ({
        node_id: newNode.id,
        body: note.body,
        format: note.format,
        is_internal: note.is_internal,
        is_client_visible: note.is_client_visible,
        created_by: user.id,
      }));

      await supabase.from("node_notes").insert(noteInserts);
      // Note duplication failure is non-fatal; we still return the new node
    }
  }

  return getNode(newNode.id);
}

// ── Flag node ──────────────────────────────────────────────

export async function flagNode(
  id: string,
  flagged: boolean,
): Promise<ActionResult<NodeWithDetails>> {
  const { supabase } = await getAuthenticatedClient();

  if (!id) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Node ID is required.");
  }

  const { error } = await supabase
    .from("estimate_nodes")
    .update({ flagged })
    .eq("id", id);

  if (error) return handleSupabaseError(error);

  return getNode(id);
}

// ── Set node visibility ────────────────────────────────────

export async function setNodeVisibility(
  id: string,
  visibility: string,
  applyToChildren: boolean = false,
): Promise<ActionResult<NodeWithDetails>> {
  const { supabase } = await getAuthenticatedClient();

  if (!id) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Node ID is required.");
  }

  const validVisibilities: ClientVisibility[] = ["visible", "hidden", "summary_only"];
  if (!validVisibilities.includes(visibility as ClientVisibility)) {
    return validationError("Invalid visibility value.");
  }

  if (applyToChildren) {
    // Use the set_subtree_visibility RPC
    const { error } = await supabase.rpc("set_subtree_visibility", {
      p_node_id: id,
      p_visibility: visibility as ClientVisibility,
    });

    if (error) return handleSupabaseError(error);
  } else {
    // Update only the single node
    const { error } = await supabase
      .from("estimate_nodes")
      .update({ client_visibility: visibility as ClientVisibility })
      .eq("id", id);

    if (error) return handleSupabaseError(error);
  }

  return getNode(id);
}
