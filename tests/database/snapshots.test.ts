/**
 * Snapshot & Deep-Copy Tests
 *
 * Tests for create_estimate_snapshot(), restore_estimate_snapshot(),
 * deep_copy_estimate(), snapshot immutability triggers, and round-trip
 * fidelity. These are the most complex database operations in the system.
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY for service-role operations
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// ENV & SKIP GATE
// ---------------------------------------------------------------------------
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SKIP = !url || !serviceKey;

function skipIf(condition: boolean) {
  return condition ? it.skip : it;
}

// ---------------------------------------------------------------------------
// CLIENTS
// ---------------------------------------------------------------------------
let admin: SupabaseClient;

beforeAll(() => {
  if (SKIP) return;
  admin = createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

// ---------------------------------------------------------------------------
// TEST HELPERS
// ---------------------------------------------------------------------------

/** UUID format validator */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Create a test project, returning its ID */
async function createTestProject(
  client: SupabaseClient,
  name = `test-project-${Date.now()}`,
): Promise<string> {
  const { data, error } = await client
    .from("projects")
    .insert({ name, status: "active" })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create test project: ${error.message}`);
  return data.id;
}

/** Create a test estimate within a project */
async function createTestEstimate(
  client: SupabaseClient,
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await client
    .from("estimates")
    .insert({
      project_id: projectId,
      name: `test-estimate-${Date.now()}`,
      version_number: 1,
      version_label: "Version 1",
      is_current: true,
      status: "draft",
      default_contingency_rate: 0.05,
      default_overhead_rate: 0.1,
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create test estimate: ${error.message}`);
  return data.id;
}

/**
 * Build a small estimate tree for testing:
 *   root-group
 *     ├── child-assembly
 *     │     └── grandchild-item (with item_details)
 *     └── child-item (with item_details)
 *
 * Returns all created IDs for verification.
 */
async function buildTestEstimateTree(
  client: SupabaseClient,
  estimateId: string,
): Promise<{
  rootId: string;
  assemblyId: string;
  grandchildItemId: string;
  childItemId: string;
  noteId: string;
}> {
  // Root group node
  const { data: root, error: rootErr } = await client
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      parent_id: null,
      sort_order: 0,
      node_type: "group",
      name: "Root Group",
      description: "Test root group",
      client_visibility: "visible",
      subtotal: 5000,
      contingency_amount: 250,
      overhead_amount: 500,
      total_price: 5750,
    })
    .select("id")
    .single();
  if (rootErr) throw new Error(`Failed to create root node: ${rootErr.message}`);

  // Child assembly
  const { data: assembly, error: asmErr } = await client
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      parent_id: root.id,
      sort_order: 0,
      node_type: "assembly",
      name: "Child Assembly",
      description: "Test assembly",
      client_visibility: "visible",
      subtotal: 3000,
      contingency_amount: 150,
      overhead_amount: 300,
      total_price: 3450,
    })
    .select("id")
    .single();
  if (asmErr) throw new Error(`Failed to create assembly node: ${asmErr.message}`);

  // Assembly details
  const { error: asmDetailErr } = await client
    .from("node_assembly_details")
    .insert({
      node_id: assembly.id,
      assembly_qty: 5,
      derived_unit_cost: 600,
    });
  if (asmDetailErr)
    throw new Error(`Failed to create assembly details: ${asmDetailErr.message}`);

  // Grandchild item under assembly
  const { data: grandchild, error: gcErr } = await client
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      parent_id: assembly.id,
      sort_order: 0,
      node_type: "item",
      name: "Grandchild Item",
      description: "Item under assembly",
      client_visibility: "visible",
      subtotal: 1500,
      contingency_amount: 75,
      overhead_amount: 150,
      total_price: 1725,
    })
    .select("id")
    .single();
  if (gcErr) throw new Error(`Failed to create grandchild node: ${gcErr.message}`);

  // Item details for grandchild
  const { error: gcDetailErr } = await client
    .from("node_item_details")
    .insert({
      node_id: grandchild.id,
      qty: 10,
      raw_qty: 10,
      qty_mode: "numeric",
      unit_cost: 150,
      cost_type: "material",
      contingency_rate: 0.05,
      overhead_rate: 0.1,
      waste_factor: 0,
      bid_type: "estimate",
    });
  if (gcDetailErr)
    throw new Error(`Failed to create grandchild item details: ${gcDetailErr.message}`);

  // Child item (sibling to assembly)
  const { data: childItem, error: ciErr } = await client
    .from("estimate_nodes")
    .insert({
      estimate_id: estimateId,
      parent_id: root.id,
      sort_order: 1,
      node_type: "item",
      name: "Child Item",
      description: "Direct child item",
      client_visibility: "visible",
      subtotal: 2000,
      contingency_amount: 100,
      overhead_amount: 200,
      total_price: 2300,
    })
    .select("id")
    .single();
  if (ciErr) throw new Error(`Failed to create child item node: ${ciErr.message}`);

  // Item details for child item
  const { error: ciDetailErr } = await client
    .from("node_item_details")
    .insert({
      node_id: childItem.id,
      qty: 20,
      raw_qty: 20,
      qty_mode: "numeric",
      unit_cost: 100,
      cost_type: "labor",
      contingency_rate: 0.05,
      overhead_rate: 0.1,
      waste_factor: 0.02,
      bid_type: "bid",
    });
  if (ciDetailErr)
    throw new Error(`Failed to create child item details: ${ciDetailErr.message}`);

  // Note on the root node
  const { data: note, error: noteErr } = await client
    .from("node_notes")
    .insert({
      node_id: root.id,
      body: "Test note for snapshot verification",
      format: "markdown",
      is_internal: true,
      is_client_visible: false,
    })
    .select("id")
    .single();
  if (noteErr) throw new Error(`Failed to create node note: ${noteErr.message}`);

  return {
    rootId: root.id,
    assemblyId: assembly.id,
    grandchildItemId: grandchild.id,
    childItemId: childItem.id,
    noteId: note.id,
  };
}

