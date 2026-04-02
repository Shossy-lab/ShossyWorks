# Contract Index -- ShossyWorks

| Feature | Contract File | Governs | Key Rule | Last Verified |
|---------|--------------|---------|----------|---------------|
| Tree-Calculation | `contracts/tree-calculation.contract.md` | Interface between tree data model and calc engine | All intermediates at DECIMAL(15,4); overhead compounds on contingency; server is authoritative | 2026-04-02 |
| Catalog-Estimate | `contracts/catalog-estimate.contract.md` | Interface between catalog system and estimate instantiation | Deep copy on instantiate; no live references; deleting catalog never breaks estimates | 2026-04-02 |
| Options-Tree | `contracts/options-tree.contract.md` | Interface between inline options and the estimate tree | Exactly one selected per group (atomic switch); junction table for memberships; unoptioned nodes always visible | 2026-04-02 |
| Client-Visibility | `contracts/client-visibility.contract.md` | Interface between builder view and client view | Clients never see unit_cost/markup/rates; RLS enforces visibility; access via client_project_access | 2026-04-02 |
| Realtime-State | `contracts/realtime-state.contract.md` | Interface between Supabase Realtime and client state manager | useReducer with two mutation sources; presence-guided last-writer-wins; same reducer for local and remote | 2026-04-02 |
