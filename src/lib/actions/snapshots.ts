// src/lib/actions/snapshots.ts
// ────────────────────────────────────────────────────────────
// Server actions for estimate snapshots.
// Follows the reference pattern: authenticate, validate, query, return.
// ────────────────────────────────────────────────────────────
"use server";

import { ok, err, validationError, notFound, forbidden } from "@/lib/types/action-result";
import { ERROR_CODE } from "@/lib/types/action-result";
import { createSnapshotSchema, restoreSnapshotSchema } from "@/lib/validation/snapshots";
import { formatZodError } from "@/lib/validation/format-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedClient, handleSupabaseError } from "./_shared";

import type { ActionResult } from "@/lib/types/action-result";
import type { Database } from "@/lib/types/supabase";

type EstimateSnapshotRow = Database["public"]["Tables"]["estimate_snapshots"]["Row"];

// Metadata-only type excludes the large snapshot_data JSONB column.
type SnapshotMeta = Omit<EstimateSnapshotRow, "snapshot_data">;

// ── Create ─────────────────────────────────────────────────

export async function createSnapshot(
  input: unknown,
): Promise<ActionResult<EstimateSnapshotRow>> {
  const { user, supabase } = await getAuthenticatedClient();

  // Validate
  const parsed = createSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(
      "Invalid snapshot data.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  // Call RPC — returns the new snapshot ID
  const { data: snapshotId, error: rpcError } = await supabase.rpc(
    "create_estimate_snapshot",
    {
      p_estimate_id: v.estimateId,
      p_name: v.name,
      p_snapshot_type: v.snapshotType,
      p_created_by: user.id,
    },
  );

  if (rpcError) return handleSupabaseError(rpcError);
  if (!snapshotId) return err(ERROR_CODE.SERVER_ERROR, "Snapshot creation returned no ID.");

  // Update description if provided (RPC doesn't accept it)
  if (v.description) {
    const { error: updateError } = await supabase
      .from("estimate_snapshots")
      .update({ description: v.description })
      .eq("id", snapshotId);

    if (updateError) {
      console.error("Failed to set snapshot description:", updateError);
      // Non-fatal — snapshot was still created
    }
  }

  // Fetch the full snapshot to return
  const { data, error } = await supabase
    .from("estimate_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .single();

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── List (metadata only, no snapshot_data) ─────────────────

export async function listSnapshots(
  estimateId: string,
): Promise<ActionResult<SnapshotMeta[]>> {
  const { supabase } = await getAuthenticatedClient();

  if (!estimateId) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Estimate ID is required.");
  }

  const { data, error } = await supabase
    .from("estimate_snapshots")
    .select(
      "id, estimate_id, name, description, snapshot_type, estimate_status_at_time, project_status_at_time, node_count, total_price, schema_version, created_at, created_by",
    )
    .eq("estimate_id", estimateId)
    .order("created_at", { ascending: false });

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── Get (single, full data) ────────────────────────────────

export async function getSnapshot(
  id: string,
): Promise<ActionResult<EstimateSnapshotRow>> {
  const { supabase } = await getAuthenticatedClient();

  if (!id) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Snapshot ID is required.");
  }

  const { data, error } = await supabase
    .from("estimate_snapshots")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── Restore ────────────────────────────────────────────────

export async function restoreSnapshot(
  input: unknown,
): Promise<ActionResult<string>> {
  const { user, supabase } = await getAuthenticatedClient();

  // Validate
  const parsed = restoreSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(
      "Invalid restore data.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  // Call RPC — returns the auto-checkpoint snapshot ID
  const { data: checkpointId, error } = await supabase.rpc(
    "restore_estimate_snapshot",
    {
      p_snapshot_id: v.snapshotId,
      p_restored_by: user.id,
    },
  );

  if (error) {
    // Handle optimistic lock / version mismatch from the RPC
    if (error.message?.includes("version") || error.message?.includes("modified")) {
      return err(
        ERROR_CODE.OPTIMISTIC_LOCK_FAILED,
        "This estimate was modified since you last loaded it. Please refresh and try again.",
      );
    }
    return handleSupabaseError(error);
  }

  if (!checkpointId) return err(ERROR_CODE.SERVER_ERROR, "Restore returned no checkpoint ID.");
  return ok(checkpointId);
}

// ── Create estimate from snapshot ──────────────────────────

export async function createEstimateFromSnapshot(
  snapshotId: string,
  newName: string,
): Promise<ActionResult<string>> {
  const { user, supabase } = await getAuthenticatedClient();

  if (!snapshotId) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Snapshot ID is required.");
  }
  if (!newName || !newName.trim()) {
    return err(ERROR_CODE.VALIDATION_ERROR, "New estimate name is required.");
  }

  // Call RPC — returns the new estimate ID
  const { data: estimateId, error } = await supabase.rpc(
    "create_estimate_from_snapshot",
    {
      p_snapshot_id: snapshotId,
      p_new_name: newName.trim(),
      p_created_by: user.id,
    },
  );

  if (error) return handleSupabaseError(error);
  if (!estimateId) return err(ERROR_CODE.SERVER_ERROR, "Create from snapshot returned no estimate ID.");
  return ok(estimateId);
}

// ── Delete (milestones only, via admin client) ─────────────

export async function deleteSnapshot(
  id: string,
): Promise<ActionResult<void>> {
  const { user, supabase } = await getAuthenticatedClient();

  if (!id) {
    return err(ERROR_CODE.VALIDATION_ERROR, "Snapshot ID is required.");
  }

  // Fetch snapshot to verify type and ownership
  const { data: snapshot, error: fetchError } = await supabase
    .from("estimate_snapshots")
    .select("id, snapshot_type, created_by")
    .eq("id", id)
    .single();

  if (fetchError) return handleSupabaseError(fetchError);

  // Only milestones can be deleted — checkpoints are system-managed
  if (snapshot.snapshot_type !== "milestone") {
    return err(
      ERROR_CODE.FORBIDDEN,
      "Only milestone snapshots can be deleted. Checkpoints are system-managed.",
    );
  }

  // Verify the caller is the owner
  if (snapshot.created_by !== user.id) {
    return forbidden();
  }

  // Use admin client to bypass the immutability trigger
  const admin = createAdminClient();
  const { error: deleteError } = await admin
    .from("estimate_snapshots")
    .delete()
    .eq("id", id);

  if (deleteError) {
    console.error("Admin delete snapshot error:", deleteError);
    return err(ERROR_CODE.SERVER_ERROR, "Failed to delete snapshot.");
  }

  return ok();
}