/**
 * Add option system data to an estimate tree for comprehensive snapshot testing.
 * Creates: option_group, 2 alternatives, node memberships.
 */
async function addOptionData(
  client: SupabaseClient,
  estimateId: string,
  anchorNodeId: string,
  memberNodeId: string,
): Promise<{
  groupId: string;
  altAId: string;
  altBId: string;
  membershipId: string;
}> {
  const { data: group, error: gErr } = await client
    .from("option_groups")
    .insert({
      estimate_id: estimateId,
      anchor_node_id: anchorNodeId,
      name: "Test Option Group",
      description: "Snapshot test option group",
    })
    .select("id")
    .single();
  if (gErr) throw new Error(`Failed to create option group: ${gErr.message}`);

  const { data: altA, error: aaErr } = await client
    .from("option_alternatives")
    .insert({
      option_group_id: group.id,
      name: "Alternative A",
      description: "First alternative",
      is_selected: true,
      sort_order: 0,
    })
    .select("id")
    .single();
  if (aaErr) throw new Error(`Failed to create alt A: ${aaErr.message}`);

  const { data: altB, error: abErr } = await client
    .from("option_alternatives")
    .insert({
      option_group_id: group.id,
      name: "Alternative B",
      description: "Second alternative",
      is_selected: false,
      sort_order: 1,
    })
    .select("id")
    .single();
  if (abErr) throw new Error(`Failed to create alt B: ${abErr.message}`);

  const { data: membership, error: mErr } = await client
    .from("node_option_memberships")
    .insert({
      node_id: memberNodeId,
      option_alternative_id: altA.id,
    })
    .select("id")
    .single();
  if (mErr) throw new Error(`Failed to create membership: ${mErr.message}`);

  return {
    groupId: group.id,
    altAId: altA.id,
    altBId: altB.id,
    membershipId: membership.id,
  };
}

/**
 * Call create_estimate_snapshot via RPC
 */
async function createSnapshot(
  client: SupabaseClient,
  estimateId: string,
  name: string,
  opts: { description?: string; snapshotType?: string } = {},
): Promise<string> {
  const { data, error } = await client.rpc("create_estimate_snapshot", {
    p_estimate_id: estimateId,
    p_name: name,
    p_description: opts.description ?? null,
    p_snapshot_type: opts.snapshotType ?? "milestone",
    p_created_by: null,
  });
  if (error) throw new Error(`create_estimate_snapshot failed: ${error.message}`);
  return data as string;
}

/**
 * Call restore_estimate_snapshot via RPC
 */
async function restoreSnapshot(
  client: SupabaseClient,
  snapshotId: string,
  opts: { force?: boolean } = {},
): Promise<string> {
  const { data, error } = await client.rpc("restore_estimate_snapshot", {
    p_snapshot_id: snapshotId,
    p_restored_by: null,
    p_force: opts.force ?? false,
  });
  if (error) throw new Error(`restore_estimate_snapshot failed: ${error.message}`);
  return data as string;
}

/**
 * Call deep_copy_estimate via RPC
 */
async function deepCopy(
  client: SupabaseClient,
  estimateId: string,
  label?: string,
): Promise<string> {
  const { data, error } = await client.rpc("deep_copy_estimate", {
    p_source_estimate_id: estimateId,
    p_new_version_label: label ?? null,
    p_created_by: null,
  });
  if (error) throw new Error(`deep_copy_estimate failed: ${error.message}`);
  return data as string;
}

// ---------------------------------------------------------------------------
// CLEANUP TRACKING
// ---------------------------------------------------------------------------
const projectsToCleanup: string[] = [];

afterAll(async () => {
  if (SKIP || !admin) return;
  // Cascade delete projects -> estimates -> nodes -> everything
  for (const pid of projectsToCleanup) {
    await admin.from("projects").delete().eq("id", pid);
  }
});

