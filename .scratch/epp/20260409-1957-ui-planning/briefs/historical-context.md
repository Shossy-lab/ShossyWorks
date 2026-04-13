# Historical Context — What Went Wrong Before

## Attempt 1: EP (Estimating Platform)
- Monolithic 46-column table with massive NULL density
- UI built simultaneously with data layer — every schema change broke the frontend
- Component architecture was too coupled — couldn't iterate without rewriting
- Over-engineered for flexibility at the database level, under-engineered at the UI level

## Attempt 2: Soloway (Client Proposal Viewer)
- Fixed 5-level hierarchy — too rigid for real estimates
- Read-only by design (data came from Excel)
- When editing was bolted on, the architecture couldn't support it — everything was designed for immutable data
- Key successes to PRESERVE: tree rendering with expand/collapse, option selection UI with inline panels, real-time sync during budget meetings, option sets as overlay

### What Worked in Soloway (EXTRACT THESE PATTERNS)
- Progressive disclosure via expand/collapse tree with depth-based formatting
- Option selection with bubble-up indicators
- Real-time option selection sync via Supabase Realtime
- Option Sets as "overlay" — preview scenarios without writing to DB
- Clean hierarchy display that clients understood

### What Failed in Soloway (AVOID THESE PATTERNS)
- Editing bolted on after read-only architecture
- Draft/publish workflow retrofitted onto immutable-data components
- No state management designed for mutation

## Attempt 3 (Current: ShossyWorks)
- Data layer is now STABLE (35+ tables, triggers, typed actions)
- Design system established (CSS tokens, sharp corners, pill buttons)
- Auth flow working
- BUT: zero real UI beyond auth shell and placeholder pages

## Zac's Explicit Feedback (from conversations)
- "FROM THE VERY BEGINNING we need to be extremely sure that absolutely no UI Design is done by hardcoding design, style, color, etc."
- "data and architecture come first" — confirmed data-first, now data IS first
- "The Current UI Design is very 'Generic AI Slop'. I really want to implement a clean, modern, minimalistic style"
- "No rounded corners on rectangles" — sharp corners on all containers
- "I prefer round button shapes, and pill button shapes"
- "I have a Figma Make Project" — Figma prototypes exist but discussion needed on what to extract
- "this is incredibly delicate and important" — UI is where previous attempts failed
- "catastrophic" if we have to rebuild

## What's Different This Time
1. Data layer is complete and stable before ANY UI work starts
2. Design system with CSS tokens established upfront
3. Component architecture will be deliberate, researched, and approved before implementation
4. State management designed for mutation + real-time from day one
5. Deep planning with review boards before writing any UI code

## Key Principle from INTENT.md
"Bottom-up stability. Each layer must be provably correct before anything is built on top of it."
The data layer IS stable. Now the UI layer must be designed with the same rigor.
