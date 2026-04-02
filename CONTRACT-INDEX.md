# Contract Index

> This file is loaded every session (L1 context). It provides a quick-lookup table for all active contracts.
> Update via `/finish-session` or manually when contracts change.

## Active Contracts

| Contract | Feature | Governs | Key Rule | Last Verified |
|----------|---------|---------|----------|---------------|
| *No contracts yet* | -- | -- | -- | -- |

## How to Use

- **At session start:** Scan this table to know what contracts exist and what they govern.
- **Before cross-feature work:** Read the full contract file for any feature you will touch.
- **After code changes:** Check if any contract governing the changed code needs updating.
- **At session end:** The contract-auditor agent (Agent 3 in `/finish-session`) verifies compliance and updates Last Verified dates.

## Adding a New Contract

1. Create the contract file in `contracts/` using `contracts/TEMPLATE.contract.md`
2. Add a row to the table above
3. Commit the contract and this index together
