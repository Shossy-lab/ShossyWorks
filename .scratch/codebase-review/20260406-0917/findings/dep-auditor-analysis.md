# A11 -- Dependency Auditor Analysis

**Agent:** A11 (Dependency Auditor)
**Domain:** Dependencies -- npm audit, outdated packages, version pinning, lockfile integrity, supply chain, license compliance
**Date:** 2026-04-06
**Project:** ShossyWorks (Next.js 16.2.2 + Supabase + Vercel)

---

## Executive Summary

The dependency landscape is in generally healthy shape for an early-stage project: zero npm audit vulnerabilities, a committed lockfile with SHA-512 integrity hashes, all packages from the official npm registry, no typosquatting indicators, and all licenses are permissive (MIT, BSD-2-Clause, Apache-2.0). However, several significant issues exist: a version mismatch in the T3 env validation stack that ships two copies of `@t3-oss/env-core` to production, a critically outdated `@supabase/ssr` package (0.6.1 vs 0.10.0), no automated dependency update tooling, missing `engines` and `type` fields in `package.json`, and an inconsistent version pinning strategy.

**Finding count:** 3 HIGH, 5 MEDIUM, 3 LOW

---

## Findings

---

### DEP-01: @t3-oss/env-core Version Mismatch -- Two Copies in Bundle

**Severity:** HIGH
**Checklist refs:** #120 (Duplicate Dependencies), #116 (Outdated Dependencies), #126 (Package.json Quality)
**Files:** `package.json:6-7` (`@t3-oss/env-core` and `@t3-oss/env-nextjs`), `src/env.ts:1-2`

**Evidence:**

```
$ npm ls @t3-oss/env-core
shossyworks@0.1.0
+-- @t3-oss/env-core@0.13.11          <-- direct dependency
`-- @t3-oss/env-nextjs@0.12.0
  `-- @t3-oss/env-core@0.12.0         <-- nested, different version
```

The project declares `@t3-oss/env-core@^0.13.11` as a direct dependency AND `@t3-oss/env-nextjs@^0.12` as another direct dependency. The problem is that `@t3-oss/env-nextjs@0.12.0` pins its own dependency on `@t3-oss/env-core` to exactly `0.12.0`. Since the top-level `env-core` resolves to `0.13.11`, npm installs a second nested copy at `node_modules/@t3-oss/env-nextjs/node_modules/@t3-oss/env-core@0.12.0`.

In `src/env.ts`, the code does:
```typescript
import { createEnv } from "@t3-oss/env-nextjs";       // uses env-core@0.12.0 internally
import { vercel } from "@t3-oss/env-core/presets-zod"; // uses env-core@0.13.11
```

This means `createEnv()` operates on env-core 0.12.0 types/internals while the `vercel()` preset function was built against env-core 0.13.11. If internal type shapes or validation logic differ between 0.12 and 0.13, this can cause subtle runtime failures during env validation -- particularly dangerous because env validation runs at build time and module initialization.

**Fix:** Upgrade `@t3-oss/env-nextjs` to `^0.13.11` (matching `@t3-oss/env-core`). The latest `@t3-oss/env-nextjs@0.13.11` depends on `@t3-oss/env-core@0.13.11`, which will deduplicate to a single copy:

```json
{
  "@t3-oss/env-core": "^0.13.11",
  "@t3-oss/env-nextjs": "^0.13.11"
}
```

This also adds arktype support in `env-core` exports (new in 0.13) and Zod 4 peer dep compatibility.

---

### DEP-02: @supabase/ssr Critically Outdated (0.6.1 vs 0.10.0)

**Severity:** HIGH
**Checklist refs:** #116 (Outdated Dependencies), #74 (Auth Helpers Migration)
**Files:** `package.json:23` (`@supabase/ssr`), `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/middleware.ts`

**Evidence:**

```
$ npm outdated
@supabase/ssr    0.6.1   0.6.1   0.10.0
```

The package is pinned to `^0.6` (resolves to 0.6.1) while the latest is 0.10.0. This is a 4-minor-version gap in a pre-1.0 package where semver conventions treat minor bumps as potentially breaking. Between 0.6 and 0.10, Supabase has iterated significantly on their SSR cookie handling, middleware patterns, and auth token refresh logic. The `^0.6` range will never pull 0.7+ because caret ranges on 0.x versions only accept patch bumps.