// ==========================================================================
// 1. create_estimate_snapshot()
// ==========================================================================
describe("snapshot/create_estimate_snapshot", () => {
  skipIf(SKIP)("SNAP-01: creates snapshot with correct name and metadata", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    const snapshotId = await createSnapshot(admin, estimateId, "Milestone Alpha", {
      description: "First milestone snapshot",
      snapshotType: "milestone",
    });

    expect(snapshotId).toMatch(UUID_RE);

    const { data: snap } = await admin
      .from("estimate_snapshots")
      .select("*")
      .eq("id", snapshotId)
      .single();

    expect(snap).not.toBeNull();
    expect(snap!.name).toBe("Milestone Alpha");
    expect(snap!.description).toBe("First milestone snapshot");
    expect(snap!.estimate_id).toBe(estimateId);
    expect(snap!.snapshot_type).toBe("milestone");
    expect(snap!.estimate_status_at_time).toBe("draft");
    expect(snap!.schema_version).toBe(1);
  }, 30_000);

  skipIf(SKIP)("SNAP-02: JSONB contains all node data", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    const tree = await buildTestEstimateTree(admin, estimateId);

    const snapshotId = await createSnapshot(admin, estimateId, "Node Data Test");

    const { data: snap } = await admin
      .from("estimate_snapshots")
      .select("snapshot_data")
      .eq("id", snapshotId)
      .single();

    const sd = snap!.snapshot_data;

    // Verify nodes array contains all 4 nodes
    expect(sd.nodes).toHaveLength(4);
    const nodeIds = sd.nodes.map((n: { id: string }) => n.id);
    expect(nodeIds).toContain(tree.rootId);
    expect(nodeIds).toContain(tree.assemblyId);
    expect(nodeIds).toContain(tree.grandchildItemId);
    expect(nodeIds).toContain(tree.childItemId);

    // Verify item_details captured
    expect(sd.item_details.length).toBeGreaterThanOrEqual(2);

    // Verify assembly_details captured
    expect(sd.assembly_details.length).toBeGreaterThanOrEqual(1);

    // Verify node_notes captured
    expect(sd.node_notes.length).toBeGreaterThanOrEqual(1);
    const noteIds = sd.node_notes.map((n: { id: string }) => n.id);
    expect(noteIds).toContain(tree.noteId);
  }, 30_000);

  skipIf(SKIP)("SNAP-03: JSONB contains option data", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    const tree = await buildTestEstimateTree(admin, estimateId);
    const opts = await addOptionData(
      admin,
      estimateId,
      tree.rootId,
      tree.childItemId,
    );

    const snapshotId = await createSnapshot(admin, estimateId, "Option Data Test");

    const { data: snap } = await admin
      .from("estimate_snapshots")
      .select("snapshot_data")
      .eq("id", snapshotId)
      .single();

    const sd = snap!.snapshot_data;

    // option_groups
    expect(sd.option_groups.length).toBeGreaterThanOrEqual(1);
    const groupIds = sd.option_groups.map((g: { id: string }) => g.id);
    expect(groupIds).toContain(opts.groupId);

    // option_alternatives
    expect(sd.option_alternatives.length).toBeGreaterThanOrEqual(2);
    const altIds = sd.option_alternatives.map((a: { id: string }) => a.id);
    expect(altIds).toContain(opts.altAId);
    expect(altIds).toContain(opts.altBId);

    // option_memberships
    expect(sd.option_memberships.length).toBeGreaterThanOrEqual(1);
    const memberIds = sd.option_memberships.map((m: { id: string }) => m.id);
    expect(memberIds).toContain(opts.membershipId);
  }, 30_000);

  skipIf(SKIP)("SNAP-04: schema_version is set to 1", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);

    const snapshotId = await createSnapshot(admin, estimateId, "Schema Version Test");

    const { data: snap } = await admin
      .from("estimate_snapshots")
      .select("schema_version, snapshot_data")
      .eq("id", snapshotId)
      .single();

    expect(snap!.schema_version).toBe(1);
    expect(snap!.snapshot_data.schema_version).toBe(1);
  }, 15_000);

  skipIf(SKIP)("SNAP-05: snapshot_type distinguishes milestone vs checkpoint", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);

    const milestoneId = await createSnapshot(admin, estimateId, "Milestone", {
      snapshotType: "milestone",
    });
    const checkpointId = await createSnapshot(admin, estimateId, "Checkpoint", {
      snapshotType: "checkpoint",
    });

    const { data: milestone } = await admin
      .from("estimate_snapshots")
      .select("snapshot_type")
      .eq("id", milestoneId)
      .single();
    const { data: checkpoint } = await admin
      .from("estimate_snapshots")
      .select("snapshot_type")
      .eq("id", checkpointId)
      .single();

    expect(milestone!.snapshot_type).toBe("milestone");
    expect(checkpoint!.snapshot_type).toBe("checkpoint");
  }, 15_000);

  skipIf(SKIP)("SNAP-06: captures estimate and project status at time", async () => {
    const projectId = await createTestProject(admin, `status-test-${Date.now()}`);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId, {
      status: "preliminary",
    });

    const snapshotId = await createSnapshot(admin, estimateId, "Status Capture Test");

    const { data: snap } = await admin
      .from("estimate_snapshots")
      .select("estimate_status_at_time, project_status_at_time")
      .eq("id", snapshotId)
      .single();

    expect(snap!.estimate_status_at_time).toBe("preliminary");
    // project_status_at_time should be the project status
    expect(snap!.project_status_at_time).toBe("active");
  }, 15_000);

  skipIf(SKIP)("SNAP-07: node_count and total_price computed correctly", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    const snapshotId = await createSnapshot(admin, estimateId, "Stats Test");

    const { data: snap } = await admin
      .from("estimate_snapshots")
      .select("node_count, total_price")
      .eq("id", snapshotId)
      .single();

    // buildTestEstimateTree creates 4 nodes
    expect(snap!.node_count).toBe(4);
    // total_price sums root-level nodes (root is the only node with parent_id IS NULL)
    // root total_price = 5750
    expect(Number(snap!.total_price)).toBe(5750);
  }, 30_000);

  skipIf(SKIP)("SNAP-08: empty estimate creates valid snapshot", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);

    // Create snapshot with no nodes
    const snapshotId = await createSnapshot(admin, estimateId, "Empty Snapshot");

    const { data: snap } = await admin
      .from("estimate_snapshots")
      .select("node_count, total_price, snapshot_data")
      .eq("id", snapshotId)
      .single();

    expect(snap!.node_count).toBe(0);
    expect(Number(snap!.total_price)).toBe(0);
    expect(snap!.snapshot_data.nodes).toEqual([]);
    expect(snap!.snapshot_data.item_details).toEqual([]);
    expect(snap!.snapshot_data.assembly_details).toEqual([]);
    expect(snap!.snapshot_data.node_notes).toEqual([]);
  }, 15_000);
});

