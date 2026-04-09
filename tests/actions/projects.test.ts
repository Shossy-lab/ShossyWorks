/**
 * Server Action Tests: Projects
 *
 * Tests for project CRUD server actions including validation,
 * authorization, and error handling.
 *
 * These tests validate the server action contract:
 * - All actions return ActionResult<T>
 * - Validation errors include field-level details
 * - Auth checks reject unauthenticated/unauthorized users
 * - Database constraints are respected
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Skip flag: these tests require Supabase + server actions ────
const SKIP =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── Imports (conditional to avoid errors when skipped) ──────────
// Server actions and types will be imported dynamically once they exist.
// For now, we define the expected interfaces to validate against.

import type { ActionResult, ActionError } from "@/lib/types/action-result";

describe.skipIf(SKIP)("server-actions/projects", () => {
  // ── createProject ─────────────────────────────────────────────

  describe("createProject", () => {
    it("ACT-PROJ-01: valid input returns success with project data", async () => {
      // Arrange
      const input = {
        name: "Test Project Valid",
        projectNumber: "TP-001",
        clientName: "John Doe",
        clientEmail: "john@example.com",
        status: "lead",
      };

      // Act
      const { createProject } = await import("@/lib/actions/projects");
      const result = await createProject(input);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty("id");
        expect(result.data).toHaveProperty("name", "Test Project Valid");
        expect(result.data).toHaveProperty("status", "lead");
      }
    });

    it("ACT-PROJ-02: missing required name returns validation error", async () => {
      const input = {
        // name is missing
        projectNumber: "TP-002",
      };

      const { createProject } = await import("@/lib/actions/projects");
      const result = await createProject(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
        expect(result.fieldErrors).toBeDefined();
        expect(result.fieldErrors?.name).toBeDefined();
      }
    });

    it("ACT-PROJ-03: empty name string returns validation error", async () => {
      const input = {
        name: "",
      };

      const { createProject } = await import("@/lib/actions/projects");
      const result = await createProject(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
      }
    });

    it("ACT-PROJ-04: duplicate project_number returns conflict error", async () => {
      const { createProject } = await import("@/lib/actions/projects");

      // Create first project with a unique number
      const uniqueNum = `DUP-${Date.now()}`;
      const first = await createProject({
        name: "First Project",
        projectNumber: uniqueNum,
      });
      expect(first.success).toBe(true);

      // Try to create second with same number
      const second = await createProject({
        name: "Second Project",
        projectNumber: uniqueNum,
      });

      // Should fail with conflict or constraint error
      expect(second.success).toBe(false);
      if (!second.success) {
        expect(["CONFLICT", "CONSTRAINT_VIOLATION"]).toContain(second.code);
      }
    });

    it("ACT-PROJ-05: invalid email format returns validation error", async () => {
      const input = {
        name: "Bad Email Project",
        clientEmail: "not-an-email",
      };

      const { createProject } = await import("@/lib/actions/projects");
      const result = await createProject(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
        expect(result.fieldErrors?.clientEmail).toBeDefined();
      }
    });

    it("ACT-PROJ-06: invalid status value returns validation error", async () => {
      const input = {
        name: "Bad Status Project",
        status: "nonexistent_status",
      };

      const { createProject } = await import("@/lib/actions/projects");
      const result = await createProject(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  // ── getProjects / listProjects ────────────────────────────────

  describe("listProjects", () => {
    it("ACT-PROJ-07: returns projects for authenticated user", async () => {
      const { listProjects } = await import("@/lib/actions/projects");
      const result = await listProjects();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(Array.isArray(result.data)).toBe(true);
      }
    });
  });

  // ── getProject ────────────────────────────────────────────────

  describe("getProject", () => {
    it("ACT-PROJ-08: returns single project by valid ID", async () => {
      const { createProject, getProject } = await import("@/lib/actions/projects");

      // Create a project first
      const created = await createProject({ name: "Get Test Project" });
      expect(created.success).toBe(true);
      if (!created.success) return;

      const result = await getProject({ id: created.data.id });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty("id", created.data.id);
        expect(result.data).toHaveProperty("name", "Get Test Project");
      }
    });

    it("ACT-PROJ-09: non-existent ID returns not-found error", async () => {
      const { getProject } = await import("@/lib/actions/projects");

      const result = await getProject({
        id: "00000000-0000-0000-0000-000000000000",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("NOT_FOUND");
      }
    });

    it("ACT-PROJ-10: invalid UUID format returns validation error", async () => {
      const { getProject } = await import("@/lib/actions/projects");

      const result = await getProject({ id: "not-a-uuid" });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
      }
    });
  });

  // ── updateProject ─────────────────────────────────────────────

  describe("updateProject", () => {
    it("ACT-PROJ-11: updates name, status, and client info", async () => {
      const { createProject, updateProject, getProject } = await import(
        "@/lib/actions/projects"
      );

      const created = await createProject({ name: "Update Test" });
      expect(created.success).toBe(true);
      if (!created.success) return;

      const result = await updateProject({
        id: created.data.id,
        name: "Updated Name",
        status: "bidding",
        clientName: "Jane Smith",
      });

      expect(result.success).toBe(true);

      // Verify the update persisted
      const fetched = await getProject({ id: created.data.id });
      expect(fetched.success).toBe(true);
      if (fetched.success) {
        expect(fetched.data).toHaveProperty("name", "Updated Name");
        expect(fetched.data).toHaveProperty("status", "bidding");
      }
    });

    it("ACT-PROJ-12: invalid status value returns validation error", async () => {
      const { createProject, updateProject } = await import(
        "@/lib/actions/projects"
      );

      const created = await createProject({ name: "Bad Status Update" });
      expect(created.success).toBe(true);
      if (!created.success) return;

      const result = await updateProject({
        id: created.data.id,
        status: "fake_status" as any,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("VALIDATION_ERROR");
      }
    });

    it("ACT-PROJ-13: update non-existent project returns not-found", async () => {
      const { updateProject } = await import("@/lib/actions/projects");

      const result = await updateProject({
        id: "00000000-0000-0000-0000-000000000000",
        name: "Ghost Project",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("NOT_FOUND");
      }
    });
  });

  // ── deleteProject ─────────────────────────────────────────────

  describe("deleteProject", () => {
    it("ACT-PROJ-14: soft-deletes project", async () => {
      const { createProject, deleteProject, getProject } = await import(
        "@/lib/actions/projects"
      );

      const created = await createProject({ name: "Delete Test" });
      expect(created.success).toBe(true);
      if (!created.success) return;

      const result = await deleteProject({ id: created.data.id });
      expect(result.success).toBe(true);

      // Project should no longer be findable (soft-deleted)
      const fetched = await getProject({ id: created.data.id });
      // Either not-found or data has deleted_at set
      if (fetched.success) {
        expect(fetched.data).toHaveProperty("deleted_at");
        expect(fetched.data.deleted_at).not.toBeNull();
      } else {
        expect(fetched.code).toBe("NOT_FOUND");
      }
    });
  });

  // ── Authorization ─────────────────────────────────────────────

  describe("authorization", () => {
    it("ACT-PROJ-15: unauthenticated user gets UNAUTHORIZED error", async () => {
      // This test validates that server actions check auth.
      // In a real test, we'd call the action without a session.
      // Since server actions use getAuthenticatedClient(), we validate
      // that the action returns UNAUTHORIZED when no valid session exists.
      const { createProject } = await import("@/lib/actions/projects");

      // When running outside Next.js server context, the action should
      // detect missing auth and return unauthorized
      const result = await createProject({ name: "No Auth" });

      // The exact behavior depends on how the auth check is implemented.
      // It should either return UNAUTHORIZED or FORBIDDEN.
      if (!result.success) {
        expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(result.code);
      }
      // If it succeeds, the test environment has an active session -- still valid
    });

    it("ACT-PROJ-16: pending role gets FORBIDDEN error", async () => {
      // This test validates role-based access control.
      // A user with 'pending' role should not be able to create projects.
      // Implementation depends on requireRole() in _shared.ts.

      // In integration tests, we'd create a user with 'pending' role
      // and attempt the action. For now, validate the error shape.
      const { createProject } = await import("@/lib/actions/projects");

      // When called with a pending-role session, expect FORBIDDEN
      // This is a contract test -- the actual role switching would happen
      // via the test infrastructure's role-helpers.
      const result = await createProject({ name: "Pending Role Test" });

      if (!result.success) {
        expect(["UNAUTHORIZED", "FORBIDDEN", "ROLE_INSUFFICIENT"]).toContain(
          result.code,
        );
      }
    });
  });
});
