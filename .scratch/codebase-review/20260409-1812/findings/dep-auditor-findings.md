# Dependency Audit Findings

**Auditor:** A11 - Dependency Auditor
**Date:** 2026-04-09
**Scope:** npm audit, outdated packages, version pinning, unused deps, peer dependency compatibility

---

## Summary

- **Total dependencies:** 7 production, 11 dev
- **Total resolved packages (lockfile):** 585
- **Lockfile version:** 3 (npm v9+)
- **Node.js runtime:** v24.12.0 (engine constraint: >=20.0.0)
- **Security vulnerabilities:** 1 high (vite, dev-only)
- **Missing declared dependency:** 1 (`@t3-oss/env-core`)

---

## Finding DEP-01: Phantom Dependency on @t3-oss/env-core (HIGH)

**Severity:** HIGH
**Category:** Reliability / Build Fragility

**Evidence:**
- `src/env.ts:2` imports `@t3-oss/env-core/presets-zod` directly
- `@t3-oss/env-core` is NOT listed in `package.json` (neither dependencies nor devDependencies)
- It resolves only because `@t3-oss/env-nextjs@0.13.11` declares it as a dependency, and npm hoists it to `node_modules/@t3-oss/env-core`

**Risk:** This is a phantom/transitive dependency. If `@t3-oss/env-nextjs` ever stops depending on `@t3-oss/env-core`, or changes the version, or npm's hoisting behavior changes (e.g., switching to pnpm or yarn PnP), the build will break with a module-not-found error at startup. This is a production-path import -- it runs during app initialization.

**Fix:** Add `@t3-oss/env-core` to `dependencies` in `package.json`:
```json
"@t3-oss/env-core": "0.13.11"
```

---

## Finding DEP-02: Vite 7.3.1 Has 3 Known HIGH Severity Vulnerabilities (HIGH)

**Severity:** HIGH (mitigated by being dev-only)
**Category:** Security

**Evidence:**
- `npm audit` reports 3 high-severity CVEs in `vite@7.3.1`:
  - GHSA-4w7w-66w2-5vf9: Path Traversal in Optimized Deps `.map` Handling
  - GHSA-v2wj-q39q-566r: `server.fs.deny` bypass with queries
  - GHSA-p9ff-h696-f583: Arbitrary File Read via Dev Server WebSocket
- Vite is pulled in transitively by `vitest@3.2.4` (vitest -> vite@7.3.1)
- Fix available: `npm audit fix` upgrades vite 7.3.1 -> 7.3.2

**Mitigation:** Vite is a dev dependency only -- it does not ship to production. However, these vulnerabilities affect the local dev server and could allow file exfiltration on a developer's machine if the dev server is exposed to a network.

**Fix:** Run `npm audit fix` to upgrade vite to 7.3.2.

---

## Finding DEP-03: @types/node Pinned to ^20 but Runtime is Node 24 (MEDIUM)

**Severity:** MEDIUM
**Category:** Type Safety / Correctness

**Evidence:**
- `package.json:42` declares `@types/node: "^20"`
- Resolved version: `@types/node@20.19.39`
- Actual Node.js runtime: `v24.12.0`
- Latest `@types/node`: `25.5.2`

**Risk:** The type definitions describe Node 20 APIs, but the runtime is Node 24. Any Node 24-specific APIs used in code will lack type coverage and could cause silent type errors. Conversely, deprecated Node 20 APIs will appear valid to the type checker even if removed in Node 24. The `engines` field in `package.json` says `>=20.0.0` which is correct, but the types should match the minimum targeted version at least.

**Fix:** Either:
1. Update to `@types/node: "^24"` to match the actual runtime, or
2. If targeting Node 20 as minimum, keep `^20` but be aware of the gap

---

## Finding DEP-04: Inconsistent Version Pinning Strategy (MEDIUM)

**Severity:** MEDIUM
**Category:** Maintainability / Reproducibility

**Evidence:**
- `package.json` uses 3 different pinning strategies:
  - **Exact pins (4 packages):** `next: "16.2.2"`, `react: "19.2.4"`, `react-dom: "19.2.4"`, `eslint-config-next: "16.2.2"`
  - **Tilde range (1 package):** `@supabase/ssr: "~0.10.0"` (patch-only updates)
  - **Caret range (14 packages):** `@supabase/supabase-js: "^2.49"`, `zod: "^3.24"`, etc.

**Analysis:** The pinning strategy is mostly reasonable -- framework core (Next.js, React) is exact-pinned, which is correct. However:
- `@supabase/ssr` uses tilde (`~0.10.0`) while `@supabase/supabase-js` uses caret (`^2.49`). The different strategies for the same ecosystem could lead to version drift where `ssr` stays at 0.10.x while `supabase-js` jumps to 2.103.x.
- Several caret ranges are very broad: `@types/node: "^20"`, `eslint: "^9"`, `typescript: "^5"` could accept major-adjacent breaking changes in minor/patch releases.

