# Frontend & Accessibility Review Findings

**Reviewer:** A12 — Frontend & Accessibility
**Scope:** All `.tsx` files in `src/app/` (15 files) and `src/components/` (3 files)
**Date:** 2026-04-09

---

## CRITICAL

*No critical findings.*

---

## HIGH

### H1. Nested `<main>` landmarks — WCAG 1.3.1 / 4.1.1 violation

**Files:**
- `src/app/layout.tsx:23` — `<main id="main-content">{children}</main>`
- `src/app/(protected)/layout.tsx:40` — `<main className="flex-1 overflow-y-auto ...">...</main>`

**Problem:** The root layout wraps ALL children (including protected routes) in a `<main>` landmark. The protected layout then wraps page content in a second `<main>`. When a user visits `/dashboard`, the DOM contains:

```
<main id="main-content">       ← root layout
  <div class="flex h-screen">
    <aside>...</aside>
    <div>
      <header>...</header>
      <main class="flex-1 ...">  ← protected layout (NESTED)
        ...page content...
      </main>
    </div>
  </div>
</main>
```

Nested `<main>` landmarks violate WCAG 1.3.1 (Info and Relationships) and 4.1.1 (Parsing). Screen readers announce multiple main regions, confusing users about where primary content begins. The skip link targets `#main-content` which is the outer `<main>` containing navigation — not the actual page content.

**Fix:** Remove the `<main>` from root layout and let each layout group define its own `<main>` appropriately. The root layout should use a neutral `<div>`. Move `id="main-content"` to the protected layout's `<main>`.

---

### H2. Dashboard heading hierarchy skips h2 — WCAG 1.3.1 violation

**File:** `src/app/(protected)/dashboard/page.tsx:6,14,25`

```tsx
<h1>Dashboard</h1>           // line 6
...
<h3>Projects</h3>            // line 14 — skips h2
<h3>Settings</h3>            // line 25 — skips h2
```

**Problem:** Heading hierarchy jumps from `h1` directly to `h3`, skipping `h2`. Screen readers use heading levels to build a document outline. A skipped level signals a structural error and makes navigation unreliable for users who navigate by heading.

**Compound issue:** The protected layout header contains `<h2>ShossyWorks</h2>` at line 35, which renders ABOVE the page's `<h1>Dashboard</h1>`. This creates an inverted hierarchy: the app-level branding is h2 while the page title is h1, which is semantically backward when both are visible simultaneously. The header h2 should be a decorative `<span>` or at most an aria-hidden heading since it's a site identifier, not a content heading.

**Fix:** Change dashboard card headings from `h3` to `h2`. Change the header's `<h2>ShossyWorks</h2>` to a non-heading element (e.g., `<span>` or `<p>`).

---

### H3. Sidebar navigation links are empty when collapsed — WCAG 2.4.4 / 4.1.2 violation

**File:** `src/components/nav/sidebar.tsx:45-55`

```tsx
<Link
  href={item.href}
  className={`...`}
  title={collapsed ? item.label : undefined}
>
  {!collapsed && item.label}    // line 54 — empty when collapsed
</Link>
```

**Problem:** When the sidebar is collapsed, the Link has NO visible text AND no `aria-label`. The `title` attribute is NOT a sufficient accessible name per WCAG 4.1.2 (Name, Role, Value). Screen readers may announce these as "link" with no destination. The links are technically rendered but contain no text node and no accessible name.

**Fix:** Add `aria-label={item.label}` to every nav link (regardless of collapsed state), or always render the text with `sr-only` class when collapsed.

---

### H4. Multiple interactive elements missing focus-visible styles — WCAG 2.4.7 violation

**Files and lines:**
- `src/app/error.tsx:24-28` — "Try again" button, no focus style
- `src/app/(protected)/error.tsx:30` — "Try again" button, no focus style
- `src/app/(protected)/error.tsx:34-38` — "Go to Dashboard" link, no focus style
- `src/app/(auth)/error.tsx:29` — "Try again" button, no focus style
- `src/app/(auth)/error.tsx:34-38` — "Go to Sign In" link, no focus style
- `src/app/not-found.tsx:13-16` — "Go to Dashboard" link, no focus style
- `src/app/pending-approval/page.tsx:36-38` — "Sign Out" button, no focus style
- `src/components/nav/sidebar.tsx:31-37` — collapse toggle button, no focus style
- `src/components/nav/sidebar.tsx:45-55` — all nav links, no focus style
- `src/components/nav/user-menu.tsx:27-30` — "Sign Out" button, no focus style
- `src/app/(protected)/dashboard/page.tsx:10-12` — Projects card link, no focus style
- `src/app/(protected)/dashboard/page.tsx:21-23` — Settings card link, no focus style
- `src/app/(auth)/sign-in/page.tsx:127-130` — "Sign Up" link, no focus style
- `src/app/(auth)/sign-up/page.tsx:67-70` — "Sign In" link (confirmation view), no focus style
- `src/app/(auth)/sign-up/page.tsx:145-148` — "Sign In" link (form view), no focus style

