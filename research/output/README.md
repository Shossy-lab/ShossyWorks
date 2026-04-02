# Research Output

Research deliverables produced 2026-04-02 by Claude Code (Opus 4.6).
Reviewed by 5-agent Opus review board, revised, and finalized.

## Final Deliverables

| File | Contents |
|------|----------|
| [01-data-architecture.md](01-data-architecture.md) | Complete data architecture: tree model (adjacency list + ltree), hybrid node tables, ~28-table schema, catalog, options system (junction table), version management, calculation engine, formula engine (math.js), vendor system, proposals, RLS |
| [02-implementation-sequence.md](02-implementation-sequence.md) | 12-phase bottom-up build sequence (Phase 0 + Phase 1A/1B split) with session estimates (18-28 total) |
| [03-open-questions.md](03-open-questions.md) | Researched answers to all 9 original + 2 new open questions (allowances, structured cost codes) |
| [04-risk-assessment.md](04-risk-assessment.md) | Risk matrix with prioritized risks, scope creep boundaries, prototype recommendations |

## Addendum

| File | Contents |
|------|----------|
| [05-addendum-new-requirements.md](05-addendum-new-requirements.md) | Multi-user correction, item auto-promotion, PIN auth — impacts on architecture and sequence |

## Supplemental Research

| File | Contents |
|------|----------|
| [research-realtime-collaboration.md](research-realtime-collaboration.md) | Real-time collaborative editing via Supabase Realtime. Broadcast + Presence channels, useReducer pattern, ~1 extra session of effort. |
| [research-node-promotion.md](research-node-promotion.md) | Item-to-group auto-promotion + auto-demotion. Includes SQL triggers, edge case analysis. |
| [research-pin-auth.md](research-pin-auth.md) | PIN authentication as session unlock (deferred to after core works). |

## Review Board Output

| File | Reviewer | Verdict |
|------|----------|---------|
| [reviews/01-data-model-review.md](reviews/01-data-model-review.md) | Data Model Critic | Approved with refinements |
| [reviews/02-calc-engine-review.md](reviews/02-calc-engine-review.md) | Calc Engine Critic | Conditional pass (3 critical) |
| [reviews/03-options-system-review.md](reviews/03-options-system-review.md) | Options System Critic | Conditional pass (4 critical) |
| [reviews/04-sequence-risk-review.md](reviews/04-sequence-risk-review.md) | Sequence Critic | Approved with revisions |
| [reviews/05-industry-research.md](reviews/05-industry-research.md) | Industry Researcher | Strong, 10 findings |

## Archive

| Directory | Contents |
|-----------|----------|
| [archive/v1-originals/](archive/v1-originals/) | Pre-review v1 deliverables (superseded) |

## Key Architectural Decisions

- **Tree model:** Adjacency list (parent_id) + trigger-maintained ltree path column
- **Node types:** 3 types (group, assembly, item). Items auto-promote to group when children are added.
- **Table structure:** Hybrid base + detail tables. ~23 columns on base, ~22 on item details, ~5 on assembly details.
- **Options:** Subtree swapping via `node_option_memberships` junction table. Future-proof for nested options.
- **Calculations:** Isomorphic TypeScript module. Server-authoritative on save. DECIMAL(15,4) intermediates.
- **Versions:** Deep-copy snapshots + trigger-based history tables for full audit trail.
- **Phases:** Classificatory (FK to phases table), not structural.
- **Formulas:** math.js with sandboxed evaluation and project parameter injection.
- **Cost codes:** Structured table with CSI MasterFormat seed data.
- **Allowances:** First-class concept with budget/status tracking.
- **Auth:** Supabase Auth (email+password) + optional 6-digit PIN as session unlock. Roles: owner, employee, client.
- **Node promotion:** Items auto-promote to groups when children are added (Tab indent). Manual demotion only.
- **Multi-user:** Single-company, multi-user. Owner + employees + clients. Optimistic locking for concurrent editing.
