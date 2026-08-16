// E-c1 (round 2, Sol-review blocking finding): dependency resolution for
// thumbnails. A preview is TRANSITIVELY live — a page renders its
// referenced figures, and a live figure renders its source dataset — so
// the cache identity must change when ANY of those objects is replaced,
// not only the tile's own entity. This module assembles the canonical
// `ThumbnailRequest`: the ordered dependency objects AND the fingerprint
// composed from exactly those objects, handed to the generator as one
// unit so key and render can never disagree.
//
// Dependency table (per kind):
//   page                → each panel's referenced FigureDocument (ordered;
//                         a missing figure is a stable null sentinel),
//                         then the node's live source datasets
//   editable-figure /
//   publication-figure /
//   origin-figure /
//   report              → the node's live source datasets
//                         (`node.source.datasetIds` — the hierarchy's own
//                         canonical, live-only source computation)
//   worksheet/folder/
//   workbook            → none beyond the entity (their generators, when
//                         E-c2 adds any, render embedded data only)

import type { Dataset } from "./types";
import type { FigureDocument } from "./figureDocument";
import type { LibraryNode } from "./libraryHierarchy";
import { entityRevision, type ThumbnailRequest } from "./thumbnailCache";

/** The minimal store slice dependency resolution reads. Callers pass live
 *  store arrays (the hook subscribes to them, so a replaced dependency
 *  re-resolves); tests pass literals. */
export interface ThumbnailSnapshot {
  datasets: readonly Dataset[];
  editableFigures: readonly FigureDocument[];
}

/** THE panel→figure reference predicate, shared with the page generator so
 *  dep production (here) and dep consumption (thumbnailPage.ts) can never
 *  disagree on which panels carry a reference — an empty-string figureId
 *  counts as a (missing) reference, matching resolvePagePanel. */
export function panelReferencesFigure(panel: { figureId: string | null }): boolean {
  return panel.figureId != null;
}

/** By-id lookup maps memoized on the ARRAY object (WeakMap): the store
 *  replaces the array on change, so a snapshot's map is built once and
 *  shared by every tile resolving against it — not O(store) per tile. */
const byIdCache = new WeakMap<object, Map<string, object>>();
function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  let map = byIdCache.get(items) as Map<string, T> | undefined;
  if (!map) {
    map = new Map(items.map((item) => [item.id, item]));
    byIdCache.set(items, map as Map<string, object>);
  }
  return map;
}

export function resolveThumbnailRequest(node: LibraryNode, snapshot: ThumbnailSnapshot): ThumbnailRequest {
  // The resolver KNOWS each dependency's type by construction, so it hands
  // generators TYPED slices — `deps` stays the ordered fingerprint array,
  // but no consumer should shape-sniff it (the `"pending" in dep` bug
  // class, PR #150 review).
  const figureDeps: (FigureDocument | null)[] = [];
  const datasetDeps: (Dataset | null)[] = [];
  if (node.kind === "page") {
    const figureById = byId(snapshot.editableFigures);
    for (const panel of node.entity.panels) {
      if (!panelReferencesFigure(panel)) continue;
      figureDeps.push((panel.figureId && figureById.get(panel.figureId)) || null); // null = missing reference sentinel
    }
  }
  if (node.kind !== "folder" && node.kind !== "workbook" && node.kind !== "worksheet") {
    const datasetById = byId(snapshot.datasets);
    for (const id of node.source.datasetIds) datasetDeps.push(datasetById.get(id) ?? null);
  }
  const deps: (object | null)[] = [...figureDeps, ...datasetDeps];
  const fingerprint = [
    entityRevision(node.entity as object),
    ...deps.map((dep) => (dep ? entityRevision(dep) : "x")),
  ].join(".");
  return { node, deps, figureDeps, datasetDeps, fingerprint };
}
