# Codebase Profile — ShossyWorks Post-Phase 1A

**Date:** 2026-04-09T18:13:08-04:00
**Phase:** Post-Phase 1A (schema + actions + types complete)

## File Counts
| Category | Files | Lines |
|----------|-------|-------|
| TypeScript (src/) | 44 | 778 |
| SQL (migrations) | 13 | 4666 |
| Tests | 12 | 9400 |
| CSS | 1 | 150 |
| **Total** | **70** | **14994** |

## Stack
Next.js 16.2.2, Supabase, Vercel, TypeScript strict, Tailwind CSS v4, Vitest 3.2

## Key Directories
- src/lib/actions/ — 5 server action files (28 actions)
- src/lib/types/ — 7 type files + supabase.ts generated
- src/lib/validation/ — 6 Zod schema files
- src/lib/supabase/ — 4 client factories (now typed with Database generic)
- supabase/migrations/ — 13 migration files (35+ tables, triggers, functions)
- tests/ — 12 test files (248 test cases)
