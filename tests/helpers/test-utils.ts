/**
 * Shared test utilities for server action tests.
 *
 * These helpers create test data and assert ActionResult shapes.
 * They assume a Supabase service_role client is available.
 */

import { createClient } from "@supabase/supabase-js";

import type { ActionResult, ActionError } from "@/lib/types/action-result";
import type { ErrorCode } from "@/lib/types/action-result";
import type { Database } from "@/lib/types/supabase";

// ── Supabase clients ────────────────────────────────────────────

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Returns a Supabase admin client (service_role) that bypasses RLS.
 * Used for test data setup and teardown.
 */
export function getAdminClient() {
  if (!url || !serviceKey) {
    throw new Error(
      "Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Returns a Supabase client using the anon key.
 * RLS policies apply. No auth context = anon role.
 */
export function getAnonClient() {
  if (!url || !anonKey) {
    throw new Error(
      "Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Test data factories ─────────────────────────────────────────

export interface TestProject {
  id: string;
  name: string;
  project_number: string | null;
  status: string;
  user_id: string;
}

/**
 * Create a test project via direct DB insert (bypasses server actions).
 * Returns the inserted project row.
 */
export async function createTestProject(
  overrides: Partial<{
    name: string;
    project_number: string;
    status: string;
    user_id: string;
    client_name: string;
    client_email: string;
  }> = {},
): Promise<TestProject> {
  const admin = getAdminClient();

  // Get or create a test user
  const userId = overrides.user_id ?? (await getOrCreateTestUserId());

  const { data, error } = await admin
    .from("projects")
    .insert({
      name: overrides.name ?? `Test Project ${Date.now()}`,
      project_number: overrides.project_number ?? null,
      status: overrides.status ?? "lead",
      user_id: userId,
      client_name: overrides.client_name ?? null,
      client_email: overrides.client_email ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`createTestProject failed: ${error.message}`);
  return data as TestProject;
}

export interface TestEstimate {
  id: string;
  name: string;
  project_id: string;
  status: string;
  version: number;
}

/**
 * Create a test estimate with an associated project.
 * If projectId is not provided, creates a new test project first.
 */
export async function createTestEstimate(
  overrides: Partial<{
    name: string;
    project_id: string;
    status: string;
    default_contingency_rate: number;
    default_overhead_rate: number;
  }> = {},
): Promise<TestEstimate> {
  const admin = getAdminClient();

  const projectId =
    overrides.project_id ?? (await createTestProject()).id;

  const { data, error } = await admin
    .from("estimates")
    .insert({
      name: overrides.name ?? `Test Estimate ${Date.now()}`,
      project_id: projectId,
      status: overrides.status ?? "draft",
      default_contingency_rate: overrides.default_contingency_rate ?? 0,
      default_overhead_rate: overrides.default_overhead_rate ?? 0,
    })
    .select()
    .single();

  if (error) throw new Error(`createTestEstimate failed: ${error.message}`);
  return data as TestEstimate;
}

export interface TestNode {
  id: string;
  estimate_id: string;
  parent_id: string | null;
  node_type: string;
  name: string;
  sort_order: number;
}

/**
 * Create a single estimate node.
 * If estimateId is not provided, creates a new test estimate (and project) first.
 */
export async function createTestNode(
  overrides: Partial<{
    estimate_id: string;
    parent_id: string | null;
    node_type: string;
    name: string;
    sort_order: number;
    qty: number;
    unit_cost: number;
  }> = {},
): Promise<TestNode> {
  const admin = getAdminClient();

  const estimateId =
    overrides.estimate_id ?? (await createTestEstimate()).id;
  const nodeType = overrides.node_type ?? "item";

  const { data, error } = await admin
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      parent_id: overrides.parent_id ?? null,
      name: overrides.name ?? `Test Node ${Date.now()}`,
      node_type: nodeType,
      sort_order: overrides.sort_order ?? 0,
    })
    .select()
    .single();

  if (error) throw new Error(`createTestNode failed: ${error.message}`);

  // If this is an item node, create the item details row
  if (nodeType === "item") {
    await admin.from("node_item_details").insert({
      node_id: data.id,
      qty: overrides.qty ?? 1,
      raw_qty: overrides.qty ?? 1,
      unit_cost: overrides.unit_cost ?? 10.0,
      contingency_rate: 0,
      overhead_rate: 0,
      waste_factor: 0,
      bid_type: "estimate",
    });
  }

  return data as TestNode;
}

/**
 * Create a multi-level node tree for testing.
 * Returns { root, children, items } with references to all created nodes.
 *
 * Tree structure:
 *   Root (group)
 *   ├── Child A (group)
 *   │   ├── Item A1 (item)
 *   │   └── Item A2 (item)
 *   └── Child B (group)
 *       └── Item B1 (item)
 */
export async function createTestNodeTree(
  estimateId: string,
): Promise<{
  root: TestNode;
  childA: TestNode;
  childB: TestNode;
  itemA1: TestNode;
  itemA2: TestNode;
  itemB1: TestNode;
}> {
  const admin = getAdminClient();

  // Root group
  const { data: root, error: rootErr } = await admin
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      name: "Root Group",
      node_type: "group",
      sort_order: 0,
    })
    .select()
    .single();
  if (rootErr) throw new Error(`createTestNodeTree root failed: ${rootErr.message}`);

  // Child A (group)
  const { data: childA, error: childAErr } = await admin
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      parent_id: root.id,
      name: "Child A",
      node_type: "group",
      sort_order: 0,
    })
    .select()
    .single();
  if (childAErr) throw new Error(`createTestNodeTree childA failed: ${childAErr.message}`);

  // Child B (group)
  const { data: childB, error: childBErr } = await admin
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      parent_id: root.id,
      name: "Child B",
      node_type: "group",
      sort_order: 1,
    })
    .select()
    .single();
  if (childBErr) throw new Error(`createTestNodeTree childB failed: ${childBErr.message}`);

  // Item A1 (item under Child A)
  const { data: itemA1, error: itemA1Err } = await admin
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      parent_id: childA.id,
      name: "Item A1",
      node_type: "item",
      sort_order: 0,
    })
    .select()
    .single();
  if (itemA1Err) throw new Error(`createTestNodeTree itemA1 failed: ${itemA1Err.message}`);

  // Insert item details for A1
  await admin.from("node_item_details").insert({
    node_id: itemA1.id,
    qty: 10,
    raw_qty: 10,
    unit_cost: 25.0,
    contingency_rate: 0,
    overhead_rate: 0,
    waste_factor: 0,
    bid_type: "estimate",
  });

  // Item A2 (item under Child A)
  const { data: itemA2, error: itemA2Err } = await admin
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      parent_id: childA.id,
      name: "Item A2",
      node_type: "item",
      sort_order: 1,
    })
    .select()
    .single();
  if (itemA2Err) throw new Error(`createTestNodeTree itemA2 failed: ${itemA2Err.message}`);

  await admin.from("node_item_details").insert({
    node_id: itemA2.id,
    qty: 5,
    raw_qty: 5,
    unit_cost: 50.0,
    contingency_rate: 0,
    overhead_rate: 0,
    waste_factor: 0,
    bid_type: "estimate",
  });

  // Item B1 (item under Child B)
  const { data: itemB1, error: itemB1Err } = await admin
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      parent_id: childB.id,
      name: "Item B1",
      node_type: "item",
      sort_order: 0,
    })
    .select()
    .single();
  if (itemB1Err) throw new Error(`createTestNodeTree itemB1 failed: ${itemB1Err.message}`);

  await admin.from("node_item_details").insert({
    node_id: itemB1.id,
    qty: 1,
    raw_qty: 1,
    unit_cost: 100.0,
    contingency_rate: 0,
    overhead_rate: 0,
    waste_factor: 0,
    bid_type: "estimate",
  });

  return {
    root: root as TestNode,
    childA: childA as TestNode,
    childB: childB as TestNode,
    itemA1: itemA1 as TestNode,
    itemA2: itemA2 as TestNode,
    itemB1: itemB1 as TestNode,
  };
}