// ==========================================================================
// 2. Snapshot Immutability
// ==========================================================================
describe("snapshot/immutability", () => {
  skipIf(SKIP)("SNAP-IMM-01: cannot UPDATE snapshot_data", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    const snapshotId = await createSnapshot(admin, estimateId, "Immutable Test");

    const { error } = await admin
      .from("estimate_snapshots")
      .update({ snapshot_data: { tampered: true } })
      .eq("id", snapshotId);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("immutable");
  }, 15_000);

  skipIf(SKIP)("SNAP-IMM-02: cannot DELETE snapshots", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    const snapshotId = await createSnapshot(admin, estimateId, "Delete Test");

    const { error } = await admin
      .from("estimate_snapshots")
      .delete()
      .eq("id", snapshotId);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("immutable");
  }, 15_000);

  skipIf(SKIP)("SNAP-IMM-03: cannot modify name after creation", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    const snapshotId = await createSnapshot(admin, estimateId, "Original Name");

    const { error } = await admin
      .from("estimate_snapshots")
      .update({ name: "Tampered Name" })
      .eq("id", snapshotId);

    expect(error).not.toBeNull();
    expect(error!.message).toContain("immutable");
  }, 15_000);

  skipIf(SKIP)("SNAP-IMM-04: can update restored_at and restored_by (allowed mutation)", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    const snapshotId = await createSnapshot(admin, estimateId, "Restore Track Test");

    // The immutability trigger allows ONLY restored_at/restored_by updates
    const { error } = await admin
      .from("estimate_snapshots")
      .update({ restored_at: new Date().toISOString() })
      .eq("id", snapshotId);

    // This should succeed -- restored_at/restored_by are the only mutable fields
    expect(error).toBeNull();
  }, 15_000);
});