**Recommendation:** Document the version pinning strategy. Consider using exact versions for all production dependencies and caret for devDependencies only.

---

## Finding DEP-05: Multiple Packages Have Available Minor/Patch Updates (LOW)

**Severity:** LOW
**Category:** Maintenance Hygiene

**Evidence (from `npm outdated`):**

| Package | Current | Wanted | Latest | Notes |
|---------|---------|--------|--------|-------|
| `@supabase/ssr` | 0.10.0 | 0.10.2 | 0.10.2 | Patch updates available (tilde allows) |
| `@supabase/supabase-js` | 2.101.1 | 2.103.0 | 2.103.0 | Minor update |
| `next` | 16.2.2 | 16.2.2 | 16.2.3 | Patch (exact pin blocks it) |
| `react` | 19.2.4 | 19.2.4 | 19.2.5 | Patch (exact pin blocks it) |
| `react-dom` | 19.2.4 | 19.2.4 | 19.2.5 | Patch (exact pin blocks it) |
| `dotenv` | 17.4.0 | 17.4.1 | 17.4.1 | Patch |
| `vitest` | 3.2.4 | 3.2.4 | 4.1.4 | Major version available (v4) |
| `zod` | 3.25.76 | 3.25.76 | 4.3.6 | Major version available (v4) |
| `typescript` | 5.9.3 | 5.9.3 | 6.0.2 | Major version available (v6) |

**Notes:** The exact pins on `next`, `react`, and `react-dom` correctly prevent automatic updates to untested versions. The `@supabase/ssr` tilde pin is blocking the 0.10.2 patch -- running `npm update` would resolve it. Major version jumps (vitest 4, zod 4, typescript 6) should be evaluated deliberately, not auto-upgraded.

---

## Finding DEP-06: Depcheck False Positives Are Expected -- No Actually Unused Dependencies (LOW)

**Severity:** LOW (informational)
**Category:** Maintenance

**Evidence:** `depcheck` flagged 5 devDependencies as "unused":
- `@tailwindcss/postcss` -- used in `postcss.config.mjs:3`
- `@types/react-dom` -- consumed by TypeScript compiler (not imported directly)
- `@vitest/coverage-v8` -- used via `vitest.config.ts:58` (`provider: "v8"`)
- `prettier-plugin-tailwindcss` -- used in `.prettierrc:7` (`plugins` array)
- `tailwindcss` -- used via `globals.css:1` (`@import "tailwindcss"`)

**Conclusion:** All flagged packages are legitimately in use. No actually unused dependencies found. The dependency set is lean and purposeful for a Next.js + Supabase + Tailwind project.

---

## Peer Dependency Compatibility Matrix

| Package | Peer Requirement | Installed | Status |
|---------|-----------------|-----------|--------|
| `@supabase/ssr@0.10.0` | `@supabase/supabase-js ^2.100.1` | `2.101.1` | OK |
| `@t3-oss/env-nextjs@0.13.11` | `zod ^3.24.0 \|\| ^4.0.0` | `3.25.76` | OK |
| `@t3-oss/env-nextjs@0.13.11` | `typescript >=5.0.0` | `5.9.3` | OK |
| `@t3-oss/env-core@0.13.11` | `zod ^3.24.0 \|\| ^4.0.0` | `3.25.76` | OK |
| `next@16.2.2` | `react ^18.2.0 \|\| ^19.0.0` | `19.2.4` | OK |
| `next@16.2.2` | `react-dom ^18.2.0 \|\| ^19.0.0` | `19.2.4` | OK |
| `vitest@3.2.4` | `vite ^5 \|\| ^6 \|\| ^7` | `7.3.1` | OK |
| `vitest@3.2.4` | `@types/node ^18 \|\| ^20 \|\| >=22` | `20.19.39` | OK |

All peer dependency constraints are satisfied. No conflicts detected.

---

## Recommended Actions (Priority Order)

1. **[HIGH] Add `@t3-oss/env-core` to dependencies** -- eliminates phantom dependency risk (DEP-01)
2. **[HIGH] Run `npm audit fix`** -- patches vite 7.3.1 -> 7.3.2 (DEP-02)
3. **[MEDIUM] Update `@types/node` to `^24`** -- match actual runtime (DEP-03)
4. **[LOW] Run `npm update`** -- pick up patch updates for @supabase/ssr, dotenv (DEP-05)
5. **[LOW] Document version pinning strategy** -- add rationale to INTENT.md (DEP-04)
