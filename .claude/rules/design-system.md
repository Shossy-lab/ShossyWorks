# Design System Enforcement (NON-NEGOTIABLE)

This rule has the same priority as contract enforcement. No task, deadline, or convenience overrides it.

## The Rule

**Every visual property must come from a design token.** Zero hardcoded colors, spacing, border-radius, shadows, or font sizes in component files. Everything flows through CSS custom properties defined in `globals.css` and documented in `DESIGN-SYSTEM.md`.

## Before Writing Any UI Code

1. Read `DESIGN-SYSTEM.md` (imported via CLAUDE.md, always in context)
2. Identify which tokens apply to the component you're building
3. If a token doesn't exist, add it to `globals.css` and `DESIGN-SYSTEM.md` first
4. Then write the component using only token references

## Shape Rules

| Shape | Radius | Examples |
|-------|--------|----------|
| Rectangle / Square | `0` (sharp corners) | Cards, panels, inputs, modals, dropdowns, containers |
| Pill | `9999px` (fully rounded) | Primary buttons, tags, badges |
| Circle | `9999px` + equal dimensions | Avatars, icon buttons |

**Forbidden:** `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl` on any container element. These are the hallmark of generic AI-generated UI and are explicitly rejected.

## Color Rules

| Instead of | Use |
|-----------|-----|
| `bg-white`, `bg-gray-50`, `bg-gray-100` | `bg-[var(--color-*)]` tokens |
| `text-gray-900`, `text-gray-600` | `text-[var(--color-text-*)]` tokens |
| `bg-blue-600`, `bg-red-50` | `bg-[var(--color-interactive)]`, `bg-[var(--color-error-bg)]` |
| `border-gray-300` | `border-[var(--color-border)]` |
| Any hex value in a component | Add as token first, then reference |

## PostToolUse Reminder

After every Edit/Write on a `.tsx`, `.ts`, or `.css` file in `src/`:

> "UI file modified. Verify: Are all visual properties using design tokens from DESIGN-SYSTEM.md? Any hardcoded colors, rounded corners, or magic numbers?"

## Data-First, UI-Right

- Architecture and data correctness take priority over UI polish
- But when UI IS needed (auth, navigation, core workflows), build it correctly from the start
- "Placeholder" and "temporary" UI still follows the design system — there is no exemption