// ==========================================================================
// 3. restore_estimate_snapshot()
// ==========================================================================
describe("snapshot/restore_estimate_snapshot", () => {
  skipIf(SKIP)("SNAP-RESTORE-01: auto-creates checkpoint before restore", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    const snapshotId = await createSnapshot(admin, estimateId, "Pre-Restore");

    // Modify the tree (add a node)
    await admin.from("estimate_nodes").insert({
      estimate_id: estimateId,
      parent_id: null,
      sort_order: 99,
      node_type: "group",
      name: "Added After Snapshot",
    });

    // Restore
    const checkpointId = await restoreSnapshot(admin, snapshotId);

    // Verify checkpoint was created
    expect(checkpointId).toMatch(UUID_RE);

    const { data: checkpoint } = await admin
      .from("estimate_snapshots")
      .select("snapshot_type, name")
      .eq("id", checkpointId)
      .single();

    expect(checkpoint!.snapshot_type).toBe("checkpoint");
    expect(checkpoint!.name).toContain("Auto-save");
  }, 30_000);

  skipIf(SKIP)("SNAP-RESTORE-02: restores all nodes with correct parent-child relationships", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    const tree = await buildTestEstimateTree(admin, estimateId);

    const snapshotId = await createSnapshot(admin, estimateId, "Tree Structure");

    // Delete all current nodes
    await admin.from("estimate_nodes").delete().eq("estimate_id", estimateId);

    // Restore
    await restoreSnapshot(admin, snapshotId);

    // Verify nodes restored
    const { data: nodes } = await admin
      .from("estimate_nodes")
      .select("id, parent_id, name, node_type")
      .eq("estimate_id", estimateId)
      .order("sort_order");

    expect(nodes).not.toBeNull();
    expect(nodes!.length).toBe(4);

    // Find root (parent_id is null)
    const root = nodes!.find((n) => n.parent_id === null);
    expect(root).toBeDefined();
    expect(root!.name).toBe("Root Group");

    // Find children of root
    const rootChildren = nodes!.filter((n) => n.parent_id === root!.id);
    expect(rootChildren.length).toBe(2);

    // Find assembly's child
    const assembly = rootChildren.find((n) => n.node_type === "assembly");
    expect(assembly).toBeDefined();
    const assemblyChildren = nodes!.filter((n) => n.parent_id === assembly!.id);
    expect(assemblyChildren.length).toBe(1);
    expect(assemblyChildren[0].name).toBe("Grandchild Item");
  }, 30_000);

  skipIf(SKIP)("SNAP-RESTORE-03: restores item_details and assembly_details with correct node FKs", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    const snapshotId = await createSnapshot(admin, estimateId, "Details Test");

    // Clear and restore
    await admin.from("estimate_nodes").delete().eq("estimate_id", estimateId);
    await restoreSnapshot(admin, snapshotId);

    // Verify item details exist and reference valid nodes
    const { data: nodes } = await admin
      .from("estimate_nodes")
      .select("id, node_type")
      .eq("estimate_id", estimateId);

    const itemNodeIds = nodes!
      .filter((n) => n.node_type === "item")
      .map((n) => n.id);

    const { data: itemDetails } = await admin
      .from("node_item_details")
      .select("node_id, qty, unit_cost, cost_type")
      .in("node_id", itemNodeIds);

    expect(itemDetails!.length).toBe(2);
    // All item detail node_ids should reference existing nodes
    for (const detail of itemDetails!) {
      expect(itemNodeIds).toContain(detail.node_id);
    }

    // Verify assembly details
    const assemblyNodeIds = nodes!
      .filter((n) => n.node_type === "assembly")
      .map((n) => n.id);

    const { data: asmDetails } = await admin
      .from("node_assembly_details")
      .select("node_id, assembly_qty, derived_unit_cost")
      .in("node_id", assemblyNodeIds);

    expect(asmDetails!.length).toBe(1);
    expect(Number(asmDetails![0].assembly_qty)).toBe(5);
  }, 30_000);

  skipIf(SKIP)("SNAP-RESTORE-04: restores node_notes", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    const snapshotId = await createSnapshot(admin, estimateId, "Notes Test");

    // Clear and restore
    await admin.from("estimate_nodes").delete().eq("estimate_id", estimateId);
    await restoreSnapshot(admin, snapshotId);

    // Verify notes restored
    const { data: nodes } = await admin
      .from("estimate_nodes")
      .select("id")
      .eq("estimate_id", estimateId);

    const nodeIds = nodes!.map((n) => n.id);

    const { data: notes } = await admin
      .from("node_notes")
      .select("body, format, is_internal")
      .in("node_id", nodeIds);

    expect(notes!.length).toBeGreaterThanOrEqual(1);
    const testNote = notes!.find((n) => n.body === "Test note for snapshot verification");
    expect(testNote).toBeDefined();
    expect(testNote!.format).toBe("markdown");
    expect(testNote!.is_internal).toBe(true);
  }, 30_000);

  skipIf(SKIP)("SNAP-RESTORE-05: restore on draft estimate succeeds", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId, { status: "draft" });
    await buildTestEstimateTree(admin, estimateId);

    const snapshotId = await createSnapshot(admin, estimateId, "Draft Restore");

    // Should succeed without force
    const checkpointId = await restoreSnapshot(admin, snapshotId);
    expect(checkpointId).toMatch(UUID_RE);
  }, 30_000);

  skipIf(SKIP)("SNAP-RESTORE-06: restore on active estimate blocked without force", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId, { status: "active" });

    const snapshotId = await createSnapshot(admin, estimateId, "Active Block Test");

    // Should fail without force=true
    const { error } = await admin.rpc("restore_estimate_snapshot", {
      p_snapshot_id: snapshotId,
      p_restored_by: null,
      p_force: false,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("active");
  }, 15_000);

  skipIf(SKIP)("SNAP-RESTORE-07: restore on active estimate succeeds with force=true", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId, { status: "active" });
    await buildTestEstimateTree(admin, estimateId);

    const snapshotId = await createSnapshot(admin, estimateId, "Force Restore");

    const checkpointId = await restoreSnapshot(admin, snapshotId, { force: true });
    expect(checkpointId).toMatch(UUID_RE);
  }, 30_000);

  skipIf(SKIP)("SNAP-RESTORE-08: restore on complete estimate is blocked entirely", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId, { status: "complete" });

    const snapshotId = await createSnapshot(admin, estimateId, "Complete Block Test");

    // Should fail even with force=true
    const { error } = await admin.rpc("restore_estimate_snapshot", {
      p_snapshot_id: snapshotId,
      p_restored_by: null,
      p_force: true,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("complete");
  }, 15_000);

  skipIf(SKIP)("SNAP-RESTORE-09: nonexistent snapshot raises error", async () => {
    const { error } = await admin.rpc("restore_estimate_snapshot", {
      p_snapshot_id: "00000000-0000-0000-0000-000000000000",
      p_restored_by: null,
      p_force: false,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("not found");
  }, 15_000);
});