**Problem:** 15 interactive elements across the codebase have NO `focus-visible:outline` or equivalent focus indicator. Only the sign-in/sign-up form inputs and submit buttons have focus styles. Keyboard users cannot see which element is currently focused on error pages, the sidebar, the header, the dashboard, or any link text. This fails WCAG 2.4.7 (Focus Visible).

**Fix:** Add consistent `focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus)] focus-visible:outline-offset-2` to ALL interactive elements.

---

### H5. Sidebar `<aside>` and `<nav>` lack accessible labels — WCAG 1.3.1

**File:** `src/components/nav/sidebar.tsx:18,39`

```tsx
<aside className={`...`}>         // line 18 — no aria-label
  ...
  <nav className="flex-1 ...">    // line 39 — no aria-label
```

**Problem:** When a page has multiple landmarks of the same type (which it does once header and nav are present), each landmark MUST have a distinguishing label. The `<aside>` has no `aria-label` and the `<nav>` has no `aria-label`. If a second `<nav>` or `<aside>` is ever added (e.g., in-page navigation, secondary sidebar), screen reader users will have no way to distinguish them.

**Fix:** Add `aria-label="Main navigation"` to the `<nav>` element and `aria-label="Sidebar"` to the `<aside>` element.

---

## MEDIUM

### M1. `global-error.tsx` uses all hardcoded inline styles — Design System violation

**File:** `src/app/global-error.tsx:12-49`

The entire file uses inline `style={}` with hardcoded hex values:
- Line 13: `background: "#f5f5f5"` (should be `--color-bg-secondary`)
- Line 14: `color: "#0a0a0a"` (should be `--color-text-primary`)
- Line 33: `color: "#525252"` (should be `--color-text-secondary`)
- Line 39: `background: "#0a0a0a"` (should be `--color-interactive`)
- Line 40: `color: "#fafafa"` (should be `--color-interactive-text`)
- Lines 30, 33: hardcoded `fontSize`, `fontWeight`, `marginBottom`, `padding`

**Acknowledgment:** `global-error.tsx` is a special Next.js boundary that replaces the entire `<html>` and `<body>` — CSS-in-JS and Tailwind classes may not be available. Inline styles are arguably the only reliable approach here. However, if global CSS loads (which it typically does on client-side errors), `var()` references inside inline styles would work: `style={{ background: "var(--color-bg-secondary)" }}`. This would at least reference tokens rather than raw hex values.

**Severity reasoning:** Medium because it's the one file where inline styles are partially justified, but the values should still reference CSS custom properties where possible.

---

### M2. Sign-in Suspense boundary has no fallback — UX issue

**File:** `src/app/(auth)/sign-in/page.tsx:16-18`

```tsx
<Suspense>
  <SignInForm />
</Suspense>
```

**Problem:** The `<Suspense>` wrapping `SignInForm` (needed because `useSearchParams()` requires it in Next.js app router) has no `fallback` prop. During the suspense period, users see a blank page with no indication that content is loading. This is not a WCAG failure but is a usability gap — users on slow connections may think the page is broken.

**Fix:** Add `fallback={<div className="flex min-h-screen items-center justify-center"><p>Loading...</p></div>}` or similar.

---

### M3. Sign-up page missing Suspense for `useSearchParams` consistency

**File:** `src/app/(auth)/sign-up/page.tsx`

**Problem:** The sign-up page does not use `useSearchParams()` and therefore doesn't wrap in Suspense, which is currently fine. However, the sign-in page follows the Suspense pattern, creating an inconsistency. If error parameters are ever added to the sign-up URL (as they are for sign-in), the page will fail without a Suspense boundary. This is a preemptive note, not a current bug.

---

