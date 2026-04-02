# Reference Documents — WARNING

**These documents are from PREVIOUS ATTEMPTS at building this application. They are included for context only.**

## How to Use These References

- Read them to understand the SCOPE of the problem (what the system needs to handle)
- Read them to understand what PROBLEMS were encountered (those problems are real)
- Read them to understand what TRADE-OFFS were considered (the analysis is useful even if the conclusions were wrong)
- Do NOT adopt their schemas, table structures, or architectural patterns
- Do NOT assume their solutions were correct just because they were implemented
- Treat them the way you would treat a teardown of a competitor's product — useful for understanding, NOT a template

## What's Here

| File | What It Is | What It Shows |
|------|-----------|---------------|
| `attempt-1-ep-table-structure-spec.md` | Full schema analysis of the first attempt (14 tables, 46-column monolithic node table) | The full scope of what the system needs to model; what happens when you build all layers simultaneously; the monolithic table trade-off |
| `attempt-2-soloway-overview.md` | Summary of the second attempt (fixed hierarchy, Excel-dependent, read-only-first) | What happens with the opposite set of trade-offs; the value of a working client-facing view; the limitations of a rigid hierarchy |