// ── ActionResult assertion helpers ──────────────────────────────

/**
 * Assert that an ActionResult is a success and return the data.
 * Fails the test with a descriptive message if the result is an error.
 */
export function expectActionSuccess<T>(
  result: ActionResult<T>,
): asserts result is { success: true; data: T } {
  if (!result.success) {
    const errResult = result as ActionError;
    throw new Error(
      `Expected ActionResult success but got error: [${errResult.code}] ${errResult.error}` +
        (errResult.fieldErrors
          ? `\n  Field errors: ${JSON.stringify(errResult.fieldErrors)}`
          : ""),
    );
  }
}

/**
 * Assert that an ActionResult is an error with the expected error code.
 * Fails the test if the result is a success or has a different error code.
 */
export function expectActionError(
  result: ActionResult<unknown>,
  expectedCode: ErrorCode,
): asserts result is ActionError {
  if (result.success) {
    throw new Error(
      `Expected ActionResult error with code ${expectedCode} but got success`,
    );
  }
  const errResult = result as ActionError;
  if (errResult.code !== expectedCode) {
    throw new Error(
      `Expected error code ${expectedCode} but got ${errResult.code}: ${errResult.error}`,
    );
  }
}

// ── Internal helpers ────────────────────────────────────────────

let cachedTestUserId: string | null = null;

async function getOrCreateTestUserId(): Promise<string> {
  if (cachedTestUserId) return cachedTestUserId;

  const admin = getAdminClient();
  const testEmail = `test-actions-${Date.now()}@shossyworks.test`;

  const { data, error } = await admin.auth.admin.createUser({
    email: testEmail,
    password: "test-password-12345",
    email_confirm: true,
    app_metadata: { user_role: "owner" },
  });

  if (error) throw new Error(`getOrCreateTestUserId failed: ${error.message}`);
  cachedTestUserId = data.user.id;
  return cachedTestUserId;
}

/**
 * Cleanup test data by deleting projects (cascades to estimates, nodes, etc.)
 */
export async function cleanupTestProject(projectId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from("projects").delete().eq("id", projectId);
}

/**
 * Alias for cleanupTestProject -- delete test data by project ID.
 * Cascades to estimates, nodes, details, snapshots, etc.
 */
export const cleanupTestData = cleanupTestProject;
