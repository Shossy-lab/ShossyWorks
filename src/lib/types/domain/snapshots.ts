// src/lib/types/domain/snapshots.ts
// ────────────────────────────────────────────────────────────
// Domain types for estimate snapshots.
//
// EstimateSnapshot derives from the generated Supabase row type.
// SnapshotData defines the typed structure of the JSONB blob.
// FrozenNode is a branded Readonly<NodeWithDetails> to prevent
// accidentally passing snapshot data into mutation paths.
// ────────────────────────────────────────────────────────────

import type { Database } from "@/lib/types/supabase";

import type { NodeWithDetails } from "./nodes";

// ── Raw database row type ───────────────────────────────────

type DbEstimateSnapshot = Database["public"]["Tables"]["estimate_snapshots"]["Row"];

// ── Enum re-exports for convenience ─────────────────────────

export type SnapshotType = Database["public"]["Enums"]["snapshot_type"];
export type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
export type ProjectStatus = Database["public"]["Enums"]["project_status"];

// ── EstimateSnapshot (metadata row from estimate_snapshots) ─

export interface EstimateSnapshot {
  readonly id: DbEstimateSnapshot["id"];
  readonly estimate_id: DbEstimateSnapshot["estimate_id"];
  readonly name: DbEstimateSnapshot["name"];
  readonly description: DbEstimateSnapshot["description"];
  readonly snapshot_type: DbEstimateSnapshot["snapshot_type"];
  readonly estimate_status_at_time: DbEstimateSnapshot["estimate_status_at_time"];
  readonly project_status_at_time: DbEstimateSnapshot["project_status_at_time"];
  readonly snapshot_data: SnapshotData;
  readonly node_count: DbEstimateSnapshot["node_count"];
  readonly total_price: DbEstimateSnapshot["total_price"];
  readonly schema_version: DbEstimateSnapshot["schema_version"];
  readonly created_at: DbEstimateSnapshot["created_at"];
  readonly created_by: DbEstimateSnapshot["created_by"];
}

// ── Snapshot JSONB payload structure ─────────────────────────
// This is the typed shape of the `snapshot_data` JSONB column
// as produced by `create_estimate_snapshot()` in SQL.
// `schema_version` enables forward-compatible migrations.
// Each sub-table is serialized as a top-level array, NOT nested
// inside node records. Details are joined by node_id at read time.

export interface SnapshotData {
  readonly schema_version: number;
  readonly serialized_at: string;
  readonly nodes: ReadonlyArray<SnapshotNodeRecord>;
  readonly item_details: ReadonlyArray<SnapshotItemDetailRecord>;
  readonly assembly_details: ReadonlyArray<SnapshotAssemblyDetailRecord>;
  readonly node_notes: ReadonlyArray<SnapshotNoteRecord>;
  readonly option_groups: ReadonlyArray<SnapshotOptionGroupRecord>;
  readonly option_alternatives: ReadonlyArray<SnapshotOptionAlternativeRecord>;
  readonly option_memberships: ReadonlyArray<SnapshotOptionMembershipRecord>;
  readonly option_sets: ReadonlyArray<SnapshotOptionSetRecord>;
  readonly option_set_selections: ReadonlyArray<SnapshotOptionSetSelectionRecord>;
  readonly broad_options: ReadonlyArray<SnapshotBroadOptionRecord>;
  readonly broad_option_overrides: ReadonlyArray<SnapshotBroadOptionOverrideRecord>;
  readonly option_set_broad_selections: ReadonlyArray<SnapshotOptionSetBroadSelectionRecord>;
}

// ── Snapshot sub-records (flat, serializable) ───────────────
// These mirror DB rows as serialized by the SQL function.
// Wider string types where noted for forward compatibility --
// old snapshots still parse if new enum values are added.

export interface SnapshotNodeRecord {
  readonly id: string;
  readonly parent_id: string | null;
  readonly sort_order: number;
  readonly node_type: "group" | "assembly" | "item";
  readonly name: string;
  readonly description: string | null;
  readonly client_visibility: "visible" | "hidden" | "summary_only";
  readonly flagged: boolean;
  readonly was_auto_promoted: boolean;
  readonly catalog_source_id: string | null;
  readonly total_price: number | null;
  readonly created_by: string | null;
  readonly created_at: string;
}

export interface SnapshotItemDetailRecord {
  readonly id: string;
  readonly node_id: string;
  readonly quantity: number | null;
  readonly unit_id: string | null;
  readonly unit_cost: number | null;
  readonly material_cost: number | null;
  readonly labor_cost: number | null;
  readonly labor_hours: number | null;
  readonly labor_rate: number | null;
  readonly equipment_cost: number | null;
  readonly subcontractor_cost: number | null;
  readonly markup_rate: number | null;
  readonly overhead_rate: number | null;
  readonly tax_rate: number | null;
  readonly is_allowance: boolean;
  readonly allowance_budget: number | null;
  readonly allowance_status: string | null;
  readonly specifications: string | null;
  readonly purchasing_notes: string | null;
  readonly vendor_id: string | null;
  readonly archived_at: string | null;
}

export interface SnapshotAssemblyDetailRecord {
  readonly id: string;
  readonly node_id: string;
  readonly quantity: number | null;
  readonly unit_id: string | null;
  readonly assembly_unit_cost: number | null;
  readonly ratio_base: string | null;
  readonly specifications: string | null;
  readonly archived_at: string | null;
}

export interface SnapshotNoteRecord {
  readonly id: string;
  readonly node_id: string;
  readonly body: string;
  readonly format: string;
  readonly is_internal: boolean;
  readonly is_client_visible: boolean;
  readonly created_by: string | null;
  readonly created_at: string;
}

export interface SnapshotOptionGroupRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly group_type: string;
  readonly sort_order: number;
  readonly created_at: string;
}

export interface SnapshotOptionAlternativeRecord {
  readonly id: string;
  readonly group_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly is_selected: boolean;
  readonly price_adjustment: number | null;
  readonly sort_order: number;
}

export interface SnapshotOptionMembershipRecord {
  readonly id: string;
  readonly node_id: string;
  readonly alternative_id: string;
}

export interface SnapshotOptionSetRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly created_by: string | null;
}

export interface SnapshotOptionSetSelectionRecord {
  readonly id: string;
  readonly option_set_id: string;
  readonly alternative_id: string;
}

export interface SnapshotBroadOptionRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly sort_order: number;
}

export interface SnapshotBroadOptionOverrideRecord {
  readonly id: string;
  readonly broad_option_id: string;
  readonly target_node_id: string;
  readonly override_type: string;
  readonly override_value: number | null;
}

export interface SnapshotOptionSetBroadSelectionRecord {
  readonly option_set_id: string;
  readonly broad_option_id: string;
}

// ── Branded FrozenNode type ─────────────────────────────────
// Prevents accidentally passing snapshot node data into
// mutation paths that expect live data. The brand is a
// compile-time-only marker with zero runtime cost.

declare const SNAPSHOT_BRAND: unique symbol;

export type FrozenNode = Readonly<NodeWithDetails> & {
  readonly [SNAPSHOT_BRAND]: true;
};
