// src/lib/types/domain/nodes.ts
// ────────────────────────────────────────────────────────────
// Domain types for the estimate node tree.
//
// All types derive from the generated Supabase types as the
// single source of truth. Field names match DB columns (snake_case)
// until a mapping layer is introduced.
// ────────────────────────────────────────────────────────────

import type { Database } from "@/lib/types/supabase";

// ── Raw database row types (from supabase gen types) ────────

type DbEstimateNode = Database["public"]["Tables"]["estimate_nodes"]["Row"];
type DbNodeItemDetails = Database["public"]["Tables"]["node_item_details"]["Row"];
type DbNodeAssemblyDetails = Database["public"]["Tables"]["node_assembly_details"]["Row"];

// ── Enum re-exports for convenience ─────────────────────────

export type NodeType = Database["public"]["Enums"]["node_type"];
export type ClientVisibility = Database["public"]["Enums"]["client_visibility"];

// ── Base node fields (shared by all 3 node types) ───────────
// These come from the estimate_nodes base table.

export interface NodeBase {
  readonly id: DbEstimateNode["id"];
  readonly estimate_id: DbEstimateNode["estimate_id"];
  readonly parent_id: DbEstimateNode["parent_id"];
  readonly path: DbEstimateNode["path"];
  readonly sort_order: DbEstimateNode["sort_order"];
  readonly name: DbEstimateNode["name"];
  readonly description: DbEstimateNode["description"];
  readonly client_visibility: DbEstimateNode["client_visibility"];
  readonly total_price: DbEstimateNode["total_price"];
  readonly catalog_source_id: DbEstimateNode["catalog_source_id"];
  readonly flagged: DbEstimateNode["flagged"];
  readonly was_auto_promoted: DbEstimateNode["was_auto_promoted"];
  readonly created_at: DbEstimateNode["created_at"];
  readonly updated_at: DbEstimateNode["updated_at"];
  readonly created_by: DbEstimateNode["created_by"];
}

// ── Item detail fields ──────────────────────────────────────
// From node_item_details table (1:1 with item nodes).

export interface ItemDetails {
  readonly id: DbNodeItemDetails["id"];
  readonly node_id: DbNodeItemDetails["node_id"];
  readonly quantity: DbNodeItemDetails["quantity"];
  readonly unit_id: DbNodeItemDetails["unit_id"];
  readonly unit_cost: DbNodeItemDetails["unit_cost"];
  readonly labor_hours: DbNodeItemDetails["labor_hours"];
  readonly labor_rate: DbNodeItemDetails["labor_rate"];
  readonly labor_cost: DbNodeItemDetails["labor_cost"];
  readonly material_cost: DbNodeItemDetails["material_cost"];
  readonly equipment_cost: DbNodeItemDetails["equipment_cost"];
  readonly subcontractor_cost: DbNodeItemDetails["subcontractor_cost"];
  readonly markup_rate: DbNodeItemDetails["markup_rate"];
  readonly overhead_rate: DbNodeItemDetails["overhead_rate"];
  readonly tax_rate: DbNodeItemDetails["tax_rate"];
  readonly is_allowance: DbNodeItemDetails["is_allowance"];
  readonly allowance_budget: DbNodeItemDetails["allowance_budget"];
  readonly allowance_status: DbNodeItemDetails["allowance_status"];
  readonly vendor_id: DbNodeItemDetails["vendor_id"];
  readonly purchasing_notes: DbNodeItemDetails["purchasing_notes"];
  readonly specifications: DbNodeItemDetails["specifications"];
  readonly archived_at: DbNodeItemDetails["archived_at"];
  readonly created_at: DbNodeItemDetails["created_at"];
  readonly updated_at: DbNodeItemDetails["updated_at"];
}

// ── Assembly detail fields ──────────────────────────────────
// From node_assembly_details table (1:1 with assembly nodes).

export interface AssemblyDetails {
  readonly id: DbNodeAssemblyDetails["id"];
  readonly node_id: DbNodeAssemblyDetails["node_id"];
  readonly quantity: DbNodeAssemblyDetails["quantity"];
  readonly unit_id: DbNodeAssemblyDetails["unit_id"];
  readonly assembly_unit_cost: DbNodeAssemblyDetails["assembly_unit_cost"];
  readonly ratio_base: DbNodeAssemblyDetails["ratio_base"];
  readonly specifications: DbNodeAssemblyDetails["specifications"];
  readonly archived_at: DbNodeAssemblyDetails["archived_at"];
  readonly created_at: DbNodeAssemblyDetails["created_at"];
  readonly updated_at: DbNodeAssemblyDetails["updated_at"];
}

// ── Discriminated union ─────────────────────────────────────
// The `node_type` field is the discriminant.

export interface GroupNode extends NodeBase {
  readonly node_type: "group";
  readonly details: null;
}

export interface AssemblyNode extends NodeBase {
  readonly node_type: "assembly";
  readonly details: AssemblyDetails;
}

export interface ItemNode extends NodeBase {
  readonly node_type: "item";
  readonly details: ItemDetails;
}

export type NodeWithDetails = GroupNode | AssemblyNode | ItemNode;

// ── Tree node (with children, for client-side tree building) ─
// Uses intersection instead of extends because NodeWithDetails
// is a union type (interfaces cannot extend unions).

export type TreeNode = NodeWithDetails & {
  readonly children: TreeNode[];
};

// ── Type guards ─────────────────────────────────────────────

export function isGroupNode(node: NodeWithDetails): node is GroupNode {
  return node.node_type === "group";
}

export function isAssemblyNode(node: NodeWithDetails): node is AssemblyNode {
  return node.node_type === "assembly";
}

export function isItemNode(node: NodeWithDetails): node is ItemNode {
  return node.node_type === "item";
}

// ── Convenience: client visibility check ────────────────────

export function isClientVisible(node: NodeWithDetails): boolean {
  return node.client_visibility !== "hidden";
}
