---
description: Architecture and composition patterns (stack-agnostic)
globs: ["src/**/*", "app/**/*", "lib/**/*"]
---

# Architecture Patterns

## Component Model

<!-- CUSTOMIZE: Replace with your framework's patterns -->

### Server vs Client Boundary
```
Server Component (default)
  -> Fetches data from database/API
  -> Passes data as props to client component
  -> Handles revalidation/cache invalidation

Client Component (opt-in for interactivity)
  -> Receives data via props (no direct DB access)
  -> Manages UI state (local state, reducers)
  -> Calls server mutations for data changes
  -> Uses client-only APIs (realtime, browser APIs) sparingly
```

Push interactive boundaries down to the smallest leaf component. Never wrap an entire page in client-side rendering when only a button needs interactivity.

### Component Size Limits
- Target: <300 lines per component file
- When exceeded, extract sub-components or custom hooks
- Use compound component pattern for complex UIs with many props (>15)

## Data Mutations

<!-- CUSTOMIZE: Replace with your framework's patterns -->

### Mutation Pattern
Use server-side mutations (server actions, API handlers, or equivalent) for all data writes. Return structured results -- never throw from mutation handlers:

```
{ success: true, data: result }
{ success: false, error: "User-friendly message" }
```

Co-locate mutation handlers with their routes/pages when route-specific. Share in a library directory when used across features.

### Validation
- Define schemas alongside types
- Validate at the boundary (forms, API inputs)
- Internal function calls can trust validated data

## Error Handling

- **Mutation handlers:** Return structured error results, never throw
- **Data fetching:** Use error boundaries or equivalent at route level
- **Components:** Show user-friendly error states, never raw error messages
- **Logging:** Log errors server-side with context, return safe messages to clients

## Data Flow

- Fetch data in server/parent components, pass down as props
- Avoid client-side fetching unless data is user-specific and changes frequently
- Co-locate data fetching with the component that consumes it
- One-way data flow: parent -> child via props, child -> parent via callbacks

## File Organization

```
Feature directories (co-located by domain):
  feature-name/
    page or route handler
    mutation handlers (co-located)
    feature-specific components
    feature-specific types

Shared directories:
  lib/ or utils/     -- shared utilities, helpers
  types/             -- shared type definitions
  components/shared/ -- reusable UI components
```

- One component per file (exception: small helpers used only by the parent)
- Co-locate types with their component unless shared across features
- Keep utility files focused: one concern per file

## Import Organization

<!-- CUSTOMIZE: Replace with your framework's import groups -->

Group imports in this order, separated by blank lines:

```
1. Framework imports (React, Next, Vue, Svelte, etc.)
2. External packages
3. Internal modules (path alias imports)
4. Relative imports
5. Type-only imports (last)
```

- Use path aliases (e.g., `@/`) for all non-relative imports
- No barrel imports from large packages (import specific paths)
- No wildcard imports (`import * from ...`)
