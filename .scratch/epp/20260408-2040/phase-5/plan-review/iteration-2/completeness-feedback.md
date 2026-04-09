# Completeness Review -- Iteration 2

## Verdict: APPROVE

---

## Issues Resolved from Iteration 1

- [RESOLVED] Issue 1 (MAJOR -- `node_attachments` table missing from all phases): v2 explicitly removes `node_attachments` from deep-copy function with a TODO comment: "Add node_attachments copy when table is created." Verification script checks `! grep -q "node_attachments"` in the functions migration to ensure no reference to the nonexistent table. Fix M4 fully addresses this -- the plan is now internally consistent.

- [RESOLVED] Issue 4 (MAJOR -- no documentation update phase): v2 adds Phase 1A-13 "Documentation & Contract Sync" with explicit updates to CODEBASE_MAP.md, INTENT.md, CONTRACT-INDEX.md, plus creation of 4 new contracts (snapshot-system, rls-authorization, client-visibility, options-system). Agent assignments and commit message included. Fix M15 fully addresses this.

- [RESOLVED] Issue 6 (MAJOR -- `createEstimateFromSnapshot` has server action but no PostgreSQL function): v2 adds `create_estimate_from_snapshot()` to Phase 1A-9 function list with clear description: creates new estimate, deserializes snapshot JSONB, rebuilds ltree paths. It appears in both the function list and the verification script. Fix M5 and M27 fully address this.

- [RESOLVED] Issue 10 (MAJOR -- Phase 1B lacks detail for scope estimation): v2 provides improved Phase 1B detail including: deliverable lists for each sub-phase, dependency notes, session estimates. The 1B-3 Options UI dependency on Phase 2A is clarified -- "can ship without Phase 2A calculation engine -- use raw subtotals for comparison." While still high-level, this is appropriate for a Phase 1B overview within a Phase 1A implementation plan. Full 1B planning is a separate activity.

- [RESOLVED] Issue 2 (MINOR -- `proposals`/`vendor_proposals` missing): v2 adds explicit deferral note: "Deferred: proposals / vendor_proposals table -- revisit in Phase 1B+ if bid management features are needed." Fix noted in minor fixes list.

- [RESOLVED] Issue 3 (MINOR -- `set_app_user_id` missing): v2 adds explicit note: "`set_app_user_id` is NOT needed -- triggers use `auth.uid()` directly for `changed_by`." This resolves the ambiguity.

- [RESOLVED] Issue 5 (MINOR -- `flag_color` silently dropped): v2 adds note in Phase 1A-2's estimate_nodes section: "Deferred: flag_color VARCHAR(7) for multi-color flags -- revisit if single boolean proves insufficient."

- [RESOLVED] Issue 7 (MINOR -- validation schema coverage incomplete): v2 defers notes and catalog validation schemas to 1B alongside their server actions and UI. Since notes/catalog server actions are also deferred, there is no mismatch. The "Deferred to 1B" section in Phase 1A-10 explicitly lists these.

- [RESOLVED] Issue 8 (MINOR -- share link rate limiting parameters): v2 adds note: "Per-IP rate limiting (C13: 20 attempts/hour/IP) is application-layer, implemented via in-memory rate limiter or Redis in the share link validation API route (Phase 1B-4)."

- [RESOLVED] Issue 9 (MINOR -- inconsistent server action count claims): v2 consistently states "~28 CORE server actions" throughout (context section, Phase 1A-11 heading, detailed table, commit message). Non-core actions deferred to 1B are listed separately.

- [RESOLVED] Cross-cutting concern 1 (contract creation absent): v2 Phase 1A-13 creates 4 contracts for new feature boundaries.

- [RESOLVED] Cross-cutting concern 2 (no rollback strategy): v2 Recovery Strategy section covers this.

- [RESOLVED] Cross-cutting concern 3 (DAG shows 1A-5 independent of 1A-4): v2 DAG explicitly states "1A-5 depends on BOTH 1A-3 AND 1A-4." Fix M12 addresses this.

- [RESOLVED] Cross-cutting concern 4 (history table trigger for node_item_details not defined): v2 Phase 1A-7 explicitly mentions a separate `log_item_detail_history()` trigger function for `node_item_details_history`.

## Remaining Issues

None.

## New Issues Found

None.

## Final Assessment

All 4 MAJOR issues from iteration 1 have been resolved. The `node_attachments` inconsistency is eliminated, the missing `create_estimate_from_snapshot()` function is added, documentation sync has its own phase (1A-13) with contracts, and Phase 1B has sufficient detail for sequencing decisions. The plan now achieves internal consistency -- every server action has a backing database function, every table referenced in functions actually exists (or is explicitly excluded with a TODO), and every feature boundary gets a contract. The plan is complete for Phase 1A execution.
