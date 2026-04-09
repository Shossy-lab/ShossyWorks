# Codebase Review — Shared Brief

## Project Profile
- **Project:** ShossyWorks — Construction estimating platform (Next.js + Supabase + Vercel)
- **Stage:** Early — Phase 0 complete (scaffolding + auth), Phase 1A (database schema) not started
- **App code:** ~721 LOC (13 TS, 10 TSX, 1 CSS, 1 SQL migration)
- **Stack:** Next.js 16.2.2, React 19.2.4, Supabase (@supabase/ssr + @supabase/supabase-js), TypeScript, Tailwind CSS 4, Vitest, Zod
- **Router:** App Router (src/app/)
- **Auth:** Supabase Auth with Custom Access Token Hook (role injection into JWT)
- **Database:** 1 migration applied (app_role enum, user_roles table, custom_access_token_hook)
- **Tests:** 2 test files (8 tests — smoke + security), all passing
- **Deployment:** Vercel (https://shossy-works.vercel.app)
- **Env management:** Azure Key Vault → pull-env.sh → .env.local, T3 env validation with Zod

## Key Files
- `src/env.ts` — T3 env validation (Zod schemas)
- `src/lib/supabase/client.ts` — Browser Supabase client
- `src/lib/supabase/server.ts` — Server Supabase client
- `src/lib/supabase/admin.ts` — Admin client (server-only, bypasses RLS)
- `src/lib/supabase/middleware.ts` — Token refresh + route protection
- `src/middleware.ts` — Next.js middleware entry point
- `src/app/(auth)/sign-in/page.tsx` — Sign-in page
- `src/app/(auth)/sign-up/page.tsx` — Sign-up page
- `src/app/(protected)/layout.tsx` — Protected layout with sidebar
- `src/components/nav/sidebar.tsx` — Collapsible sidebar navigation
- `src/components/nav/user-menu.tsx` — User menu with sign-out
- `src/app/globals.css` — CSS custom properties (design tokens)
- `scripts/pull-env.sh` — Azure Key Vault → .env.local
- `supabase/migrations/00000000000001_auth_roles.sql` — Auth schema
- `DESIGN-SYSTEM.md` — Design token documentation

## Your Mission
You are one of 13 specialized analysis agents reviewing this codebase. Your job is to find real problems with evidence (file paths, line numbers, code snippets). Superficial analysis is professional failure.

## Anti-Sycophancy Rules
- You MUST find at least 3 findings rated HIGH or above
- If the codebase seems perfect, you are not looking hard enough
- Do NOT soften findings. State them directly with evidence.
- If you genuinely find nothing, explain WHY — what patterns make this area resilient

## Severity Definitions
| Severity | Definition | Action |
|----------|-----------|--------|
| CRITICAL | Data loss, security breach, production outage, legal liability | Immediate fix. Blocks deployment. |
| HIGH | Significant reliability, security, or maintainability impact | Fix within current sprint. |
| MEDIUM | Reduces quality or DX. Accumulates as tech debt. | Fix when touching related code. |
| LOW | Style issues, minor improvements. | Fix opportunistically. |

## Review Depth: standard
Report CRITICAL and HIGH findings. Mention MEDIUM only if particularly noteworthy.
