# ShossyWorks -- Design Intent

> This is a living document maintained by the finish-session protocol.
> Agent 2 of the documentation agent swarm curates this file every session.

## Project Vision

ShossyWorks is a newly created project under the Shossy-lab organization. Its specific purpose and scope will be defined as development begins. This document will capture all design decisions and trade-offs as the project takes shape.

## Design Principles

1. **Start with structure** -- Claude Code setup deployed from day one so every session benefits from session protocols, contracts, and documentation agents.
2. **Document decisions as they happen** -- Use this INTENT.md and the contract system to capture the "why" behind every architectural choice, not just the "what."
3. **Iterate with confidence** -- The session handoff system ensures continuity across sessions, enabling ambitious multi-session work.

## Key Decisions

| # | Decision | Reasoning | Date | Alternatives Considered |
|---|----------|-----------|------|------------------------|
| 1 | Deploy full Claude setup from initial commit | Establishes documentation discipline and session protocols before any code exists, preventing retroactive documentation debt | 2026-04-02 | Minimal setup first, add structure later |

## Trade-offs

- **We chose full Claude setup overhead over a bare repo** because the session protocol, contracts, and documentation agents pay for themselves within the first few sessions of active development.

## Constraints

- Development environment: Windows 11, Git Bash, repos at A:\
- Hosting/deployment stack: Vercel + Supabase (standard stack per global CLAUDE.md)
- All secrets in Azure Key Vault -- never hardcoded

## Future Considerations

- **Stack selection** -- TypeScript/Next.js is the default stack per global preferences, but this should be confirmed when the project purpose is defined.
- **Database setup** -- Supabase project creation deferred until data requirements are known.

## Removal Protection

Items in this file should only be removed if:
- The decision has been explicitly reversed with user approval
- The feature/system the decision relates to has been deleted
- Never remove a decision just because it seems outdated -- it may still inform future work
