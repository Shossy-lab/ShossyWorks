// src/lib/validation/format-error.ts
// ────────────────────────────────────────────────────────────
// Converts a ZodError into a field-path-keyed error map,
// suitable for returning in ActionError.fieldErrors.
// ────────────────────────────────────────────────────────────

import type { ZodError } from "zod";

/**
 * Flatten a ZodError into `{ "field.path": ["message", ...] }`.
 *
 * Nested paths are dot-joined (e.g. `details.qty`).
 * Root-level issues use an empty string as the key.
 */
export function formatZodError(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".");
    if (!fieldErrors[path]) {
      fieldErrors[path] = [];
    }
    fieldErrors[path].push(issue.message);
  }

  return fieldErrors;
}
