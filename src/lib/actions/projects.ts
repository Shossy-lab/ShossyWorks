// src/lib/actions/projects.ts
// ────────────────────────────────────────────────────────────
// Server actions for projects.
// Reference implementation — all other action files follow
// this exact pattern: authenticate, validate, query, return.
// ────────────────────────────────────────────────────────────
"use server";

import { ok, validationError } from "@/lib/types/action-result";
import { createProjectSchema, updateProjectSchema, getProjectSchema, deleteProjectSchema } from "@/lib/validation/projects";
import { formatZodError } from "@/lib/validation/format-error";
import { PROJECT_STATUS } from "@/lib/types/enums";
import { getAuthenticatedClient, handleSupabaseError } from "./_shared";

import type { ActionResult } from "@/lib/types/action-result";
import type { Database } from "@/lib/types/supabase";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type ProjectStatus = Database["public"]["Enums"]["project_status"];

// ── Create ─────────────────────────────────────────────────

export async function createProject(
  input: unknown,
): Promise<ActionResult<Project>> {
  const { user, supabase } = await getAuthenticatedClient();

  // Validate
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) {
    return validationError(
      "Invalid project data.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  // Insert
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: v.name,
      project_number: v.projectNumber ?? null,
      description: v.description ?? null,
      status: v.status as ProjectStatus,
      client_name: v.clientName ?? null,
      client_email: v.clientEmail ?? null,
      client_phone: v.clientPhone ?? null,
      address_line1: v.addressLine1 ?? null,
      address_line2: v.addressLine2 ?? null,
      city: v.city ?? null,
      state: v.state ?? null,
      zip: v.zip ?? null,
      start_date: v.startDate ?? null,
      end_date: v.endDate ?? null,
      bid_date: v.bidDate ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── Read (list) ────────────────────────────────────────────

export async function getProjects(): Promise<ActionResult<Project[]>> {
  const { supabase } = await getAuthenticatedClient();

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .neq("status", PROJECT_STATUS.ARCHIVED)
    .order("updated_at", { ascending: false });

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── Read (single) ──────────────────────────────────────────

export async function getProject(
  id: string,
): Promise<ActionResult<Project>> {
  const { supabase } = await getAuthenticatedClient();

  const parsed = getProjectSchema.safeParse({ id });
  if (!parsed.success) {
    return validationError("Invalid ID format.", formatZodError(parsed.error));
  }

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", parsed.data.id)
    .single();

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── Update ─────────────────────────────────────────────────

export async function updateProject(
  id: string,
  input: unknown,
): Promise<ActionResult<Project>> {
  const { supabase } = await getAuthenticatedClient();

  // Validate — inject the id into the input for schema validation
  const parsed = updateProjectSchema.safeParse({ ...Object(input), id });
  if (!parsed.success) {
    return validationError(
      "Invalid project data.",
      formatZodError(parsed.error),
    );
  }

  const v = parsed.data;

  // Build update payload — only include fields that were provided
  const updates: Database["public"]["Tables"]["projects"]["Update"] = {};

  if (v.name !== undefined) updates.name = v.name;
  if (v.projectNumber !== undefined) updates.project_number = v.projectNumber;
  if (v.description !== undefined) updates.description = v.description;
  if (v.status !== undefined) updates.status = v.status as ProjectStatus;
  if (v.clientName !== undefined) updates.client_name = v.clientName;
  if (v.clientEmail !== undefined) updates.client_email = v.clientEmail;
  if (v.clientPhone !== undefined) updates.client_phone = v.clientPhone;
  if (v.addressLine1 !== undefined) updates.address_line1 = v.addressLine1;
  if (v.addressLine2 !== undefined) updates.address_line2 = v.addressLine2;
  if (v.city !== undefined) updates.city = v.city;
  if (v.state !== undefined) updates.state = v.state;
  if (v.zip !== undefined) updates.zip = v.zip;
  if (v.startDate !== undefined) updates.start_date = v.startDate;
  if (v.endDate !== undefined) updates.end_date = v.endDate;
  if (v.bidDate !== undefined) updates.bid_date = v.bidDate;

  const { data, error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return handleSupabaseError(error);
  return ok(data);
}

// ── Delete (soft — archives the project) ───────────────────

export async function deleteProject(
  id: string,
): Promise<ActionResult<Project>> {
  const { supabase } = await getAuthenticatedClient();

  const parsed = deleteProjectSchema.safeParse({ id });
  if (!parsed.success) {
    return validationError("Invalid ID format.", formatZodError(parsed.error));
  }

  const { data, error } = await supabase
    .from("projects")
    .update({ status: PROJECT_STATUS.ARCHIVED })
    .eq("id", parsed.data.id)
    .select()
    .single();

  if (error) return handleSupabaseError(error);
  return ok(data);
}
