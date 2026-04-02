---
description: Code style, naming conventions, and formatting standards (stack-agnostic)
globs: ["src/**/*", "app/**/*", "lib/**/*"]
---

# Code Style Rules

## Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Files (components) | kebab-case | `user-profile.tsx`, `data-table.vue` |
| Files (utilities) | kebab-case | `format-currency.ts`, `parse-date.py` |
| Components/Classes | PascalCase | `UserProfile`, `DataTable` |
| Types/Interfaces | PascalCase | `EstimateItem`, `UserSession` |
| Functions/Methods | camelCase (JS/TS) or snake_case (Python) | `buildTree`, `compute_totals` |
| Variables | camelCase (JS/TS) or snake_case (Python) | `itemCount`, `total_cost` |
| Constants | UPPER_SNAKE_CASE | `MAX_PAGE_SIZE`, `API_BASE_URL` |
| Enums | PascalCase type, UPPER_SNAKE or PascalCase members | `Status.ACTIVE` or `Status.Active` |
| Private members | Leading underscore (where applicable) | `_internal`, `_cache` |

<!-- CUSTOMIZE: Replace with your language's conventions -->

## Type Safety

- Use strict mode / strict type checking in your language
- Avoid `any` (TypeScript), bare `dict` (Python), or equivalent escape hatches
- Annotate all exported/public function signatures with explicit types
- Prefer narrow types over broad ones -- model your domain accurately
- Use discriminated unions or tagged types for state modeling

## Exports and Imports

- **Named exports only** -- no default exports (except where framework requires them)
- Use path aliases (e.g., `@/` for `src/`) for all non-relative imports
- No barrel imports from large packages -- import specific paths
- No wildcard imports (`from module import *` or `import * from ...`)

### Import Grouping

<!-- CUSTOMIZE: Replace with your language's conventions -->

Separate import groups with blank lines:

```
1. Language/framework builtins
2. External packages (third-party)
3. Internal modules (path alias or package imports)
4. Relative imports (same feature/directory)
5. Type-only imports (last)
```

## Component / Module Structure

- One component (or primary class) per file
- File name matches the primary export in appropriate casing
- Co-locate component-specific types in the same file
- Shared types go in a dedicated types directory or file
- Target: <300 lines per file -- extract sub-components or helpers when exceeded

## Function Design

- Functions should do one thing well
- Prefer pure functions for logic (no side effects, predictable output)
- Extract custom hooks or utility functions when a component has >3 state/effect calls
- Keep function signatures small (<5 parameters) -- use an options object for more

## Error Handling

<!-- CUSTOMIZE: Replace with your language's conventions -->

- Catch specific error types, never bare `catch` / `except`
- In boundary functions (API handlers, mutations): return structured errors, never throw
- Use custom error classes for domain-specific errors
- Log errors server-side with context, return user-safe messages to clients

## Documentation in Code

- Module-level comments explaining purpose (one line is fine for simple modules)
- Function docstrings/JSDoc for public APIs
- Inline comments only for non-obvious logic ("why", not "what")
- TODO comments must include context: `// TODO(feature): description`

## Formatting

- Use your project's formatter (Prettier, Black, rustfmt, etc.) -- never hand-format
- Consistent indentation (follow project config)
- Trailing commas in multi-line structures (where language supports)
- Line length: follow project config (typically 80-120 characters)