// ==========================================================================
// 4. deep_copy_estimate()
// ==========================================================================
describe("snapshot/deep_copy_estimate", () => {
  skipIf(SKIP)("DEEP-COPY-01: creates new estimate with incremented version", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId, {
      version_number: 1,
      version_label: "Version 1",
    });
    await buildTestEstimateTree(admin, estimateId);

    const newEstimateId = await deepCopy(admin, estimateId, "Version 2");

    expect(newEstimateId).toMatch(UUID_RE);
    expect(newEstimateId).not.toBe(estimateId);

    const { data: newEstimate } = await admin
      .from("estimates")
      .select("version_number, version_label, is_current")
      .eq("id", newEstimateId)
      .single();

    expect(newEstimate!.version_number).toBe(2);
    expect(newEstimate!.version_label).toBe("Version 2");
    expect(newEstimate!.is_current).toBe(true);

    // Original should no longer be current
    const { data: origEstimate } = await admin
      .from("estimates")
      .select("is_current")
      .eq("id", estimateId)
      .single();

    expect(origEstimate!.is_current).toBe(false);
  }, 30_000);

  skipIf(SKIP)("DEEP-COPY-02: all nodes copied with new UUIDs", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    const tree = await buildTestEstimateTree(admin, estimateId);

    const newEstimateId = await deepCopy(admin, estimateId);

    // Get copied nodes
    const { data: copiedNodes } = await admin
      .from("estimate_nodes")
      .select("id, name, node_type")
      .eq("estimate_id", newEstimateId);

    expect(copiedNodes!.length).toBe(4);

    // All IDs should be different from source
    const copiedIds = copiedNodes!.map((n) => n.id);
    expect(copiedIds).not.toContain(tree.rootId);
    expect(copiedIds).not.toContain(tree.assemblyId);
    expect(copiedIds).not.toContain(tree.grandchildItemId);
    expect(copiedIds).not.toContain(tree.childItemId);

    // Names should be preserved
    const copiedNames = copiedNodes!.map((n) => n.name).sort();
    expect(copiedNames).toEqual(
      ["Child Assembly", "Child Item", "Grandchild Item", "Root Group"].sort(),
    );
  }, 30_000);

  skipIf(SKIP)("DEEP-COPY-03: parent-child relationships preserved via FK remapping", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    const newEstimateId = await deepCopy(admin, estimateId);

    const { data: copiedNodes } = await admin
      .from("estimate_nodes")
      .select("id, parent_id, name, node_type")
      .eq("estimate_id", newEstimateId);

    // Root should have null parent
    const root = copiedNodes!.find((n) => n.name === "Root Group");
    expect(root!.parent_id).toBeNull();

    // Assembly should reference root (within the copy, not the original)
    const assembly = copiedNodes!.find((n) => n.name === "Child Assembly");
    expect(assembly!.parent_id).toBe(root!.id);

    // Grandchild should reference assembly
    const grandchild = copiedNodes!.find((n) => n.name === "Grandchild Item");
    expect(grandchild!.parent_id).toBe(assembly!.id);

    // Child item should reference root
    const childItem = copiedNodes!.find((n) => n.name === "Child Item");
    expect(childItem!.parent_id).toBe(root!.id);

    // None of the parent_ids should reference original estimate nodes
    const { data: origNodes } = await admin
      .from("estimate_nodes")
      .select("id")
      .eq("estimate_id", estimateId);
    const origIds = origNodes!.map((n) => n.id);

    for (const node of copiedNodes!) {
      if (node.parent_id !== null) {
        expect(origIds).not.toContain(node.parent_id);
      }
    }
  }, 30_000);

  skipIf(SKIP)("DEEP-COPY-04: item details, assembly details, notes all copied", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    const newEstimateId = await deepCopy(admin, estimateId);

    const { data: copiedNodes } = await admin
      .from("estimate_nodes")
      .select("id, node_type")
      .eq("estimate_id", newEstimateId);

    const copiedNodeIds = copiedNodes!.map((n) => n.id);
    const copiedItemIds = copiedNodes!
      .filter((n) => n.node_type === "item")
      .map((n) => n.id);
    const copiedAsmIds = copiedNodes!
      .filter((n) => n.node_type === "assembly")
      .map((n) => n.id);

    // Item details
    const { data: itemDetails } = await admin
      .from("node_item_details")
      .select("node_id")
      .in("node_id", copiedItemIds);
    expect(itemDetails!.length).toBe(2);

    // Assembly details
    const { data: asmDetails } = await admin
      .from("node_assembly_details")
      .select("node_id")
      .in("node_id", copiedAsmIds);
    expect(asmDetails!.length).toBe(1);

    // Notes
    const { data: notes } = await admin
      .from("node_notes")
      .select("node_id, body")
      .in("node_id", copiedNodeIds);
    expect(notes!.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  skipIf(SKIP)("DEEP-COPY-05: option groups, alternatives, memberships all copied", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    const tree = await buildTestEstimateTree(admin, estimateId);
    const opts = await addOptionData(
      admin,
      estimateId,
      tree.rootId,
      tree.childItemId,
    );

    const newEstimateId = await deepCopy(admin, estimateId);

    // Option groups copied
    const { data: copiedGroups } = await admin
      .from("option_groups")
      .select("id, name, anchor_node_id")
      .eq("estimate_id", newEstimateId);
    expect(copiedGroups!.length).toBe(1);
    expect(copiedGroups![0].name).toBe("Test Option Group");
    // anchor_node_id should be remapped (not point to original)
    expect(copiedGroups![0].id).not.toBe(opts.groupId);
    expect(copiedGroups![0].anchor_node_id).not.toBe(tree.rootId);

    // Option alternatives copied
    const { data: copiedAlts } = await admin
      .from("option_alternatives")
      .select("id, name, option_group_id")
      .eq("option_group_id", copiedGroups![0].id);
    expect(copiedAlts!.length).toBe(2);
    // All IDs should be new
    const copiedAltIds = copiedAlts!.map((a) => a.id);
    expect(copiedAltIds).not.toContain(opts.altAId);
    expect(copiedAltIds).not.toContain(opts.altBId);

    // Memberships copied with remapped FKs
    const copiedAltAId = copiedAlts!.find((a) => a.name === "Alternative A")!.id;
    const { data: copiedMemberships } = await admin
      .from("node_option_memberships")
      .select("id, node_id, option_alternative_id")
      .eq("option_alternative_id", copiedAltAId);
    expect(copiedMemberships!.length).toBe(1);
    // node_id should be remapped
    expect(copiedMemberships![0].node_id).not.toBe(tree.childItemId);
    expect(copiedMemberships![0].id).not.toBe(opts.membershipId);
  }, 30_000);

  skipIf(SKIP)("DEEP-COPY-06: original estimate unchanged after copy", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    // Capture original state
    const { data: origNodesBefore } = await admin
      .from("estimate_nodes")
      .select("id, name, parent_id, node_type, sort_order")
      .eq("estimate_id", estimateId)
      .order("sort_order");

    await deepCopy(admin, estimateId);

    // Verify original nodes untouched
    const { data: origNodesAfter } = await admin
      .from("estimate_nodes")
      .select("id, name, parent_id, node_type, sort_order")
      .eq("estimate_id", estimateId)
      .order("sort_order");

    expect(origNodesAfter!.length).toBe(origNodesBefore!.length);
    for (let i = 0; i < origNodesBefore!.length; i++) {
      expect(origNodesAfter![i].id).toBe(origNodesBefore![i].id);
      expect(origNodesAfter![i].name).toBe(origNodesBefore![i].name);
      expect(origNodesAfter![i].parent_id).toBe(origNodesBefore![i].parent_id);
    }
  }, 30_000);

  skipIf(SKIP)("DEEP-COPY-07: nonexistent source estimate raises error", async () => {
    const { error } = await admin.rpc("deep_copy_estimate", {
      p_source_estimate_id: "00000000-0000-0000-0000-000000000000",
      p_new_version_label: null,
      p_created_by: null,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("not found");
  }, 15_000);

  skipIf(SKIP)("DEEP-COPY-08: copy with many nodes completes without error", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);

    // Create root
    const { data: root } = await admin
      .from("estimate_nodes")
      .insert({
        estimate_id: estimateId,
        parent_id: null,
        sort_order: 0,
        node_type: "group",
        name: "Large Tree Root",
      })
      .select("id")
      .single();

    // Batch insert 50 child items (testing scalability, not 100+ to keep test fast)
    const childInserts = [];
    for (let i = 0; i < 50; i++) {
      childInserts.push({
        estimate_id: estimateId,
        parent_id: root!.id,
        sort_order: i,
        node_type: "item" as const,
        name: `Item ${i + 1}`,
        subtotal: 100,
        total_price: 100,
      });
    }

    const { error: batchErr } = await admin
      .from("estimate_nodes")
      .insert(childInserts);
    if (batchErr) throw new Error(`Batch insert failed: ${batchErr.message}`);

    // Deep copy should complete without error
    const newEstimateId = await deepCopy(admin, estimateId);

    const { data: copiedNodes } = await admin
      .from("estimate_nodes")
      .select("id")
      .eq("estimate_id", newEstimateId);

    // 51 nodes: 1 root + 50 children
    expect(copiedNodes!.length).toBe(51);
  }, 60_000);

  skipIf(SKIP)("DEEP-COPY-09: ltree paths correct in copy", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    const newEstimateId = await deepCopy(admin, estimateId);

    const { data: copiedNodes } = await admin
      .from("estimate_nodes")
      .select("id, parent_id, path, name")
      .eq("estimate_id", newEstimateId);

    // Root path should be just the root id
    const root = copiedNodes!.find((n) => n.parent_id === null);
    expect(root!.path).not.toBeNull();
    if (root!.path) {
      expect(root!.path).toBe(root!.id);
    }

    // Assembly path should be root.assembly
    const assembly = copiedNodes!.find((n) => n.name === "Child Assembly");
    if (assembly!.path) {
      expect(assembly!.path).toContain(root!.id);
      expect(assembly!.path).toContain(assembly!.id);
    }

    // Grandchild path should be root.assembly.grandchild
    const grandchild = copiedNodes!.find((n) => n.name === "Grandchild Item");
    if (grandchild!.path) {
      expect(grandchild!.path).toContain(root!.id);
      expect(grandchild!.path).toContain(assembly!.id);
      expect(grandchild!.path).toContain(grandchild!.id);
    }
  }, 30_000);
});

