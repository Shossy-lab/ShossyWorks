# Research: CSS Token Bugs & Dependencies/Config

**Date:** 2026-04-03
**Clusters:** 7 (CSS Token Bugs), 8 (Dependencies & Config)
**Sources:** Tailwind CSS v4 official docs, GitHub issue tracker, Supabase SSR changelog, t3-env docs, npm registry

---

## Cluster 7: CSS Token Bugs

### Finding 7.1: `font-[var(--font-bold)]` Generates Wrong CSS Property

**Problem:** 16 occurrences across 7 files use `font-[var(--font-bold)]` (and similar for `--font-semibold`, `--font-medium`, `--font-normal`). Tailwind v4 interprets `font-[var()]` as a **font-family** declaration, not font-weight, because `--font-*` is the font-family namespace. This generates `font-family: 700` -- completely broken CSS.

**Root cause confirmed:** GitHub issue [tailwindlabs/tailwindcss#16652](https://github.com/tailwindlabs/tailwindcss/issues/16652) documents this exact behavior. The `font-*` namespace in Tailwind v4 maps to `--font-*` = font-family. When you write `font-[var(--font-bold)]`, Tailwind resolves to `font-family: var(--font-bold)` which expands to `font-family: 700` -- nonsensical.

**Correct Tailwind v4 approach (two options):**

**Option A (recommended): Register tokens via `@theme`**

The `globals.css` currently defines font weights in `:root` as `--font-normal: 400`, `--font-bold: 700`, etc. These need to move to (or be mirrored in) the `@theme` block using the correct `--font-weight-*` namespace:

```css
@import "tailwindcss";

@theme {
  /* Font weights -- uses --font-weight-* namespace */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
}
```

This generates standard Tailwind utilities that work correctly:
```html
<!-- Before (BROKEN) -->
<h1 class="font-[var(--font-bold)]">Title</h1>

<!-- After (CORRECT) -->
<h1 class="font-bold">Title</h1>
```

**Option B: Type-hinted arbitrary value (fallback only)**

If you need to reference a CSS variable that is NOT registered in `@theme`:
```html
<!-- Explicit type hint tells Tailwind this is a weight, not a family -->
<h1 class="font-(weight:--my-custom-weight)">Title</h1>

<!-- Equivalent longhand -->
<h1 class="font-[weight:var(--my-custom-weight)]">Title</h1>
```

**Fix complexity:** LOW -- mechanical find-and-replace
- Add `@theme` block with `--font-weight-*` entries (1 file change)
- Replace all 16 occurrences of `font-[var(--font-bold)]` -> `font-bold` (etc.) across 7 files
- Time estimate: 15-20 minutes (could be batched with a regex)

**Affected files (16 occurrences):**
- `src/components/nav/sidebar.tsx` (2)
- `src/app/(protected)/layout.tsx` (1)
- `src/app/(auth)/sign-up/page.tsx` (4)
- `src/app/(auth)/sign-in/page.tsx` (4)
- `src/app/(protected)/dashboard/page.tsx` (3)
- `src/app/(protected)/settings/page.tsx` (1)
- `src/app/(protected)/projects/page.tsx` (1)

---

### Finding 7.2: `duration-[var(--transition-fast)]` With Compound Token

**Problem:** 7 occurrences across 5 files use `duration-[var(--transition-fast)]` where `--transition-fast` is defined as `100ms ease` (a compound value with both duration AND easing). The `duration-*` utility maps to `transition-duration`, which only accepts a time value. Passing `100ms ease` to `transition-duration` produces invalid CSS.

**Correct Tailwind v4 approach: Split tokens, register via `@theme`**

Tailwind v4 has separate namespaces for duration (`--duration-*`) and easing (`--ease-*`). These must be defined independently:

```css
/* BEFORE (globals.css -- compound tokens in :root) */
:root {
  --transition-fast: 100ms ease;
  --transition-normal: 200ms ease;
  --transition-slow: 300ms ease;
}

/* AFTER (split into @theme with correct namespaces) */
@theme {
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;

  --ease-default: ease;
  /* Or use Tailwind's built-in ease-in-out, ease-out, etc. */
}
```

Component usage changes:
```html
<!-- Before (BROKEN -- compound value in duration slot) -->
<div class="transition-all duration-[var(--transition-fast)]">

<!-- After (CORRECT -- separate duration and easing) -->
<div class="transition-all duration-fast ease-default">

<!-- Or using built-in easing -->
<div class="transition-all duration-fast ease-in-out">
```

If you want to keep the `:root` variables for non-Tailwind usage (e.g., inline styles), use `@theme inline` to bridge:

```css
@theme inline {
  --duration-fast: var(--transition-duration-fast);
  --ease-default: var(--transition-ease-default);
}
```

**Fix complexity:** LOW-MEDIUM
- Restructure 3 transition tokens into 6 (3 duration + 3 easing) in globals.css
- Update 7 occurrences across 5 files
- Decision needed: use Tailwind built-in easing (`ease-in-out`) or define custom `--ease-default`
- Time estimate: 20-30 minutes

**Affected files (7 occurrences):**
- `src/components/nav/user-menu.tsx` (1)
- `src/components/nav/sidebar.tsx` (2)
- `src/app/(auth)/sign-up/page.tsx` (1)
- `src/app/(protected)/dashboard/page.tsx` (2)
- `src/app/(auth)/sign-in/page.tsx` (1)

---

### Finding 7.3: `text-[var(--text-sm)]` Ambiguity

**Problem:** 22 occurrences across 8 files use `text-[var(--text-sm)]` and similar. In Tailwind v4, `text-*` utilities serve dual purpose: font-size (`text-lg`) and color (`text-red-500`). When using a CSS variable, Tailwind cannot determine the intended property.

**Root cause:** The `text-[var(--text-sm)]` syntax is ambiguous because Tailwind v4 doesn't know if `--text-sm` holds a length (font-size) or a color value. It may resolve incorrectly or inconsistently.

**Correct Tailwind v4 approach (two options):**

**Option A (recommended): Register via `@theme`**

The `--text-*` variables are already using the correct Tailwind v4 namespace for font sizes. Move them into `@theme`:

```css
@theme {
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;

  /* Optional: line-height companions */
  --text-sm--line-height: 1.25rem;
  --text-base--line-height: 1.5rem;
}
```

Then use standard utilities:
```html
<!-- Before (AMBIGUOUS) -->
<p class="text-[var(--text-sm)]">

<!-- After (CORRECT -- standard Tailwind utility) -->
<p class="text-sm">
```

**Option B: Type-hinted arbitrary value**

If you must use variables not in `@theme`:
```html
<!-- Explicit length type hint resolves ambiguity -->
<p class="text-(length:--my-font-size)">

<!-- Equivalent longhand -->
<p class="text-[length:var(--my-font-size)]">
```

**Fix complexity:** LOW -- mechanical find-and-replace
- Add font-size entries to `@theme` block (same file as 7.1 fix)
- Replace 22 occurrences with standard `text-sm`, `text-base`, etc.
- Time estimate: 15-20 minutes (regex-friendly)

**Affected files (22 occurrences):**
- `src/components/nav/user-menu.tsx` (2)
- `src/components/nav/sidebar.tsx` (2)
- `src/app/(auth)/sign-up/page.tsx` (5)
- `src/app/(auth)/sign-in/page.tsx` (5)
- `src/app/(protected)/layout.tsx` (1)
- `src/app/(protected)/dashboard/page.tsx` (5)
- `src/app/(protected)/settings/page.tsx` (1)
- `src/app/(protected)/projects/page.tsx` (1)

---

### Finding 7.4: No `@theme` Block in globals.css

**Problem:** All design tokens live in `:root` CSS variables. No `@theme` block exists. This means Tailwind v4 has no awareness of the design system -- every usage requires verbose `[var(--token)]` arbitrary value syntax, and Tailwind cannot generate proper utility classes.

**Correct pattern:** Define tokens in BOTH `:root` (for CSS access) and `@theme` (for Tailwind utility generation). For tokens that only need Tailwind utilities, `@theme` alone is sufficient. Use `@theme inline` to bridge `:root` variables into the Tailwind theme.

**Recommended `@theme` block for this project:**

```css
@import "tailwindcss";

@theme {
  /* Colors -- register for Tailwind utility generation */
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f5f5f5;
  --color-bg-tertiary: #e5e5e5;
  --color-bg-inverse: #0a0a0a;

  --color-surface: #ffffff;
  --color-surface-hover: #fafafa;
  --color-surface-active: #f5f5f5;

  --color-border: #e5e5e5;
  --color-border-strong: #d4d4d4;
  --color-border-focus: #0a0a0a;

  --color-text-primary: #0a0a0a;
  --color-text-secondary: #525252;
  --color-text-tertiary: #a3a3a3;
  --color-text-inverse: #fafafa;
  --color-text-link: #0a0a0a;

  --color-interactive: #0a0a0a;
  --color-interactive-hover: #262626;
  --color-interactive-text: #fafafa;

  --color-success: #16a34a;
  --color-warning: #ca8a04;
  --color-error: #dc2626;
  --color-info: #2563eb;

  --color-success-bg: #f0fdf4;
  --color-warning-bg: #fefce8;
  --color-error-bg: #fef2f2;
  --color-info-bg: #eff6ff;

  /* Typography */
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", monospace;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Spacing -- Tailwind v4 auto-generates from --spacing-* */
  /* Only needed if overriding Tailwind defaults */

  /* Borders */
  --radius-none: 0;
  --radius-full: 9999px;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 2px 4px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 4px 8px rgba(0, 0, 0, 0.06), 0 2px 4px rgba(0, 0, 0, 0.04);

  /* Transitions -- separate duration and easing */
  --duration-fast: 100ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;

  --ease-default: ease;
}

/* Keep :root for CSS-only access (inline styles, JS, etc.) */
:root {
  --sidebar-width: 14rem;
  --sidebar-collapsed: 3.5rem;
  --header-height: 3.5rem;
  --content-max-width: 80rem;
}
```

**Fix complexity:** MEDIUM
- Create the `@theme` block (restructure globals.css)
- Decide which tokens live in `@theme` only vs both `@theme` and `:root`
- Remove `:root` duplicates where `@theme` suffices
- Time estimate: 30-45 minutes (mostly decision-making, actual code change is small)

---

### Finding 7.5: `disabled:opacity-50` Magic Number

**Problem:** `disabled:opacity-50` uses a hardcoded value not backed by a design token.

**Recommended fix:** Define an opacity token if the design system needs it:

```css
@theme {
  --opacity-disabled: 0.5;
}
```

```html
<button class="disabled:opacity-disabled">
```

Alternatively, if 50% is the standard disabled opacity across the app and doesn't need to be configurable, document it as an intentional convention and skip tokenization. Not everything needs a token -- only values that vary across themes or need centralized control.

**Fix complexity:** TRIVIAL -- decide whether to tokenize or document as convention.

---

### Cluster 7 Summary: Recommended Fix Order

| # | Finding | Complexity | Impact | Fix Order |
|---|---------|-----------|--------|-----------|
| 7.4 | Add `@theme` block | MEDIUM | Enables all other fixes | 1st |
| 7.1 | font-weight tokens | LOW | 16 broken CSS rules | 2nd |
| 7.3 | text-size ambiguity | LOW | 22 ambiguous rules | 3rd |
| 7.2 | transition tokens | LOW-MEDIUM | 7 invalid CSS rules | 4th |
| 7.5 | opacity magic number | TRIVIAL | Cosmetic | Last |

**Total estimated time: 1.5-2 hours** (including testing)
**Total files to modify: 9** (1 CSS + 8 component files)
**Total string replacements: 45** (16 + 22 + 7)

---

## Cluster 8: Dependencies & Config

### Finding 8.1: `@t3-oss/env-core` Version Mismatch

**Problem:** `package.json` lists:
- `@t3-oss/env-nextjs: ^0.12` (resolves to 0.12.x)
- `@t3-oss/env-core: ^0.13.11` (resolves to 0.13.x)

The `env-nextjs` package internally depends on `env-core` via its own version range. When env-nextjs@0.12 is installed, it brings its own env-core@0.12. But the direct dep installs env-core@0.13.11 separately. This results in **two copies** of env-core in node_modules, which can cause type mismatches and subtle runtime bugs (different `createEnv` implementations).

**Research finding:** Both packages are published from a monorepo and versions are synchronized. The env-nextjs package uses `workspace:*` internally, which resolves to the matching version on publish. **Versions must be aligned.**

**Correct fix:** Align both to the latest version:

```jsonc
// package.json
{
  "dependencies": {
    "@t3-oss/env-nextjs": "^0.13.11",
    // REMOVE @t3-oss/env-core -- it is a transitive dependency of env-nextjs
    // Only add it explicitly if you import from it directly
  }
}
```

**However**, `src/env.ts` imports `@t3-oss/env-core/presets-zod` directly:
```ts
import { vercel } from "@t3-oss/env-core/presets-zod";
```

This means env-core IS needed as a direct dependency. Both must be at the same minor version:

```jsonc
{
  "dependencies": {
    "@t3-oss/env-core": "^0.13.11",
    "@t3-oss/env-nextjs": "^0.13.11"
  }
}
```

**Breaking changes 0.12 -> 0.13:** The t3-env packages added support for Zod 4 alongside Zod 3 (peer dep: `^3.24.0 || ^4.0.0`), added valibot and arktype validator support, and switched to `tsdown` build tooling. No breaking API changes for the `createEnv` call signature.

**Fix complexity:** TRIVIAL
- Update version in `package.json`
- Run `npm install`
- Test build
- Time estimate: 5 minutes

---

### Finding 8.2: `@supabase/ssr` Critically Outdated (0.6.1 vs 0.10.0)

**Problem:** Installed version is 0.6.1, latest is 0.10.0. This is a pre-1.0 package, so minor version bumps can contain breaking changes per semver convention.

**Changelog analysis (0.6.1 -> 0.10.0):**

| Version | Date | Key Changes | Breaking? |
|---------|------|-------------|-----------|
| 0.6.1 | 2025-03 | Reverted cookie encoding changes from 0.6.0 | No |
| 0.7.0 | 2025-08 | Bumped `cookie` lib to 1.0.2 | No |
| 0.8.0 | 2025-11 | Added `cookies.encode` option for size optimization; updated supabase-js | **Potentially** |
| 0.8.1 | 2026-03 | Added `skipAutoInitialize` to prevent SSR token refresh race condition | No (additive) |
| 0.9.0 | 2026-03 | Release workflow improvements only | No |
| 0.10.0 | 2026-03 | Cache headers to prevent CDN caching of auth responses | No (additive) |

**Migration risk: LOW.** No breaking changes to `createBrowserClient`/`createServerClient` signatures. The main additions are:
1. `cookies.encode` option (optional, defaults to existing behavior)
2. `skipAutoInitialize` flag (optional, helps with SSR race conditions)
3. Cache headers for CDN safety (automatic)

**Recommended update path:**

```jsonc
// package.json
{
  "dependencies": {
    "@supabase/ssr": "^0.10.0"
  }
}
```

After updating, consider adding `skipAutoInitialize` if you observe token refresh issues in SSR:

```ts
// In your server client factory
const supabase = createServerClient(url, key, {
  cookies: { /* existing cookie config */ },
  auth: { skipAutoInitialize: true }  // Prevents SSR race condition
});
```

**Fix complexity:** LOW
- Update version in `package.json`
- Run `npm install`
- Test auth flows (sign-in, sign-up, protected routes)
- Optionally add `skipAutoInitialize`
- Time estimate: 15-30 minutes (mostly testing)

---

### Finding 8.3: No Automated Dependency Updates

**Problem:** No Dependabot or Renovate configuration exists. Dependencies drift silently.

**Recommended: Dependabot** (simpler, built into GitHub)

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 10
    groups:
      supabase:
        patterns:
          - "@supabase/*"
      tailwind:
        patterns:
          - "tailwindcss"
          - "@tailwindcss/*"
          - "prettier-plugin-tailwindcss"
      react:
        patterns:
          - "react"
          - "react-dom"
          - "@types/react"
          - "@types/react-dom"
      t3-env:
        patterns:
          - "@t3-oss/*"
      linting:
        patterns:
          - "eslint"
          - "eslint-config-next"
          - "prettier"
      testing:
        patterns:
          - "vitest"
    ignore:
      # Pin major versions for stability
      - dependency-name: "next"
        update-types: ["version-update:semver-major"]
      - dependency-name: "react"
        update-types: ["version-update:semver-major"]

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

**Fix complexity:** TRIVIAL
- Create `.github/dependabot.yml`
- Time estimate: 5 minutes

---

### Finding 8.4: Missing `engines` and `type` Fields in package.json

**Problem:** No `engines` field means the project doesn't declare which Node.js version it requires. No `type` field means the module system is ambiguous (though Next.js handles this).

**Recommended fix:**

```jsonc
{
  "name": "shossyworks",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  // ...
}
```

Also narrow the `@types/node` range to match:

```jsonc
{
  "devDependencies": {
    "@types/node": "^20.17.0"
  }
}
```

**Fix complexity:** TRIVIAL -- 3 lines in package.json. Time: 2 minutes.

---

### Finding 8.5: Inconsistent Version Pinning Strategy

**Problem:** Mix of exact versions (`"next": "16.2.2"`), narrow caret (`"^0.6"`), and wide caret (`"^4"`, `"^20"`). No clear pinning strategy.

**Recommended strategy for this project:**

| Category | Strategy | Example | Rationale |
|----------|----------|---------|-----------|
| Framework (Next, React) | Exact or narrow | `"16.2.2"`, `"19.2.4"` | Breaking changes common, test before updating |
| Pre-1.0 packages | Exact minor | `"~0.10.0"` | Minor = breaking per semver |
| Stable deps (>=1.0) | Caret | `"^3.24"` | Patches and minors are safe |
| Types packages | Caret | `"^20.17"` | Follow language version |
| Build tools (dev) | Caret | `"^4"` | Wide range is fine for dev-only |

Applied to current deps:

```jsonc
{
  "dependencies": {
    "@supabase/ssr": "~0.10.0",        // Pre-1.0: pin to minor
    "@supabase/supabase-js": "^2.49",  // Stable: caret OK
    "@t3-oss/env-core": "^0.13.11",    // Align with env-nextjs
    "@t3-oss/env-nextjs": "^0.13.11",  // Align with env-core
    "next": "16.2.2",                   // Exact: framework
    "react": "19.2.4",                  // Exact: framework
    "react-dom": "19.2.4",             // Exact: framework
    "server-only": "^0.0.1",           // Trivial package
    "zod": "^3.24"                     // Stable: caret OK
  }
}
```

**Fix complexity:** TRIVIAL -- version string edits. Time: 5 minutes.

---

### Finding 8.6: `pull-env.sh` Maps Unused `SUPABASE_PUBLISHABLE_KEY`

**Problem:** The `pull-env.sh` script maps a `SUPABASE_PUBLISHABLE_KEY` variable that no code references.

**Research context:** Supabase is transitioning from "anon key" to "publishable key" (`sb_publishable_xxx`). The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` will eventually be deprecated. However, the code currently uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the `pull-env.sh` script maps a different name that nothing consumes.

**Recommended fix:** Either:
1. Remove `SUPABASE_PUBLISHABLE_KEY` from `pull-env.sh` (clean up dead mapping), OR
2. If migrating to the new key format, update `src/env.ts` client section to also accept the new name

For now, option 1 is simpler. Migration to publishable keys can happen later.

**Fix complexity:** TRIVIAL -- delete one line from a shell script. Time: 2 minutes.

---

### Finding 8.7: All Server Env Vars Marked `.optional()` in Zod Schema

**Problem:** Every server-side variable in `src/env.ts` is `.optional()`, which defeats the purpose of build-time validation. If `SUPABASE_SERVICE_ROLE_KEY` is missing in production, the app will start but crash at runtime.

**Current state:**
```ts
server: {
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  DATABASE_URL: z.string().startsWith("postgres").optional(),
  // ... all optional
}
```

**Recommended: Required in production, optional in development**

The `createEnv` function supports the `skipValidation` flag (already wired to `SKIP_ENV_VALIDATION`). The proper approach is to make core vars required and only skip validation during specific scenarios (CI, codegen):

```ts
export const env = createEnv({
  extends: [vercel()],

  server: {
    // REQUIRED: Core Supabase server access
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

    // REQUIRED: Database access (at least one)
    DATABASE_URL: z.string().startsWith("postgres"),

    // OPTIONAL: Convenience/secondary connections
    DIRECT_DATABASE_URL: z.string().startsWith("postgres").optional(),
    SUPABASE_DB_PASSWORD: z.string().min(1).optional(),
    SUPABASE_PROJECT_ID: z.string().min(1).optional(),

    // OPTIONAL: May not be needed in all environments
    SUPABASE_JWT_SECRET: z.string().min(32).optional(),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),

    // OPTIONAL: Feature-specific
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    CRON_SECRET: z.string().min(16).optional(),

    // Has default
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },

  client: {
    // All client vars should be REQUIRED (app won't work without them)
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
    NEXT_PUBLIC_APP_URL: z.string().url(),
  },

  // ...
});
```

**Which vars should be required vs optional:**

| Variable | Required? | Rationale |
|----------|-----------|-----------|
| `SUPABASE_SERVICE_ROLE_KEY` | YES | Server-side Supabase operations need this |
| `DATABASE_URL` | YES | App cannot function without DB access |
| `DIRECT_DATABASE_URL` | No | Pooled connection fallback |
| `SUPABASE_DB_PASSWORD` | No | Only needed for migration tooling |
| `SUPABASE_PROJECT_ID` | No | Only needed for CLI operations |
| `SUPABASE_JWT_SECRET` | No | Only needed for custom JWT verification |
| `SUPABASE_SECRET_KEY` | No | Legacy / backup key |
| `ANTHROPIC_API_KEY` | No | Feature-gated AI functionality |
| `CRON_SECRET` | No | Only needed if cron endpoints exist |
| `NODE_ENV` | Has default | Always present via default value |
| `NEXT_PUBLIC_SUPABASE_URL` | YES | Client can't connect without it |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | YES | Client auth requires it |
| `NEXT_PUBLIC_APP_URL` | YES | Redirects and URL construction need it |

**Fix complexity:** LOW
- Edit Zod schemas in `src/env.ts`
- Ensure `.env.local` has all required vars
- Test build locally
- Time estimate: 10-15 minutes

---

### Finding 8.8: No ESLint TypeScript-Specific Rules

**Problem:** ESLint is configured but lacks TypeScript-specific rules.

**Recommended fix:** This is a broader tooling concern. The current `eslint-config-next` provides React/Next rules but not TypeScript strict checking. Consider adding `@typescript-eslint/eslint-plugin` with recommended rules.

**Fix complexity:** MEDIUM -- requires installing packages, configuring rules, and fixing any new lint errors. Better addressed as a separate task. Time: 1-2 hours depending on existing violations.

---

### Cluster 8 Summary: Recommended Fix Order

| # | Finding | Complexity | Risk if Unfixed | Fix Order |
|---|---------|-----------|-----------------|-----------|
| 8.1 | env-core version mismatch | TRIVIAL | Dual-copy type bugs | 1st |
| 8.2 | @supabase/ssr outdated | LOW | Missing security patches | 2nd |
| 8.7 | All server env optional | LOW | Silent production failures | 3rd |
| 8.4 | Missing engines/type | TRIVIAL | Wrong Node version deploys | 4th |
| 8.5 | Inconsistent pinning | TRIVIAL | Unexpected updates | 5th |
| 8.6 | Unused env mapping | TRIVIAL | Confusion | 6th |
| 8.3 | No Dependabot | TRIVIAL | Future drift | 7th |
| 8.8 | No TS ESLint rules | MEDIUM | Missed type errors | Separate task |

**Total estimated time: 1-1.5 hours** (excluding 8.8)
**Total files to modify: 4** (package.json, src/env.ts, pull-env.sh, .github/dependabot.yml)

---

## Combined Implementation Plan

### Phase 1: CSS Token Infrastructure (globals.css)
1. Add `@theme` block with all design tokens (colors, typography, weights, sizes, durations, easing, shadows, radii)
2. Split compound `--transition-*` tokens into `--duration-*` + `--ease-*`
3. Rename `--font-normal/medium/semibold/bold` to `--font-weight-*` namespace
4. Keep `:root` for layout-only tokens (sidebar, header, content-max-width)

### Phase 2: Component Token Migration (8 files, 45 replacements)
1. `font-[var(--font-bold)]` -> `font-bold` (16 occurrences)
2. `text-[var(--text-sm)]` -> `text-sm` (22 occurrences)
3. `duration-[var(--transition-fast)]` -> `duration-fast ease-default` (7 occurrences)

### Phase 3: Dependency Fixes (package.json + npm install)
1. Align `@t3-oss/env-nextjs` to `^0.13.11`
2. Update `@supabase/ssr` to `~0.10.0`
3. Add `engines` and `type` fields
4. Standardize version pinning

### Phase 4: Env Validation (src/env.ts)
1. Make `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` required
2. Keep feature-specific vars optional
3. Clean up `pull-env.sh`

### Phase 5: Tooling (separate PR)
1. Add `.github/dependabot.yml`
2. Add TypeScript ESLint rules (optional, larger effort)

**Total estimated time for Phases 1-4: 2.5-3.5 hours**
**Total files modified: 13** (1 CSS + 8 components + package.json + env.ts + pull-env.sh + dependabot.yml)
