// The single "select a Library node" contract (L0.25), split out of
// components/Library/libraryOpen.ts (bundle diet slice 22,
// plans/BUNDLE_HEADROOM.md). The eager Library panel calls this one, while
// every caller of the open dispatcher in libraryOpen.ts is already lazy, so
// that module now loads with them. A store helper, not a component, so it
// lives here.

import type { LibraryNode } from "./libraryHierarchy";
import { useApp } from "../store/useApp";

/** The single "select a Library node" contract (L0.25, shared by Details rows,
 *  the search-results surface, and the reveal effect): a worksheet's selection
 *  IS the app-wide dataset selection (`selectedIds`); every other kind selects
 *  through `librarySelection`. The two stay mutually exclusive at their store
 *  chokepoints — see store/libraryPanel.ts. */
export function selectLibraryNode(node: LibraryNode): void {
  const s = useApp.getState();
  if (node.kind === "worksheet") s.selectIds([node.entityId]);
  else s.setLibrarySelection({ kind: node.kind, id: node.entityId });
}