// ==========================================================================
// 5. Round-Trip Fidelity
// ==========================================================================
describe("snapshot/round-trip-fidelity", () => {
  skipIf(SKIP)("RT-01: create -> snapshot -> restore -> compare: identical data", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    // Capture original state
    const { data: origNodes } = await admin
      .from("estimate_nodes")
      .select("name, node_type, sort_order, subtotal, total_price, description")
      .eq("estimate_id", estimateId)
      .order("sort_order");

    // Snapshot
    const snapshotId = await createSnapshot(admin, estimateId, "Round-Trip Test");

    // Modify the estimate (add a new node)
    await admin.from("estimate_nodes").insert({
      estimate_id: estimateId,
      parent_id: null,
      sort_order: 99,
      node_type: "group",
      name: "This Should Disappear After Restore",
    });

    // Restore from snapshot
    await restoreSnapshot(admin, snapshotId);

    // Compare
    const { data: restoredNodes } = await admin
      .from("estimate_nodes")
      .select("name, node_type, sort_order, subtotal, total_price, description")
      .eq("estimate_id", estimateId)
      .order("sort_order");

    // Same number of nodes
    expect(restoredNodes!.length).toBe(origNodes!.length);

    // Same names and types
    const origNames = origNodes!.map((n) => n.name).sort();
    const restoredNames = restoredNodes!.map((n) => n.name).sort();
    expect(restoredNames).toEqual(origNames);

    // "This Should Disappear" should NOT be present
    expect(restoredNames).not.toContain("This Should Disappear After Restore");

    // Verify financial data preserved
    for (const origNode of origNodes!) {
      const restored = restoredNodes!.find((n) => n.name === origNode.name);
      expect(restored).toBeDefined();
      expect(Number(restored!.subtotal)).toBe(Number(origNode.subtotal));
      expect(Number(restored!.total_price)).toBe(Number(origNode.total_price));
    }
  }, 45_000);

  skipIf(SKIP)("RT-02: create -> deep_copy -> snapshot copy -> restore copy: identical data", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    // Deep copy
    const copiedEstimateId = await deepCopy(admin, estimateId);

    // Capture copy state
    const { data: copyNodes } = await admin
      .from("estimate_nodes")
      .select("name, node_type, sort_order")
      .eq("estimate_id", copiedEstimateId)
      .order("sort_order");

    // Snapshot the copy
    const snapshotId = await createSnapshot(admin, copiedEstimateId, "Copy Snapshot");

    // Modify the copy
    await admin.from("estimate_nodes").insert({
      estimate_id: copiedEstimateId,
      parent_id: null,
      sort_order: 99,
      node_type: "group",
      name: "Temporary Node",
    });

    // Restore from snapshot
    await restoreSnapshot(admin, snapshotId);

    // Compare
    const { data: restoredCopyNodes } = await admin
      .from("estimate_nodes")
      .select("name, node_type, sort_order")
      .eq("estimate_id", copiedEstimateId)
      .order("sort_order");

    expect(restoredCopyNodes!.length).toBe(copyNodes!.length);
    const copyNames = copyNodes!.map((n) => n.name).sort();
    const restoredCopyNames = restoredCopyNodes!.map((n) => n.name).sort();
    expect(restoredCopyNames).toEqual(copyNames);
  }, 60_000);

  skipIf(SKIP)("RT-03: node count matches before and after snapshot round-trip", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    // Count before
    const { count: countBefore } = await admin
      .from("estimate_nodes")
      .select("id", { count: "exact", head: true })
      .eq("estimate_id", estimateId);

    const snapshotId = await createSnapshot(admin, estimateId, "Count Test");

    // Verify snapshot metadata matches
    const { data: snap } = await admin
      .from("estimate_snapshots")
      .select("node_count")
      .eq("id", snapshotId)
      .single();
    expect(snap!.node_count).toBe(countBefore);

    // Add extra nodes to change the state
    await admin.from("estimate_nodes").insert({
      estimate_id: estimateId,
      parent_id: null,
      sort_order: 99,
      node_type: "group",
      name: "Extra Node 1",
    });
    await admin.from("estimate_nodes").insert({
      estimate_id: estimateId,
      parent_id: null,
      sort_order: 100,
      node_type: "group",
      name: "Extra Node 2",
    });

    // Restore
    await restoreSnapshot(admin, snapshotId);

    // Count after
    const { count: countAfter } = await admin
      .from("estimate_nodes")
      .select("id", { count: "exact", head: true })
      .eq("estimate_id", estimateId);

    expect(countAfter).toBe(countBefore);
  }, 30_000);

  skipIf(SKIP)("RT-04: item detail financial data preserved through round-trip", async () => {
    const projectId = await createTestProject(admin);
    projectsToCleanup.push(projectId);
    const estimateId = await createTestEstimate(admin, projectId);
    await buildTestEstimateTree(admin, estimateId);

    // Capture item detail values before
    const { data: nodesBefore } = await admin
      .from("estimate_nodes")
      .select("id")
      .eq("estimate_id", estimateId)
      .eq("node_type", "item");

    const nodeIdsBefore = nodesBefore!.map((n) => n.id);
    const { data: detailsBefore } = await admin
      .from("node_item_details")
      .select("qty, unit_cost, cost_type, contingency_rate, overhead_rate, waste_factor, bid_type")
      .in("node_id", nodeIdsBefore)
      .order("qty");

    // Snapshot and restore
    const snapshotId = await createSnapshot(admin, estimateId, "Financial RT");
    await restoreSnapshot(admin, snapshotId);

    // Capture item detail values after
    const { data: nodesAfter } = await admin
      .from("estimate_nodes")
      .select("id")
      .eq("estimate_id", estimateId)
      .eq("node_type", "item");

    const nodeIdsAfter = nodesAfter!.map((n) => n.id);
    const { data: detailsAfter } = await admin
      .from("node_item_details")
      .select("qty, unit_cost, cost_type, contingency_rate, overhead_rate, waste_factor, bid_type")
      .in("node_id", nodeIdsAfter)
      .order("qty");

    expect(detailsAfter!.length).toBe(detailsBefore!.length);

    for (let i = 0; i < detailsBefore!.length; i++) {
      expect(Number(detailsAfter![i].qty)).toBe(Number(detailsBefore![i].qty));
      expect(Number(detailsAfter![i].unit_cost)).toBe(Number(detailsBefore![i].unit_cost));
      expect(detailsAfter![i].cost_type).toBe(detailsBefore![i].cost_type);
      expect(Number(detailsAfter![i].contingency_rate)).toBe(Number(detailsBefore![i].contingency_rate));
      expect(Number(detailsAfter![i].overhead_rate)).toBe(Number(detailsBefore![i].overhead_rate));
      expect(detailsAfter![i].bid_type).toBe(detailsBefore![i].bid_type);
    }
  }, 45_000);
});
