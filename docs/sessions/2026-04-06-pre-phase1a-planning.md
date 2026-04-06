# Session Transcript: Pre-Phase 1A Planning
**Date:** 2026-04-06
**Type:** Architecture planning conversation (no code changes)

---

## Topic 1: Build Sequencing — Data First or UI First?

**Zac's question:** In a previous Claude Desktop conversation, we discussed whether to build UI before, alongside, or after the data architecture. Landed on data-first but wasn't fully sure. Also wondering how to use existing Figma prototypes (none are exactly right, but all have liked aspects).

**Conclusion:** Data-first is correct. This is already documented as INTENT.md Principle #1 ("bottom-up stability") and the Design System's "data first, UI second" philosophy. Two previous failed attempts (EP, Soloway) proved that building all layers simultaneously doesn't work.

**Figma prototypes:** Valuable as *reference*, not blueprints. Use them now to understand what data each screen needs (informs schema). Use them later (Phase 1B+) as visual direction when building UI on top of real data.

**Why data-first matters more when AI builds the code:** Claude needs clear, stable contracts to write against. If the schema is solid, every UI component can be built against real data structures from the start. Building UI first creates fake data shapes that need painful rewiring when the real schema arrives.

---

## Topic 2: What Needs to Be Decided Before Phase 1A?

Identified 6 areas of user interaction decisions that could affect database design. Ranked by difficulty to change later:

### Difficulty Spectrum
| Change Type | Difficulty | Example |
|---|---|---|
| New table | Trivial | Adding attachments, share tokens |
| New column | Easy | Adding a field to items or projects |
| Reshaping a column into a table | Medium | Notes text field -> comments table |
| Changing core structure | Hard | Restructuring the tree model (already locked in) |

### The 6 Decision Areas

**1. Project & Estimate Lifecycle** — What statuses exist? What transitions are allowed? Is status change tracked? Can clients change status (approve)?

**2. Node Actions (the right-click menu)** — Duplicate node/branch? Copy/paste between estimates? Convert group <-> assembly? Add from catalog? Assign phase/cost code? Hide from client?

**3. User Preferences & Saved Views** — Can users customize visible columns? Save different views (phase view, cost code view)? Set default rates at project level?

**4. What Gets Attached to Nodes** — Single notes field vs. comment threads vs. multiple note entries? File attachments (photos, PDFs, specs)? Links to suppliers?

**5. Client Experience** — Can clients comment? Approve/reject estimates? Compare versions? Is there a share link model or do they need accounts?

**6. Search & Finding Things** — Cross-project search? Filtering by phase/cost code/vendor? Recently accessed projects?

---

## Topic 3: Decision A — Notes vs. Conversations (Highest Risk Reshaping Decision)

**Zac's input:**
- Notes are typically "to self" or "for the record" — not conversations
- Wants 1 or more notes per item
- Rich text would be valuable (bold, highlight, bullet points)
- Multiple entries per item would be nice
- Considered whether bullet points in rich text could replace multiple entries
- Version history for everything is critical

**Decision: `node_notes` table (multiple entries per node, each with rich text)**

Reasoning:
- Each entry automatically tracks who wrote it and when — that IS the version history
- Rich text within each entry (bold, bullets) AND multiple separate entries — both
- A single rich text blob with bullets loses metadata (who added which bullet? when?)
- Soft-delete (archived_at) so notes are never truly destroyed
- Aligns with "version history for everything" philosophy

---

## Topic 4: Version History Confirmation

Confirmed the system has two layers of history tracking, both already designed:

**Layer 1 — Estimate Versions:** Full deep-copy snapshots of entire estimates at key milestones. Frozen and immutable once created. "What did Version 2 look like?" → query it directly.

**Layer 2 — Change History:** Database triggers capture every single edit to every node automatically. Who changed what, when, old value, new value. Runs from day one.

The `node_notes` table will also need history tracking (soft-delete at minimum).

---

## Topic 5: Plain Language Architecture Walkthrough

Provided complete non-technical explanation of:
- **The Tree** — folder-like structure with groups (containers), items (costs), assemblies (recipes)
- **Auto-Promotion** — items automatically become groups when you add children under them (unique differentiator)
- **Calculations** — qty x price = subtotal, rolls up the tree, runs in browser AND server simultaneously
- **Catalog** — personal template library, copy-on-use (never live-linked)
- **Options** — client choices that swap entire subtrees, three levels (broad, inline, option sets)
- **Versions** — frozen snapshots at milestones
- **Multi-User** — owner (full), employees (full), clients (filtered read-only + option toggling)
- **Formulas** — expressions that reference project parameters, auto-recalculate

Zac confirmed understanding. No corrections to the architecture description.

---

## Status at Session End

- **Completed:** Decision A (notes architecture), build sequencing confirmation, architecture walkthrough
- **Remaining:** 5 decision areas to work through before Phase 1A can begin
- **Next up:** Continue with remaining decisions, starting from highest-risk
- **No code changes this session** — planning only
