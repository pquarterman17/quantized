import { figureChannelSelection } from "./originFigures";
import type { ThumbnailRequest, ThumbnailResult } from "./thumbnailCache";
import { plotSvgBody, svgResult } from "./thumbnailSvg";
import type { DataStruct, Dataset } from "./types";

/** The dataset THIS node renders. Origin-figure nodes carry their own
 *  book-matched `datasetId` while `source.datasetIds` lists the whole
 *  LAYER FAMILY layer-ascending — a layer-2 node's first dep is layer 1's
 *  dataset, so "first dep" would preview the wrong book (PR #150 review).
 *  Editable/publication figures have single-dataset sources; first
 *  non-null is exact there. */
function datasetFrom(request: ThumbnailRequest): Dataset | undefined {
  const { node, datasetDeps } = request;
  if (node.kind === "origin-figure" && node.entity.datasetId != null) {
    return datasetDeps.find((dep) => dep?.id === node.entity.datasetId) ?? undefined;
  }
  return datasetDeps.find((dep) => dep != null) ?? undefined;
}

function dataFor(request: ThumbnailRequest): DataStruct | undefined {
  const { node } = request;
  if (node.kind === "editable-figure") {
    return node.entity.data.mode === "frozen" ? node.entity.data.snapshot : datasetFrom(request)?.data;
  }
  if (node.kind === "publication-figure") {
    return !node.entity.live ? node.entity.dataSnapshot : datasetFrom(request)?.data;
  }
  return datasetFrom(request)?.data;
}

function selections(request: ThumbnailRequest): { x: number | null; y: number[] | null } {
  const { node } = request;
  if (node.kind === "editable-figure") return { x: node.entity.bindings.xKey, y: node.entity.bindings.yKeys };
  if (node.kind === "publication-figure") return { x: node.entity.config.xKey, y: node.entity.config.yKeys };
  if (node.kind === "origin-figure") {
    // The SAME canonical curve→channel mapping the real apply action uses
    // (figureChannelSelection) against the node's OWN book-matched dataset
    // — the preview draws the columns the figure actually plots, and
    // degrades to the default selection exactly where the apply action
    // would too (null = nothing mapped).
    const dataset = datasetFrom(request);
    const selection = dataset ? figureChannelSelection(node.entity.figure, dataset) : null;
    if (selection) return { x: selection.xKey, y: selection.yKeys };
  }
  return { x: null, y: null };
}

export async function generateFigureThumbnail(request: ThumbnailRequest, signal: AbortSignal): Promise<ThumbnailResult> {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const { x, y } = selections(request);
  return svgResult(plotSvgBody(dataFor(request), x, y), request.node.name);
}
