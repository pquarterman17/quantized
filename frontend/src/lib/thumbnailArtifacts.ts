import { figureChannelSelection, figureHasCurveEvidence, figureStatState } from "./originFigureSelection";
import { textColumnLabels } from "./originOverlay";
import { textXLetter } from "./originRecordedX";
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

function selections(request: ThumbnailRequest): { x: number | null; y: number[] | null; empty?: true } {
  const { node } = request;
  if (node.kind === "editable-figure") return { x: node.entity.bindings.xKey, y: node.entity.bindings.yKeys };
  if (node.kind === "publication-figure") return { x: node.entity.config.xKey, y: node.entity.config.yKeys };
  if (node.kind === "origin-figure") {
    // The SAME canonical curve→channel mapping the real apply action uses
    // (figureChannelSelection) against the node's OWN book-matched dataset
    // — the preview draws the columns the figure actually plots, and
    // degrades to the default selection exactly where the apply action
    // would too (null = nothing mapped), and stays EMPTY where the apply
    // fails closed (curves recorded, none resolved -- never every channel).
    const dataset = datasetFrom(request);
    const selection = dataset ? figureChannelSelection(node.entity.figure, dataset) : null;
    if (selection) return { x: selection.xKey, y: selection.yKeys };
    const stat = dataset ? figureStatState(node.entity.figure, dataset).statMode : undefined;
    if (!stat && figureHasCurveEvidence(node.entity.figure)) return { x: null, y: null, empty: true };
  }
  return { x: null, y: null };
}

/** An Origin figure whose curves RECORD a text (category) X that is not the
 *  book's own X (`textXLetter`): the apply draws them at positions 1..N
 *  (`buildOverlayDataset`), which `figureChannelSelection` cannot bind, so
 *  the preview builds the same positions here instead of staying empty. */
function textXPreview(request: ThumbnailRequest): { data: DataStruct; y: number[] } | null {
  const { node } = request;
  if (node.kind !== "origin-figure") return null;
  const dataset = datasetFrom(request);
  const letter = dataset ? textXLetter(node.entity.figure, dataset) : null;
  if (!dataset || !letter) return null;
  const meta = (dataset.data.metadata ?? {}) as Record<string, unknown>;
  const letters = Array.isArray(meta.origin_column_names) ? (meta.origin_column_names as unknown[]).map(String) : [];
  const book = String(meta.origin_book ?? "");
  const y = [...new Set((node.entity.figure.curves ?? [])
    .filter((c) => c.book === book && !c.rowFilter).map((c) => letters.indexOf(c.y)).filter((i) => i >= 0))];
  const n = textColumnLabels(dataset.data, letter).length;
  return { data: { ...dataset.data, time: dataset.data.time.map((_, i) => (i < n ? i + 1 : NaN)) }, y };
}

export async function generateFigureThumbnail(request: ThumbnailRequest, signal: AbortSignal): Promise<ThumbnailResult> {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const text = textXPreview(request);
  if (text) return svgResult(plotSvgBody(text.data, null, text.y), request.node.name);
  const { x, y, empty } = selections(request);
  return svgResult(plotSvgBody(empty ? null : dataFor(request), x, y), request.node.name);
}