### M4. `aria-current="page"` missing on active navigation links — WCAG 4.1.2

**File:** `src/components/nav/sidebar.tsx:45-55`

**Problem:** Active navigation items are indicated only by visual styling (left border + background fill). There is no `aria-current="page"` attribute on the active link. Screen reader users cannot determine which page they are currently on from the navigation alone. This is a WCAG 4.1.2 best practice.

**Fix:** Add `aria-current={isActive ? "page" : undefined}` to each nav Link.

---

### M5. Error alert pattern inconsistent across error boundaries

**Files:**
- `src/app/(auth)/sign-in/page.tsx:66-69` — URL error has NO `role="alert"` wrapper
- `src/app/(auth)/sign-in/page.tsx:71-76` — form error HAS `role="alert"` wrapper
- `src/app/error.tsx` — no live region, static error message only
- `src/app/(protected)/error.tsx` — no live region, static error message only
- `src/app/(auth)/error.tsx` — no live region, static error message only

**Problem on sign-in:** The URL-based error message (line 66-69) is rendered OUTSIDE the `role="alert"` container, so screen readers will not automatically announce it when the page loads with an error query param. Only the form submission error is inside the live region.

**Fix:** Move the URL error message inside the `role="alert"` container, or give the URL error its own `role="alert"` wrapper.

---

### M6. Protected layout header lacks role differentiation

**File:** `src/app/(protected)/layout.tsx:32-39`

The `<header>` element has no `role` or `aria-label`. While a single `<header>` is implicitly a banner, if there were ever a nested header (e.g., in a card or section), it would lose its implicit banner role. More importantly, the header contains the "ShossyWorks" text as an `<h2>`, which interferes with page heading hierarchy (see H2).

---

### M7. Loading state lacks accessibility indication

**File:** `src/app/(protected)/loading.tsx:1-7`

```tsx
<div className="flex min-h-[50vh] items-center justify-center">
  <p className="text-sm text-[var(--color-text-secondary)]">Loading...</p>
</div>
```

**Problem:** The loading indicator is a static `<p>` tag. There is no `aria-live`, `role="status"`, or `aria-busy` to announce to screen reader users that content is loading. Sighted users see the text; screen reader users get no announcement.

**Fix:** Add `role="status"` and `aria-live="polite"` to the container or the paragraph element.

---

### M8. Dashboard cards are entire-link blocks with no keyboard interaction feedback

**File:** `src/app/(protected)/dashboard/page.tsx:10-20, 21-31`

**Problem:** The dashboard cards are full `<Link>` wrappers containing `<h3>` and `<p>` children. There are no focus-visible styles (see H4) and no `aria-label` to distinguish them if the heading content is similar. The cards have hover styles but no focus-equivalent visual treatment.

---

## LOW

### L1. `global-error.tsx` button missing cursor pointer in CSS-only approach

**File:** `src/app/global-error.tsx:44` — `cursor: "pointer"` IS present (correctly), but the button has no `:hover` style change (background remains static because inline styles can't easily express pseudo-classes). Users get no visual feedback on hover.

### L2. Skip link targets `#main-content` but skip behavior may be incorrect in protected routes

**File:** `src/components/shared/skip-link.tsx:4` targets `#main-content` which is on root layout's `<main>`. In protected routes, the actual content is nested deeper. The skip link will focus the outer `<main>` which includes the sidebar and header — not the inner content area. This partially defeats the purpose.

### L3. No `<meta name="viewport">` in root layout

**File:** `src/app/layout.tsx` — Next.js auto-injects this via metadata, so this is likely fine. But worth verifying in production builds that the viewport meta tag is present for mobile responsiveness.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| CRITICAL | 0 | -- |
| HIGH | 5 | Nested main landmarks, heading hierarchy, empty nav links, missing focus styles (15 elements), unlabeled landmarks |
| MEDIUM | 8 | Hardcoded inline styles in global-error, missing aria-current, inconsistent alert patterns, loading state a11y |
| LOW | 3 | Minor UX polish |

**Top priorities for remediation:**
1. Fix nested `<main>` landmarks (H1) — quick structural fix
2. Add `focus-visible` styles to ALL 15 interactive elements (H4) — systematic pass
3. Fix sidebar collapsed link accessibility (H3) — add aria-label
4. Fix heading hierarchy (H2) — change h3 to h2, demote header branding
5. Label sidebar landmarks (H5) — two aria-label additions
