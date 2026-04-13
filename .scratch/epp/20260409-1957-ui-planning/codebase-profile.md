# Codebase Profile — ShossyWorks UI Planning

**Date:** 2026-04-09
**Phase:** Post-1A, pre-UI. Database foundation complete, zero UI beyond auth shell.
**Critical:** This is where previous attempts FAILED. Three compounding failure modes identified.

## Current State
- 35+ database tables deployed with RLS, triggers, functions
- 28 server actions (projects, estimates, nodes, snapshots) — typed, validated
- Design system established (DESIGN-SYSTEM.md, CSS tokens, @theme block)
- Auth flow working (sign-in, sign-up, pending approval, protected routes)
- Error boundaries at all route levels
- Skip link, focus-visible, ARIA attributes in place
- ~19,600 LOC total

## What Exists (UI)
- Auth pages: sign-in, sign-up (full client components — should be server+client split)
- Protected layout: sidebar + header + main content area
- Dashboard: placeholder cards linking to projects/settings
- Projects page: placeholder text
- Settings page: placeholder text
- Pending approval page
- Error/loading/not-found pages

## What Does NOT Exist (UI)
- Project list/detail/create/edit pages
- Estimate list/detail/create pages
- **THE TREE VIEW** — the core interaction, the estimate node tree
- Node create/edit forms
- Item detail editing
- Assembly detail editing
- Snapshot management UI
- Catalog browsing/adding
- Options management UI
- Client sharing UI
- Search/filter UI
- Company settings form
- User preferences panel

## Previous Prototypes (to extract from)
1. **EP (Estimating Platform)** — First attempt. Monolithic 46-column table. Had working UI.
2. **Soloway** — Second attempt. Fixed 5-level hierarchy. Had working UI with PIN auth + client sharing.
3. **Figma Make prototypes** — Zac has Figma designs for estimates, dashboard, login. Discussion needed on what to extract.

## Design System Constraints (NON-NEGOTIABLE)
- Zero hardcoded styles — CSS custom property tokens only
- Sharp corners on rectangles (rounded-none)
- Pill shape for buttons (rounded-full)
- Clean, modern, minimalistic aesthetic
- "Generic AI slop" is explicitly rejected

## Previous Failure Modes (ALL THREE)
1. Built UI before data layer was stable → schema changes broke frontend
2. Generic AI-generated look and feel → no personality, no craft
3. Wrong component architecture → too coupled, couldn't iterate

## Current Advantage
Phase 1A is COMPLETE. The data layer is stable. Failure mode #1 is eliminated.
Failure modes #2 and #3 must be addressed through deliberate UI architecture.

## Key Open Questions
- What to extract from Figma vs EP vs Soloway prototypes
- Component library approach (custom vs headless UI like Radix/Ark)
- State management for tree view (useReducer, Zustand, Jotai?)
- Real-time collaboration patterns (Supabase Realtime channels)
- How to structure the estimate tree view component
- When/how to get Zac's feedback at each design decision point