This is particularly concerning because:
1. `@supabase/ssr` is the primary auth infrastructure package
2. Pre-1.0 packages often have security-relevant fixes in minor versions
3. The Supabase team has published breaking API changes to middleware and cookie handling between these versions
4. The project is early enough that upgrading now has near-zero migration cost

**Fix:** Update to `"@supabase/ssr": "^0.10.0"` and verify the middleware/client factory APIs still match. Peer dep requirement is `@supabase/supabase-js@^2.100.1` which is satisfied by the current `2.101.1`.

---

### DEP-03: No Automated Dependency Update Tooling

**Severity:** HIGH
**Checklist refs:** #130 (Dependency Pinning Strategy), #116 (Outdated Dependencies)
**Files:** Missing `.github/dependabot.yml` or `renovate.json`

**Evidence:**

Checked for all common config files:
- `.github/dependabot.yml` -- MISSING
- `renovate.json` -- MISSING
- `.github/renovate.json` -- MISSING
- `renovate.json5` -- MISSING

With 21 direct dependencies (9 runtime, 12 dev) and 537 total resolved packages, manual dependency management will inevitably lead to drift. The project already has 9 outdated packages (see npm outdated output), and this gap will only widen. Without automated PRs, security patches in transitive dependencies will go unnoticed.

The current state combines caret ranges (which auto-bump on install) with no automation (which means `npm install` at different times produces different results). The lockfile provides reproducibility, but without automation there is no systematic process to evaluate and apply updates.

