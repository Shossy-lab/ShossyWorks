---
name: ShossyWorks Estimating Platform — Project Overview
description: Construction estimating platform for Szostak Build. Third attempt after two failed builds. Core concepts: tree hierarchy, items, assemblies, catalog, options system, version management.
type: project
---

## Project Goal
Build a construction estimating platform for Szostak Build, LLC. Single-user, single-company tool for creating, managing, and presenting construction cost estimates.

## Previous Attempts (context, not blueprints)
1. **Estimating Platform (EP)** — 14-table schema, 46-column monolithic `estimate_nodes` table. Failed due to: building all layers simultaneously, insufficient DB-level enforcement, N+1 recalculation, 100KB+ spec docs consuming context.
2. **Soloway Proposals** — Fixed 5-level hierarchy, read-only Excel-dependent viewer. Failed due to: too rigid, no standalone data entry, editing bolted on as afterthought.

**Why:** Past failures documented in `research/references/`. Key lesson: build bottom-up, each layer stable before the next.

## Core Domain Concepts
- **Items** — atomic cost units (materials, labor, equipment, subcontractor bids)
- **Assemblies** — reusable groupings with relative quantity calculations (cedar siding example)
- **Groups** — organizational containers (replace old category/section distinction)
- **Catalog** — reusable templates, copy-on-instantiate (never reference-linked)
- **Options** — three layers: broad (parameter overrides), inline (subtree swapping with unlimited alternatives), option sets (saved scenarios)
- **Calculation chain** — qty * unit_cost = subtotal, contingency compounds, overhead compounds on contingency

## Key Requirements (from Zac's answers, 2026-04-02)
- Options system with FULL subtree swapping (not just cost adjustments) — key differentiator
- Client-facing view in same app (filtered visibility by role)
- Full version management with audit trail, rollback, diff comparison
- Vendor management as a major feature (CRM-like: contacts, COIs, contracts, POs, ratings)
- PDF export for proposals, POs, RFPs
- Formula engine: basic math + simple conditionals + future named preset formulas
- Stack: Next.js + Supabase + Vercel + TypeScript + Tailwind CSS
- Multi-user: owner + employees + clients (NOT single-user as initially assumed)
- Item auto-promotion: items become groups when children are indented under them (iterative workflow)
- Tab/Shift-Tab keyboard shortcuts for indent/outdent controlling tree hierarchy
- Optional PIN authentication (6-digit, session unlock model)

## Critical Architectural Decisions (from review board, 2026-04-02)
- Formula library: math.js (not expr-eval — CVE-2025-12735)
- Options: node_option_memberships junction table (not column stamping)
- Tree: adjacency list + ltree (dual column)
- Calculations: DECIMAL(15,4) intermediates, server-authoritative on save
- Cost codes: structured table with CSI MasterFormat (not free-text)
- Allowances: first-class concept with budget/status tracking

## Research Output
Architecture research deliverables are in `research/output/` (produced 2026-04-02).
