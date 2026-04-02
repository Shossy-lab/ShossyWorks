---
description: NON-NEGOTIABLE contract and documentation sync enforcement
globs:
  - "contracts/**/*.md"
  - "docs/**/*.md"
  - "CONTRACT-INDEX.md"
  - "CODEBASE_MAP.md"
---

# Contract Enforcement (NON-NEGOTIABLE)

This rule has the highest priority. No task, deadline, or convenience overrides it.

## What Contracts Are

A contract is a lightweight (<1KB) interface agreement between two features or systems. It documents what one part of the codebase promises to another: data shapes, required fields, calculated fields, behavioral invariants, and cross-feature rules.

Contracts live in `contracts/` and follow the template in `contracts/TEMPLATE.contract.md`.

Contracts are NOT documentation. They are enforceable interface agreements. Think of them as the "API spec" between features -- if the code violates the contract, the code is wrong.

## The Sync Rule (NON-NEGOTIABLE)

**Contracts, docs, and code MUST ALWAYS agree. There is no "I'll update it later."**

- Code changes and a contract doesn't match -> the contract is wrong -> update it NOW.
- Contract changes and code doesn't match -> the code is wrong -> update it NOW.
- Code changes and a doc references the old behavior -> the doc is wrong -> update it NOW.

**Never create a commit where contracts, docs, and code disagree.**

This is not a suggestion. This is not a best practice. This is a hard rule. If you find yourself thinking "I'll update the contract after I finish this feature" -- stop. Update the contract first. The 30 seconds it takes now prevents hours of debugging stale contracts later.

## When to Update Contracts

Update the relevant contract(s) when you:
- Modify code that crosses a feature boundary (shared types, API shapes, component props)
- Change how two features communicate (function signatures, event payloads, data formats)
- Add, remove, or rename shared interfaces or types
- Change validation rules that other features depend on
- Modify calculated field formulas or their dependencies
- Change invariants (rules that must never be violated)

## When to Update Docs

Update the relevant doc(s) when you:
- Modify code that a doc references (file paths, function signatures, data shapes)
- Add, remove, or rename files that appear in `CODEBASE_MAP.md`
- Make a design decision that should be recorded in `INTENT.md`
- Change a workflow or process that a doc describes
- Modify project context referenced in `CLAUDE.md`

## The Edit Sequence (Same Commit, Every Time)

Every change follows this exact sequence:

1. **Change the code** -- implement the feature, fix, or refactor
2. **Update contracts** -- any contract governing the changed boundary
3. **Update docs** -- any doc referencing the changed code
4. **Update CONTRACT-INDEX.md** -- if contract metadata changed
5. **Update CODEBASE_MAP.md** -- if file structure changed
6. **Commit ALL together** -- code + contracts + docs in one atomic commit

Never split these across separate commits. If you realize mid-implementation that a contract needs updating, update it before moving on. The sequence is: code -> contracts -> docs -> commit.

## Contract Rules

- **Never remove rules from contracts** -- only add or refine them
- **Contracts must stay under 1KB** -- they are interface summaries, not full specs
- **One contract per feature boundary** -- not per file, not per function
- **Every contract has a "Last verified" date** -- update it when you confirm code matches
- **CONTRACT-INDEX.md must always reflect current state** -- it is the quick-lookup table

## PostToolUse Hook Reinforcement

The `post-edit-check.sh` hook fires after every Edit/Write operation. It reminds:

> "File modified. Consider: Does CODEBASE_MAP.md, CONTRACT-INDEX.md, or any contract need updating?"

This is a lightweight reminder, not a blocker. But treat it seriously -- if the answer is "yes" and you skip it, you are violating this rule.

## Staleness Signals

Act on these immediately when encountered:

| Signal | Meaning | Action |
|--------|---------|--------|
| `Last verified` date >30 days old | Contract may be stale | Verify against current code on next touch |
| >3 sessions without CONTRACT-INDEX update | Index may be outdated | Audit during finish-session |
| Contract references a file path that doesn't exist | Contract is stale | Update or archive the contract |
| Doc describes behavior that doesn't match code | Doc is wrong | Fix the doc immediately |
| CONTRACT-INDEX lists a contract that doesn't exist | Index is stale | Remove the entry |

## CONTRACT-INDEX.md

The root-level `CONTRACT-INDEX.md` is loaded every session (L1 context). It must contain:

| Feature | Contract File | Governs | Key Rule | Last Verified |
|---------|--------------|---------|----------|---------------|

This table is the quick-reference for "which contracts exist and what do they protect." Keep it current. The finish-session protocol updates it, but any mid-session contract change should also update the index.
