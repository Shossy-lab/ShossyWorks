# Realtime-State Contract

**Last verified**: 2026-04-02
**Governs**: Interface between Supabase Realtime and client state manager for collaborative editing

## Required Fields

| Field | Type | Notes |
|-------|------|-------|
| version | INTEGER (default 1) | On estimate_nodes. Optimistic locking for concurrent edits. |
| channel | string | One Supabase Realtime channel per estimate: `estimate:{id}` |

## Calculated Fields (Read-Only)

| Field | Formula |
|-------|---------|
| presence | { user_id, display_name, editing_node_id, editing_field } |

## Invariants

- State via useReducer (not useState). Two mutation sources feed one reducer.
- Local edits: dispatch -> reduce -> recalculate -> render -> broadcast.
- Remote edits: channel event -> dispatch -> reduce -> recalculate -> render.
- Both paths use the SAME reducer and SAME calc engine. No separate code paths.
- Conflict resolution: presence-guided last-writer-wins. No field locking. No OT/CRDTs.
- Broadcast via Supabase Realtime Broadcast. Presence via Realtime Presence.
- No external collaboration libraries (Yjs, Liveblocks, PartyKit all rejected).

## Cross-Feature Rules

- Remote edits trigger same calc engine as local edits (pure function).
- Node deletion by other user while editing: close edit + toast notification.
- Auto-promotion/demotion events broadcast so all clients update tree structure.
- Option selection changes broadcast; all clients recalculate active tree.
- Save uses optimistic locking (version column). Reject stale writes with conflict toast.
- Client role receives broadcasts but cannot originate edits (read-only + option toggling).
- Budget: 3 users @ 1 edit/5s = ~62 msgs/min, within Supabase free tier.

## Change Protocol

Update contract FIRST, then code, then CONTRACT-INDEX.md. Commit together.
