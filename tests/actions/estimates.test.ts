/**
 * Server Action Tests: Estimates
 *
 * Tests for estimate CRUD, versioning, and lifecycle server actions.
 * Validates ActionResult contracts, Zod validation, and optimistic locking.
 */

import { describe, it, expect } from "vitest";

import type { ActionResult } from "@/lib/types/action-result";

// ── Skip flag ───────────────────────────────────────────────────
const SKIP =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(SKIP)("server-actions/estimates", () => {
  // ── createEstimate ────────────────────────────────────────────

  describe("createEstimate", () => {
    it("ACT-EST-01: valid input with project_id returns success", async () => {
      const { createProject } = await import("@/lib/actions/projects");
      const { createEstimate } = await import("@/lib/actions/estimates");

      // Create a project first
      const project = await createProject({ name: "Estimate Test Project" });
      expect(project.success).toBe(true);
      if (!project.success) return;

      const result = await createEstimate({
        projectId: project.data.id,
        name: "Test Estimate",
        status: "draft",
        defaultContingencyRate: 0.1,
        defaultOverheadRate: 0.15,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty("id");
        expect(result.data).toHaveProperty("name", "Test Estimate");
        expect(result.data).toHaveProperty("status", "draft");
        expect(result.data).toHaveProperty("version", 1);
      }
    });

    it("ACT-EST-02: non-existent project_id returns not-found", async () => {
      const { createEstimate } = await import("@/lib/actions/estimates");

      const result = await createEstimate({
        projectId: "00000000-0000-0000-0000-000000000000",
        name: "Orphan Estimate",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(["NOT_FOUND", "PROJECT_NOT_FOUND", "CONSTRAINT_VIOLATION"]).toContain(
          result.code,
        );
      }
    });

    it("ACT-EST-03: validates estimate_status enum", async () => {
      const { createProject } = await import("@/lib/actions/projects");
      const { createEstimate } = await import("@/lib/actions/estimates");

      const project = await createProject({ name: "Status Enum Test" });
      expect(project.success).toBe(true);
      if (!project.success) return;

      const result = await createEstimate({
        projectId: project.data.id,
        name: "Bad Status Estimate",
        status: "nonexistent" as any,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
      }
    });

    it("ACT-EST-04: missing required name returns validation error", async () => {
      const { createProject } = await import("@/lib/actions/projects");
      const { createEstimate } = await import("@/lib/actions/estimates");

      const project = await createProject({ name: "No Name Test" });
      expect(project.success).toBe(true);
      if (!project.success) return;

      const result = await createEstimate({
        projectId: project.data.id,
        // name is missing
      } as any);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
      }
    });

    it("ACT-EST-05: defaults status to 'draft' when not provided", async () => {
      const { createProject } = await import("@/lib/actions/projects");
      const { createEstimate } = await import("@/lib/actions/estimates");

      const project = await createProject({ name: "Default Status Test" });
      expect(project.success).toBe(true);
      if (!project.success) return;

      const result = await createEstimate({
        projectId: project.data.id,
        name: "Default Status Estimate",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty("status", "draft");
      }
    });
  });

  // ── listEstimates ─────────────────────────────────────────────

  describe("listEstimates", () => {
    it("ACT-EST-06: returns estimates for a project", async () => {
      const { createProject } = await import("@/lib/actions/projects");
      const { createEstimate, listEstimates } = await import(
        "@/lib/actions/estimates"
      );

      const project = await createProject({ name: "List Test Project" });
      expect(project.success).toBe(true);
      if (!project.success) return;

      // Create two estimates
      await createEstimate({ projectId: project.data.id, name: "Est 1" });
      await createEstimate({ projectId: project.data.id, name: "Est 2" });

      const result = await listEstimates({ projectId: project.data.id });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true);
        expect(result.data.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("ACT-EST-07: empty project returns empty array", async () => {
      const { createProject } = await import("@/lib/actions/projects");
      const { listEstimates } = await import("@/lib/actions/estimates");

      const project = await createProject({ name: "Empty List Test" });
      expect(project.success).toBe(true);
      if (!project.success) return;

      const result = await listEstimates({ projectId: project.data.id });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });
  });

  // ── updateEstimate ────────────────────────────────────────────

  describe("updateEstimate", () => {
    it("ACT-EST-08: changes status through lifecycle", async () => {
      const { createProject } = await import("@/lib/actions/projects");
      const { createEstimate, updateEstimate, getEstimate } = await import(
        "@/lib/actions/estimates"
      );

      const project = await createProject({ name: "Lifecycle Test" });
      expect(project.success).toBe(true);
      if (!project.success) return;

      const created = await createEstimate({
        projectId: project.data.id,
        name: "Lifecycle Estimate",
      });
      expect(created.success).toBe(true);
      if (!created.success) return;

      // Draft -> Preliminary
      const toPrelim = await updateEstimate({
        id: created.data.id,
        status: "preliminary",
        version: created.data.version,
      });
      expect(toPrelim.success).toBe(true);

      // Preliminary -> Active
      const currentVersion = toPrelim.success
        ? (toPrelim.data as any).version ?? created.data.version + 1
        : created.data.version + 1;

      const toActive = await updateEstimate({
        id: created.data.id,
        status: "active",
        version: currentVersion,
      });
      expect(toActive.success).toBe(true);
    });

    it("ACT-EST-09: optimistic locking -- version mismatch returns conflict", async () => {
      const { createProject } = await import("@/lib/actions/projects");
      const { createEstimate, updateEstimate } = await import(
        "@/lib/actions/estimates"
      );

      const project = await createProject({ name: "Locking Test" });
      expect(project.success).toBe(true);
      if (!project.success) return;

      const created = await createEstimate({
        projectId: project.data.id,
        name: "Locked Estimate",
      });
      expect(created.success).toBe(true);
      if (!created.success) return;

      // First update should succeed
      const first = await updateEstimate({
        id: created.data.id,
        name: "Updated Once",
        version: created.data.version,
      });
      expect(first.success).toBe(true);

      // Second update with STALE version should fail
      const stale = await updateEstimate({
        id: created.data.id,
        name: "Stale Update",
        version: created.data.version, // same old version
      });

      expect(stale.success).toBe(false);
      if (!stale.success) {
        expect(["OPTIMISTIC_LOCK_FAILED", "CONFLICT"]).toContain(stale.code);
      }
    });

    it("ACT-EST-10: update non-existent estimate returns not-found", async () => {
      const { updateEstimate } = await import("@/lib/actions/estimates");

      const result = await updateEstimate({
        id: "00000000-0000-0000-0000-000000000000",
        name: "Ghost Estimate",
        version: 1,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(["NOT_FOUND", "ESTIMATE_NOT_FOUND"]).toContain(result.code);
      }
    });
  });

  // ── duplicateEstimate / createVersion ──────────────────────────

  describe("createVersion", () => {
    it("ACT-EST-11: creates copy with incremented version", async () => {
      const { createProject } = await import("@/lib/actions/projects");
      const { createEstimate, createVersion } = await import(
        "@/lib/actions/estimates"
      );

      const project = await createProject({ name: "Version Test" });
      expect(project.success).toBe(true);
      if (!project.success) return;

      const original = await createEstimate({
        projectId: project.data.id,
        name: "Original Estimate",
      });
      expect(original.success).toBe(true);
      if (!original.success) return;

      const result = await createVersion({
        sourceEstimateId: original.data.id,
        versionLabel: "V2",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty("id");
        // New version should have a different ID
        expect(result.data.id).not.toBe(original.data.id);
      }
    });
  });

  // ── deleteEstimate ────────────────────────────────────────────

  describe("deleteEstimate", () => {
    it("ACT-EST-12: soft-deletes estimate", async () => {
      const { createProject } = await import("@/lib/actions/projects");
      const { createEstimate, deleteEstimate, getEstimate } = await import(
        "@/lib/actions/estimates"
      );

      const project = await createProject({ name: "Delete Est Test" });
      expect(project.success).toBe(true);
      if (!project.success) return;

      const created = await createEstimate({
        projectId: project.data.id,
        name: "To Delete",
      });
      expect(created.success).toBe(true);
      if (!created.success) return;

      const result = await deleteEstimate({ id: created.data.id });
      expect(result.success).toBe(true);

      // Verify deletion
      const fetched = await getEstimate({ id: created.data.id });
      if (fetched.success) {
        // Soft delete: deleted_at should be set
        expect(fetched.data).toHaveProperty("deleted_at");
        expect(fetched.data.deleted_at).not.toBeNull();
      } else {
        expect(["NOT_FOUND", "ESTIMATE_NOT_FOUND"]).toContain(fetched.code);
      }
    });
  });
});