**Fix:** Add Dependabot or Renovate. Minimal Dependabot config:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
```

---

### DEP-04: Missing `engines` Field in package.json

**Severity:** MEDIUM
**Checklist refs:** #126 (Package.json Quality)
**Files:** `package.json`

**Evidence:**

```javascript
// package.json has no engines field
engines: undefined
type: undefined
packageManager: undefined
```

Next.js 16.2.2 requires Node.js 18.18.0 or later. React 19 requires Node.js 18+. Without an `engines` field, contributors or CI systems could attempt builds with incompatible Node.js versions, producing cryptic errors rather than a clear "wrong Node version" message.

The missing `type` field means the project defaults to CommonJS module resolution. While Next.js handles this internally via its own module system, explicit declaration prevents confusion and future compatibility issues -- especially since TypeScript 5 and ESM are becoming the default.

**Fix:**

```json
{
  "engines": {
    "node": ">=18.18.0"
  },
  "type": "module"
}
```

Consider also adding `"packageManager": "npm@10.x"` to enforce consistent package manager usage via Corepack.

---

### DEP-05: Inconsistent Version Pinning Strategy

**Severity:** MEDIUM
**Checklist refs:** #130 (Dependency Pinning Strategy)
**Files:** `package.json`

**Evidence:**

The version ranges show an inconsistent strategy with no clear rationale:

| Strategy | Packages |
|----------|----------|
| Exact pin | `next@16.2.2`, `react@19.2.4`, `react-dom@19.2.4`, `eslint-config-next@16.2.2` |
| Caret (narrow) | `@t3-oss/env-core@^0.13.11`, `dotenv@^17.4.0` |
| Caret (wide) | `@tailwindcss/postcss@^4`, `@types/node@^20`, `eslint@^9`, `prettier@^3`, `typescript@^5`, `vitest@^3`, `zod@^3.24` |
| Caret (pre-1.0) | `@supabase/ssr@^0.6` (effectively pinned to 0.6.x patches), `prettier-plugin-tailwindcss@^0.6`, `server-only@^0.0.1` |

Wide caret ranges like `^4` and `^5` will accept any version from 4.0.0 to 4.x.x, meaning `npm install` without a lockfile could pull significantly different versions. The pre-1.0 caret ranges behave differently from major-version carets (caret on `^0.6` only allows `0.6.x` patches, not `0.7+`).

This is not a critical risk because the lockfile provides determinism, but the inconsistency signals a lack of deliberate dependency management policy. Some packages are pinned for stability (Next.js, React) while others have ranges spanning potential breaking changes.

**Fix:** Establish a consistent strategy. Recommended for this project:
- **Exact pin:** Framework core (Next.js, React, React DOM) -- already done
- **Caret with minor:** All other runtime deps (e.g., `^0.10.0`, `^3.24.0`)
- **Caret wide:** Dev-only tools (ESLint, Prettier, TypeScript, Vitest) -- acceptable since they don't ship to production

Document the strategy in INTENT.md or a contributing guide.

---

### DEP-06: Extraneous WASM/NAPI Packages in node_modules

**Severity:** MEDIUM
**Checklist refs:** #128 (Native/Binary Dependencies), #127 (Import Analysis)
**Files:** `node_modules/@emnapi/`, `node_modules/@napi-rs/`, `node_modules/@tybys/`

**Evidence:**

```
$ npm ls --depth=0
+-- @emnapi/core@1.9.2 extraneous
+-- @emnapi/runtime@1.9.2 extraneous
+-- @emnapi/wasi-threads@1.2.1 extraneous
+-- @napi-rs/wasm-runtime@0.2.12 extraneous
+-- @tybys/wasm-util@0.10.1 extraneous
```

These 5 packages are hoisted WASM/NAPI runtime dependencies from `@tailwindcss/oxide-wasm32-wasi`, `@img/sharp-wasm32`, and `@unrs/resolver-binding-wasm32-wasi`. They are marked "extraneous" by npm because no direct dependency chain from `package.json` lists them explicitly. They are legitimate dependencies of optional platform-specific packages used by Tailwind CSS and Sharp.

While not harmful (they are MIT-licensed WASM runtime support), they clutter `npm ls` output and could cause confusion during audits. They also indicate that the lockfile was potentially generated on a platform (wasm32-wasi fallback) that differs from the deployment target (Linux x64 on Vercel).

**Impact:** Low risk. These are benign WASM fallback packages. However, their presence suggests the lockfile may have been generated or modified on a platform without native binary support, which could mean slightly different behavior between local dev and production.

**Fix:** Run `npm ci` on the deployment platform to verify clean installation. Consider `npm prune` locally if the extraneous packages persist. No action required for production -- Vercel's build will use its own `npm ci`.

---

### DEP-07: Wide Range on @types/node (^20) May Pull Incompatible Types

**Severity:** MEDIUM
**Checklist refs:** #130 (Dependency Pinning Strategy)
**Files:** `package.json:36`

**Evidence:**

```json
"@types/node": "^20"
```

Currently resolves to `@types/node@20.19.39`, while the latest available is `25.5.2`. The `^20` range constrains to `20.x.x`, which is correct behavior -- it will not jump to 21+. However, `@types/node` occasionally introduces type-level breaking changes within a major version that can cause TypeScript compilation failures when new type definitions are pulled.

More importantly, the project is likely running Node.js 20 or 22 locally, and `@types/node@20` may not include types for Node.js 22 built-in APIs. If using Node.js 22+ features (like the built-in test runner or new `fs` APIs), the types will be missing.

**Fix:** Match `@types/node` to the actual Node.js version used in development and deployment. If using Node.js 22, use `@types/node@^22`. This should align with the `engines` field recommended in DEP-04.

---

### DEP-08: Zod 3 vs Zod 4 -- Future Compatibility Consideration

**Severity:** MEDIUM
**Checklist refs:** #116 (Outdated Dependencies)
**Files:** `package.json:31` (`zod@^3.24`)

**Evidence:**

```
$ npm outdated
zod   3.25.76   3.25.76   4.3.6
```

Zod 4 was released as a major version with significant API changes. The project currently uses `zod@^3.24` (resolving to 3.25.76). The `@t3-oss/env-nextjs@0.13.11` peer dep now accepts `zod@^3.24.0 || ^4.0.0`, so upgrading is supported by the T3 ecosystem.

While not immediately urgent (Zod 3 is still maintained), this is worth tracking because:
1. Zod 4 introduces a new schema builder API
2. The project only has one file using Zod (`src/env.ts`) making migration trivial now
3. Waiting until more files use Zod 3 patterns increases migration cost

**Fix:** No immediate action required. Add to backlog for Phase 1. When ready, upgrade with:
```bash
npm install zod@^4.0.0
```
Then update `src/env.ts` schemas if any API changes affect the `z.string()`, `z.enum()`, `z.url()` patterns used.

---

### DEP-09: dotenv in devDependencies -- Verify Not Needed at Runtime

**Severity:** LOW
**Checklist refs:** #124 (Dev vs Production Dependencies)
**Files:** `package.json:38` (`dotenv@^17.4.0` in devDependencies), `tests/setup.ts`

**Evidence:**

`dotenv` is listed in `devDependencies` and is only imported in `tests/setup.ts`. This is correct placement -- the project uses T3 env validation (`@t3-oss/env-nextjs`) for runtime env access, and `dotenv` is only needed for test environment setup.

Verified by searching all source files:
- `tests/setup.ts` -- sole consumer of `dotenv`
- No `src/` files import `dotenv`
- `scripts/pull-env.sh` handles env file creation externally

**Status:** Correctly categorized. No action needed. Noted here for completeness.

---

### DEP-10: ESLint 9 vs ESLint 10 Gap

**Severity:** LOW
**Checklist refs:** #116 (Outdated Dependencies)
**Files:** `package.json:39`

**Evidence:**

```
$ npm outdated
eslint   9.39.4   9.39.4   10.2.0
```

ESLint 10 was released with the flat config system becoming the sole configuration method (legacy `.eslintrc` removed). The project uses `eslint-config-next@16.2.2` which currently requires ESLint 9. Until Next.js officially supports ESLint 10 in their config package, upgrading ESLint would break the config.

**Fix:** No action needed now. Track `eslint-config-next` for ESLint 10 support. The `eslint@^9` range is correctly constraining.

---

### DEP-11: TypeScript 5 vs TypeScript 6 Gap

**Severity:** LOW
**Checklist refs:** #116 (Outdated Dependencies)
**Files:** `package.json:44`

**Evidence:**

```
$ npm outdated
typescript   5.9.3   5.9.3   6.0.2
```

TypeScript 6.0 is a major version with potential breaking changes. The `typescript@^5` range correctly prevents auto-upgrade. All peer dependencies in the project (`@t3-oss/env-nextjs`, `@t3-oss/env-core`) specify `typescript>=5.0.0` which does not guarantee TypeScript 6 compatibility.

**Fix:** No action needed. Wait for ecosystem compatibility (ESLint, Next.js, T3 env) to confirm TypeScript 6 support before upgrading.

---

## Positive Findings (What's Working Well)

These are areas that DO NOT need attention:

| Area | Status | Detail |
|------|--------|--------|
| npm audit | CLEAN | Zero vulnerabilities across 537 packages |
| Registry security | CLEAN | All packages from `registry.npmjs.org`, no mixed registries |
| Lockfile integrity | GOOD | Committed to git, lockfileVersion 3, all SHA-512 hashes (537/537) |
| Typosquatting | CLEAN | All 21 direct dependencies verified against known package names |
| License compliance | CLEAN | All direct deps: MIT (17), BSD-2-Clause (1 -- dotenv), Apache-2.0 (1 -- TypeScript). No GPL/AGPL/copyleft. |
| Install scripts | CLEAN | No direct dependencies have preinstall/postinstall scripts. Transitive scripts (esbuild, fsevents, sharp, unrs-resolver) are from well-known packages. |
| Duplicate React | CLEAN | Single React 19.2.4 installation, properly deduped |
| Secret exposure | CLEAN | No `.npmrc` file, no auth tokens in committed files |
| Lockfile-package.json sync | GOOD | Lockfile matches package.json, no sync drift detected |
| Core framework pinning | GOOD | Next.js, React, React DOM, eslint-config-next all exact-pinned |

---

## npm outdated -- Full Report

| Package | Current | Wanted | Latest | Gap Type |
|---------|---------|--------|--------|----------|
| @supabase/ssr | 0.6.1 | 0.6.1 | 0.10.0 | **Major gap** (pre-1.0 minor = breaking) |
| @t3-oss/env-nextjs | 0.12.0 | 0.12.0 | 0.13.11 | **Minor gap** (causes DEP-01 duplicate) |
| @types/node | 20.19.39 | 20.19.39 | 25.5.2 | Major gap (constrained by ^20, expected) |
| dotenv | 17.4.0 | 17.4.1 | 17.4.1 | Patch (auto-fixable) |
| eslint | 9.39.4 | 9.39.4 | 10.2.0 | Major gap (wait for ecosystem) |
| prettier-plugin-tailwindcss | 0.6.14 | 0.6.14 | 0.7.2 | Minor gap (pre-1.0) |
| typescript | 5.9.3 | 5.9.3 | 6.0.2 | Major gap (wait for ecosystem) |
| vitest | 3.2.4 | 3.2.4 | 4.1.2 | Major gap (dev-only) |
| zod | 3.25.76 | 3.25.76 | 4.3.6 | Major gap (API changes) |

---

## Dependency Tree Summary

| Category | Count |
|----------|-------|
| Direct production deps | 9 |
| Direct dev deps | 12 |
| Total resolved packages | 537 |
| Extraneous packages | 5 (WASM/NAPI runtimes) |
| node_modules size | 498 MB |
| Lockfile lines | 8,392 |

---

## Prioritized Remediation

### Immediate (fix now -- same sprint)

1. **DEP-01:** Upgrade `@t3-oss/env-nextjs` from `^0.12` to `^0.13.11` to eliminate the duplicate `@t3-oss/env-core` and align versions. Single `npm install @t3-oss/env-nextjs@^0.13.11` command.

2. **DEP-02:** Upgrade `@supabase/ssr` from `^0.6` to `^0.10.0`. Review middleware and client factory code against 0.10 API. The project is early enough that API migration cost is minimal.

3. **DEP-03:** Add `.github/dependabot.yml` with weekly npm checks. Takes 2 minutes, prevents all future version drift.

### Short-term (within 2 sprints)

4. **DEP-04:** Add `engines` and `type` fields to `package.json`.
5. **DEP-05:** Document version pinning strategy in INTENT.md.

### Backlog

6. **DEP-07:** Align `@types/node` with actual Node.js version.
7. **DEP-08:** Evaluate Zod 4 migration when Phase 1 begins.
8. **DEP-06:** Monitor extraneous WASM packages (no action needed).

---

## Checklist Coverage

| Checklist Section | Items Checked | Findings |
|-------------------|---------------|----------|
| AF. Outdated Dependencies (#116) | Checked all 21 direct deps | DEP-02, DEP-08, DEP-10, DEP-11 |
| AG. Known Vulnerabilities (#117) | npm audit -- zero CVEs | None (clean) |
| AH. Abandoned Packages (#118) | All deps actively maintained | None |
| AI. Bundle Impact (#119) | Checked for barrel imports, large imports | None (lean deps) |
| AJ. Duplicate Dependencies (#120) | npm ls for React, env-core | DEP-01 |
| AK. License Compliance (#121) | Checked all 21 direct dep licenses | None (all permissive) |
| AL. Lock File Integrity (#122) | Committed, v3, SHA-512, single registry | None (healthy) |
| AM. Peer Dependency Conflicts (#123) | npm ls --all, UNMET deps | None (all optional) |
| AN. Dev vs Production (#124) | Verified dotenv placement | DEP-09 (correct) |
| AO. Monorepo Management (#125) | N/A (single package) | N/A |
| AP. Package.json Quality (#126) | engines, type, scripts, packageManager | DEP-04 |
| AQ. Import Analysis (#127) | Grep for unused deps | DEP-06 (extraneous) |
| AR. Native/Binary Dependencies (#128) | Install scripts, WASM packages | DEP-06 |
| AS. Registry Security (#129) | .npmrc, registry URLs, auth tokens | None (clean) |
| AT. Dependency Pinning Strategy (#130) | Version range analysis | DEP-03, DEP-05 |
| A03. Supply Chain (#3) | Typosquatting, postinstall, lockfile | None (clean) |
| G. Dependency Vulnerabilities (#27-29) | npm audit, CVE check, supply chain | None (clean) |
