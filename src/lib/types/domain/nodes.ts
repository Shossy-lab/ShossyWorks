// src/lib/types/domain/nodes.ts
// ────────────────────────────────────────────────────────────
// Domain types for the estimate node tree.
//
// TODO: Populate after supabase gen types in Phase 1A-10
// Full types defined in type-system-research.md:
//   - NodeBase (shared fields from estimate_nodes table)
//   - ItemDetails (from node_item_details table)
//   - AssemblyDetails (from node_assembly_details table)
//   - GroupNode, AssemblyNode, ItemNode (discriminated by nodeType)
//   - NodeWithDetails (discriminated union of all three)
//   - TreeNode (NodeWithDetails with children array)
//   - Type guards: isGroupNode, isAssemblyNode, isItemNode
//   - isClientVisible utility
// ────────────────────────────────────────────────────────────

/** Placeholder -- will become GroupNode | AssemblyNode | ItemNode */
export type NodeWithDetails = unknown;

/** Placeholder -- will become NodeWithDetails with children */
export type TreeNode = unknown;
