// Collections (LIBRARY_WORKBOOK_UX_PLAN PR L, L0.48/L0.49): a Collection is a
// SAVED SEARCH -- the same name/tag/format query grammar the Library filter
// box and Smart Folders already share (lib/smartfolders.ts's parseQuery/
// matchesQuery), applied over the canonical hierarchy the same way the
// project-wide search surface does (lib/librarySearch.ts's
// libraryNodeMatches) -- so "a configured filter can be saved as a virtual
// Collection" (L0.56) is exactly this: save the query text, nothing else.
// Deliberately not a second grammar: a future change to the shared query
// language reaches every existing Collection for free.
//
// L0.48's ownership distinction: a Collection carries NO membership list --
// membership is DERIVED at render time (collectionMembers below), never
// stored, so a workbook/worksheet can appear in any number of Collections
// while its one real folder location never moves, and a Collection can never
// drift stale. L0.49: project-local only -- `collections` lives inside ONE
// project's .dwk (lib/workspace.ts), never a cross-project index.

import type { LibraryHierarchy, LibraryNode } from "./libraryHierarchy";
import { libraryNodeMatches } from "./librarySearch";
import { parseQuery } from "./smartfolders";

export interface Collection {
  id: string;
  name: string;
  /** The saved query text (lib/smartfolders.ts's grammar), parsed at match
   *  time -- never stored pre-parsed, so a shared-grammar change applies to
   *  every existing Collection automatically. */
  query: string;
}

function flatten(nodes: readonly LibraryNode[], out: LibraryNode[]): void {
  for (const node of nodes) {
    out.push(node);
    flatten(node.children, out);
  }
}

/** A Collection's LIVE members, in hierarchy order (derived -- never stored;
 *  L0.48/L0.49's "membership is live, not a frozen id list"). Folders never
 *  match -- they are organization, not addressable content -- matching the
 *  project-wide search surface's own scope (lib/librarySearch.ts). */
export function collectionMembers(hierarchy: LibraryHierarchy, collection: Collection): LibraryNode[] {
  const terms = parseQuery(collection.query);
  const nodes: LibraryNode[] = [];
  flatten(hierarchy.roots, nodes);
  return nodes.filter((node) => node.kind !== "folder" && libraryNodeMatches(node, terms));
}

/** Validate persisted Collections at the untrusted .dwk boundary -- drops
 *  malformed entries rather than throwing (mirrors sanitizeSmartFolders). */
export function sanitizeCollections(v: unknown): Collection[] {
  if (!Array.isArray(v)) return [];
  const out: Collection[] = [];
  for (const c of v) {
    if (typeof c !== "object" || c === null) continue;
    const o = c as Record<string, unknown>;
    if (
      typeof o.id === "string" &&
      typeof o.name === "string" &&
      o.name.trim() !== "" &&
      typeof o.query === "string"
    ) {
      out.push({ id: o.id, name: o.name, query: o.query });
    }
  }
  return out;
}
