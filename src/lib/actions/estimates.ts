// src/lib/actions/estimates.ts
// ────────────────────────────────────────────────────────────
// Server actions for estimates.
// Follows the reference pattern in projects.ts:
// authenticate -> validate -> query -> handle error -> return.
// ────────────────────────────────────────────────────────────
"use server";

import { ok, validationError, optimisticLockFailed } from "@/lib/types/action-result";
import {
  createEstimateSchema,
  updateEstimateSchema,
  listEstimatesSchema,
  getEstimateSchema,
  deleteEstimateSchema,
} from "@/lib/validation/estimates";
import { uuidSchema } from "@/lib/validation/shared";
import { formatZodError } from "@/lib/validation/format-error";
import { getAuthenticatedClient, handleSupabaseError } from "./_shared";

import type { ActionResult } from "@/lib/types/action-result";
import type { Database } from "@/lib/types/supabase";

type Estimate = Database["public"]["Tables"]["estimates"]["Row"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];

// ── Create ─────────────────────────────────────────────────

export async function createEstimate(
  input: unknown,
): Promise<ActionResult<Estimate>> {
  const { user, supabase } = await getAuthenticatedClient();

  // Validate
  const parsed = createEstimateSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(
      "Invalid estimate data.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  // Insert
  const { data, error } = await supabase
    .from("estimates")
    .insert({
      project_id: v.projectId,
      name: v.name,
      description: v.description ?? null,
      status: v.status as EstimateStatus,
      default_contingency_rate: v.defaultContingencyRate,
      default_overhead_rate: v.defaultOverheadRate,
      default_markup_rate: v.defaultMarkupRate,
      default_tax_rate: v.defaultTaxRate,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── Read (list by project) ────────────────────────────────

export async function getEstimates(
  projectId: string,
): Promise<ActionResult<Estimate[]>> {
  const { supabase } = await getAuthenticatedClient();

  // Validate
  const parsed = listEstimatesSchema.safeParse({ projectId });
  if (!parsed.success) {
    return validationError(
      "Invalid project ID.",
      formatZodError(parsed.error),
    );
  }

  const { data, error } = await supabase
    .from("estimates")
    .select("*")
    .eq("project_id", parsed.data.projectId)
    .order("updated_at", { ascending: false });

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── Read (single) ──────────────────────────────────────────

export async function getEstimate(
  id: string,
): Promise<ActionResult<Estimate>> {
  const { supabase } = await getAuthenticatedClient();

  // Validate
  const parsed = getEstimateSchema.safeParse({ id });
  if (!parsed.success) {
    return validationError(
      "Invalid estimate ID.",
      formatZodError(parsed.error),
    );
  }

  const { data, error } = await supabase
    .from("estimates")
    .select("*")
    .eq("id", parsed.data.id)
    .single();

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── Update (with optimistic locking) ──────────────────────

export async function updateEstimate(
  id: string,
  input: unknown,
): Promise<ActionResult<Estimate>> {
  const { supabase } = await getAuthenticatedClient();

  // Validate — inject the id into the input for schema validation
  const parsed = updateEstimateSchema.safeParse({ ...Object(input), id });
  if (!parsed.success) {
    return validationError(
      "Invalid estimate data.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  // Build update payload — only include fields that were provided
  const updates: Database["public"]["Tables"]["estimates"]["Update"] = {};

  if (v.name !== undefined) updates.name = v.name;
  if (v.description !== undefined) updates.description = v.description;
  if (v.notes !== undefined) updates.notes = v.notes;
  if (v.status !== undefined) updates.status = v.status as EstimateStatus;
  if (v.defaultContingencyRate !== undefined) updates.default_contingency_rate = v.defaultContingencyRate;
  if (v.defaultOverheadRate !== undefined) updates.default_overhead_rate = v.defaultOverheadRate;
  if (v.defaultMarkupRate !== undefined) updates.default_markup_rate = v.defaultMarkupRate;
  if (v.defaultTaxRate !== undefined) updates.default_tax_rate = v.defaultTaxRate;

  // Optimistic locking: only update if version matches
  const { data, error } = await supabase
    .from("estimates")
    .update(updates)
    .eq("id", id)
    .eq("version", v.version)
    .select()
    .single();

  if (error) {
    // PGRST116 = no rows returned from .single() — version mismatch
    if (error.code === "PGRST116") {
      return optimisticLockFailed();
    }
    return handleSupabaseError(error);
  }

  return ok(data);
}

// ── Duplicate (deep copy via RPC) ─────────────────────────

export async function duplicateEstimate(
  id: string,
  newName: string,
): Promise<ActionResult<string>> {
  const { user, supabase } = await getAuthenticatedClient();

  const parsedId = uuidSchema.safeParse(id);
  if (!parsedId.success) {
    return validationError("Invalid ID format.", formatZodError(parsedId.error));
  }
  if (!newName || newName.trim().length === 0) {
    return validationError("New estimate name is required.");
  }

  const { data, error } = await supabase.rpc("deep_copy_estimate", {
    p_source_estimate_id: parsedId.data,
    p_new_name: newName.trim(),
    p_created_by: user.id,
  });

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── Delete (hard delete — CASCADE handles child data) ─────

export async function deleteEstimate(
  id: string,
): Promise<ActionResult<Estimate>> {
  const { supabase } = await getAuthenticatedClient();

  const parsed = deleteEstimateSchema.safeParse({ id });
  if (!parsed.success) {
    return validationError("Invalid ID format.", formatZodError(parsed.error));
  }

  const { data, error } = await supabase
    .from("estimates")
    .delete()
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error) return handleSupabaseError(error);
  return ok(data);
}
