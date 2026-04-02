# Client-Visibility Contract

**Last verified**: 2026-04-02
**Governs**: Interface between builder view and client view, controlling data exposure

## Required Fields

| Field | Type | Notes |
|-------|------|-------|
| client_visibility | VARCHAR(20) | On estimate_nodes. 'visible', 'hidden', 'summary_only' |
| role | VARCHAR(20) | On user_profiles. 'owner', 'employee', 'client' |
| client_project_access | junction | Links client user_id to project_id |

## Calculated Fields (Read-Only)

| Field | Formula |
|-------|---------|
| unit_price | total_price / qty (client display). NULL if qty = 0. |

## Invariants

- Clients NEVER see: unit_cost, contingency_rate, overhead_rate, cost_type, vendor_id, notes.
- Clients see: name, description, client_notes, total_price, unit_price (visible nodes only).
- 'hidden': excluded entirely from client view. Children of hidden nodes also hidden.
- 'summary_only': client sees name + total_price only. No child breakdown.
- 'visible': client sees name, description, client_notes, total_price, unit_price, qty, unit.
- RLS policies enforce visibility server-side. Never rely on client-side filtering.
- Client access scoped by client_project_access junction table.

## Cross-Feature Rules

- Owner/employee: full read/write to all fields on all nodes.
- Client: read-only, filtered by client_visibility + client_project_access.
- Clients toggle options ONLY where builder explicitly allows it.
- Client option toggle triggers recalc; client sees updated totals, never cost breakdown.
- Supabase Auth Custom Access Token Hook injects role into JWT for RLS.

## Change Protocol

Update contract FIRST, then code, then CONTRACT-INDEX.md. Commit together.
