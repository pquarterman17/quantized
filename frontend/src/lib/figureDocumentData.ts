// The data a canonical figure document is allowed to render, split out of
// lib/figureSpec.ts (module-size ceiling); it re-exports it.

import type { FigureDocument } from "./figureDocument";
import type { Dataset, DataStruct } from "./types";

/** Resolve the data that a canonical document is allowed to render. A frozen
 * document is self-contained and intentionally ignores any live dataset. A
 * live document must name, and be given, its exact bound dataset: accepting a
 * different one would silently export the right styling against wrong data. */
export function resolveFigureDocumentData(
  document: FigureDocument,
  dataset?: Dataset | null,
): { data: DataStruct; channelRoles?: Dataset["channelRoles"] } {
  if (document.data.mode === "frozen") {
    if (!document.data.snapshot) throw new Error("frozen figure document has no data snapshot");
    return { data: structuredClone(document.data.snapshot) };
  }
  if (document.bindings.datasetId === null) throw new Error("live figure document has no dataset binding");
  if (!dataset) throw new Error(`live figure document requires dataset "${document.bindings.datasetId}"`);
  if (dataset.id !== document.bindings.datasetId) {
    throw new Error(`figure document is bound to dataset "${document.bindings.datasetId}", not "${dataset.id}"`);
  }
  return { data: dataset.data, channelRoles: dataset.channelRoles };
}
