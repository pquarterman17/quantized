// Linked FIGURE report blocks (G19, provisional - owner to confirm): the
// figure half of lib/reportLinks.ts. A figure block links an editable figure
// document by id; `link.pulled` is the fingerprint (document + live data) the
// block's embedded spec was built from, so the block is "behind" as soon as the
// figure or its worksheet changes. Refresh rebuilds the spec through the SAME
// builder "Send figure to report" uses (buildFigureSpecFromDocument, the saved
// fit swap and the excluded-rows question), keeping the block's own embed
// choices (format, style, greyscale), caption and name. Fails closed: a
// missing figure/worksheet or a not-fully-loaded worksheet keeps the snapshot.
// Lazy (report viewer only).

import { dataFingerprint } from "./dataFingerprint";
import { chooseExcludedRows } from "./excludedRowsChoice";
import { excludedChoiceMatters } from "./excludedRowsExport";
import type { FigureDocument } from "./figureDocument";
import { withFullSavedFit } from "./figureSavedFit";
import { buildFigureSpecFromDocument } from "./figureSpec";
import type { ReportBlock, ReportBlockLink, ReportFigureBlock } from "./report";
import { readBlockLink, type LinkState } from "./reportLinks";
import { REPORT_FIGURE_DPI } from "./sendFigureToReport";
import { stemFromName } from "./exportActive";
import { figureBlockFromSpec } from "./reportBlocks";
import type { Dataset } from "./types";
import type { useApp } from "../store/useApp";

type FigureLink = Extract<ReportBlockLink, { kind: "figure" }>;

export interface FigureLinkContext {
  figures: readonly FigureDocument[];
  datasets: readonly Dataset[];
}

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}
const keys = new WeakMap<object, string>();

/** Fingerprint of everything a figure's rendering depends on: the document
 *  and, for a live one, its worksheet's numbers. Null when the live
 *  worksheet is absent or only a preview (it cannot be judged). */
export function figureKey(doc: FigureDocument, datasets: readonly Dataset[]): string | null {
  let docKey = keys.get(doc);
  if (docKey === undefined) {
    docKey = hash(JSON.stringify(doc));
    keys.set(doc, docKey);
  }
  if (doc.data.mode !== "live") return docKey;
  const ds = datasets.find((d) => d.id === doc.bindings.datasetId);
  return ds && !ds.pending ? `${docKey}:${dataFingerprint(ds.data)}` : null;
}

export function figureLinkState(link: FigureLink, ctx: FigureLinkContext): LinkState {
  const doc = ctx.figures.find((f) => f.id === link.id);
  if (!doc) return { kind: "missing", reason: `the source figure${link.name ? ` "${link.name}"` : ""} was deleted` };
  const key = figureKey(doc, ctx.datasets);
  if (key === null) return { kind: "stale", reason: "the figure's worksheet is missing or not fully loaded" };
  return key === link.pulled
    ? { kind: "current" }
    : { kind: "behind", reason: "the figure or its data changed since this block was built" };
}

/** Link a figure block to `doc`, assuming the block shows it as it is now. */
export function linkBlockToFigure(block: ReportBlock, doc: FigureDocument, datasets: readonly Dataset[]): { block: ReportBlock } | { error: string } {
  if (block.type !== "figure") return { error: "only figure blocks link to a figure" };
  const pulled = figureKey(doc, datasets);
  if (pulled === null) return { error: "the figure's worksheet is missing or not fully loaded" };
  return { block: { ...block, link: { kind: "figure", id: doc.id, pulled, name: doc.name } } };
}

/** Rebuild a linked figure block from its figure. `kept` = reason it stays a
 *  snapshot (also when the user cancels the excluded-rows question). */
export async function refreshFigureBlock(
  get: typeof useApp.getState,
  block: ReportBlock,
): Promise<{ block: ReportBlock; changed: boolean } | { kept: string }> {
  const link = readBlockLink(block);
  if (!link || link.kind !== "figure" || block.type !== "figure") return { block, changed: false };
  const ctx = (): FigureLinkContext => ({ figures: get().editableFigures, datasets: get().datasets });
  const state = figureLinkState(link, ctx());
  if (state.kind === "current" || state.kind === "snapshot") return { block, changed: false };
  if (state.kind !== "behind") return { kept: state.reason };
  const doc0 = get().editableFigures.find((f) => f.id === link.id)!;
  try {
    const dataset = doc0.data.mode === "live" && doc0.bindings.datasetId
      ? await get().resolveDataset(doc0.bindings.datasetId) : undefined;
    const doc = get().editableFigures.find((f) => f.id === link.id);
    if (!doc) return { kept: "the source figure was deleted while refreshing" };
    const spec0 = block.spec ?? {};
    const opts = {
      fmt: spec0.fmt === "png" ? "png" : "svg",
      style: typeof spec0.style === "string" ? spec0.style : "default",
      greyscale: spec0.greyscale === true,
    };
    const stem = stemFromName(doc.name);
    const before = figureKey(doc, get().datasets);
    const full = await withFullSavedFit(doc, dataset, get().staleFits);
    const picked = await chooseExcludedRows(
      (greyExcluded) => buildFigureSpecFromDocument(full, dataset, stem, {
        ...opts, dpi: REPORT_FIGURE_DPI, greyExcluded, defaultTrace: get().defaultTrace,
        defaultLineWidth: get().defaultLineWidth, staleFits: get().staleFits,
      }),
      excludedChoiceMatters,
      get().excludedDisplay,
    );
    if (!picked) return { kept: "refresh cancelled" };
    const now = figureKey(get().editableFigures.find((f) => f.id === link.id) ?? doc, get().datasets);
    if (now === null || now !== before) return { kept: "the figure or its worksheet changed while refreshing; try again" };
    const rebuilt = figureBlockFromSpec(picked.value, block.name, block.caption ?? "");
    const next: ReportFigureBlock = { ...block, spec: rebuilt.spec, link: { ...link, pulled: now, name: doc.name } };
    return { block: next, changed: true };
  } catch (e) {
    return { kept: `could not rebuild the figure: ${e instanceof Error ? e.message : "error"}` };
  }
}
