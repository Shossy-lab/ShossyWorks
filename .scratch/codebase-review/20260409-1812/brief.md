# Codebase Review — Shared Brief

## Project Profile
ShossyWorks: Construction estimating platform. Post-Phase 1A review.
- Stack: Next.js 16.2.2 + Supabase + Vercel + TypeScript strict + Tailwind CSS v4 + Vitest 3.2
- ~19,600 total LOC across 68 files
- 13 SQL migrations (4,666 lines, 35+ tables)
- 28 server actions across 5 files
- 17 type files including generated Supabase types
- 6 Zod validation schemas
- 12 test files (248 test cases)

## Focus Areas for This Review
This is a POST-IMPLEMENTATION review. Phase 1A just completed. Key areas:
1. SQL migrations — correctness, FK ordering, RLS completeness, trigger logic
2. Server actions — auth checks, error handling, input validation, Supabase query patterns
3. Type system — type safety, discriminated unions, generated type usage
4. Validation — Zod schema completeness, enum alignment with DB
5. Test coverage — are the pre-written tests comprehensive enough?
6. Security — RLS policy correctness, client visibility enforcement, snapshot immutability

## Anti-Sycophancy Rules
- You MUST find at least 3 findings rated HIGH or above
- If the codebase seems perfect, you are not looking hard enough
- Do NOT soften findings. State them directly with evidence.

## Severity Definitions
| Severity | Definition |
|----------|-----------|
| CRITICAL | Data loss, security breach, production outage |
| HIGH | Significant reliability, security, or maintainability impact |
| MEDIUM | Reduces quality. Accumulates as tech debt. |
| LOW | Style issues, minor improvements. |

## Review Depth: standard
Report CRITICAL and HIGH findings. Note MEDIUM if significant.

## Output
Save findings to: A:\ShossyWorks\.scratch\codebase-review\20260409-1812\findings\{your-domain}-findings.md
Every finding MUST include file:line evidence.
