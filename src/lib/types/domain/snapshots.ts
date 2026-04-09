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
// This is the typed shape of the `snapshot_data` JSONB column.
// `schema_version` enables forward-compatible migrations.

export interface SnapshotData {
  readonly schema_version: number;
  readonly estimate_name: string;
  readonly estimate_status: string;
  readonly nodes: ReadonlyArray<SnapshotNodeRecord>;
  readonly notes: ReadonlyArray<SnapshotNoteRecord>;
  readonly option_groups: ReadonlyArray<SnapshotOptionGroupRecord>;
  readonly option_alternatives: ReadonlyArray<SnapshotOptionAlternativeRecord>;
  readonly option_memberships: ReadonlyArray<SnapshotOptionMembershipRecord>;
}

// ── Snapshot sub-records (flat, serializable) ───────────────
// These mirror DB rows but with stable, versionable shapes.
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
  readonly total_price: number | null;
  readonly flagged: boolean;
  readonly catalog_source_id: string | null;
  readonly item_details: SnapshotItemDetails | null;
  readonly assembly_details: SnapshotAssemblyDetails | null;
}

export interface SnapshotItemDetails {
  readonly quantity: number | null;
  readonly unit_id: string | null;
  readonly unit_cost: number | null;
  readonly labor_hours: number | null;
  readonly labor_rate: number | null;
  readonly labor_cost: number | null;
  readonly material_cost: number | null;
  readonly equipment_cost: number | null;
  readonly subcontractor_cost: number | null;
  readonly markup_rate: number | null;
  readonly overhead_rate: number | null;
  readonly tax_rate: number | null;
  readonly is_allowance: boolean;
  readonly allowance_budget: number | null;
  readonly allowance_status: string | null;
  readonly vendor_id: string | null;
  readonly specifications: string | null;
}

export interface SnapshotAssemblyDetails {
  readonly quantity: number | null;
  readonly unit_id: string | null;
  readonly assembly_unit_cost: number | null;
  readonly ratio_base: string | null;
  readonly specifications: string | null;
}

export interface SnapshotNoteRecord {
  readonly id: string;
  readonly node_id: string;
  readonly body: string;
  readonly is_internal: boolean;
}

export interface SnapshotOptionGroupRecord {
  readonly id: string;
  readonly anchor_node_id: string;
  readonly name: string;
  readonly description: string | null;
}

export interface SnapshotOptionAlternativeRecord {
  readonly id: string;
  readonly option_group_id: string;
  readonly name: string;
  readonly is_selected: boolean;
  readonly sort_order: number;
}

export interface SnapshotOptionMembershipRecord {
  readonly node_id: string;
  readonly option_alternative_id: string;
}

// ── Branded FrozenNode type ─────────────────────────────────
// Prevents accidentally passing snapshot node data into
// mutation paths that expect live data. The brand is a
// compile-time-only marker with zero runtime cost.

declare const SNAPSHOT_BRAND: unique symbol;

export type FrozenNode = Readonly<NodeWithDetails> & {
  readonly [SNAPSHOT_BRAND]: true;
};
