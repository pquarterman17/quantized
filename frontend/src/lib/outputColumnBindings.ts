// Who is bound to a worksheet's columns by INDEX (lane RPL, Replace in place).
// `collectBoundColumns` lists, per column index of worksheet `id`, the named
// holders that read it, so a Replace that would drop or blur one of them can
// refuse BY NAME (lib/outputColumnMap.ts plans the shifts; the store applies
// them with store/columnRemovalRefs.ts). Pure: plain slices in, a map out.
//
// The sites mirror `columnRemovalRefsPatch` (what a column delete remaps) plus
// the analysis results, which that path leaves alone:
//   plot windows / the live view  x, y, y2, group, facet, error columns
//   saved editable figures        the same bindings, errors and encodings
//   legacy publication figures    live ones only (a frozen doc has its snapshot)
//   Graph Builder specs           every zone channel
//   graph curves + inset layers   `LinkedCurve`s of ANY plot reading `id`
//   analysis results              plotBindings + selection of results on `id`
// Not column-bound, and why: pages hold `figureId`s (they follow the figure);
// a report entry holds a dataset back-reference and frozen blocks only; a
// derived worksheet and a sheet() reader are reported as `whole` / by letter.
// A holder with `null` yKeys / xKey is "automatic" and follows the layout.

import type { AnalysisResult } from "./analysisResult";
import { composeShifts } from "./outputColumnMap";
import type { FigureDocument } from "./figureDocument";
import type { FigureDoc } from "./figuredoc";
import type { InsetLayer } from "./graphLayers";
import type { PlotView } from "./plotview";
import type { SavedPlotSpec } from "./plotspec";
import type { ColumnShift } from "./channelRemap";
import type { ErrorBinding } from "./errorRoles";
import type { Dataset } from "./types";

export interface BoundColumns {
  /** old column index -> who uses it */
  cols: Map<number, string[]>;
}

export interface BindingSlices {
  /** Plot windows bound to the worksheet (title + current view). */
  windows: readonly { title: string; view: BoundView }[];
  /** Every plot's layers (windows of any dataset, the live view): inset curves may read `id`. */
  layerHolders: readonly { name: string; layers: readonly unknown[] | undefined }[];
  /** The live view when `id` is the active worksheet. */
  live: { name: string; view: BoundView } | null;
  editableFigures: readonly FigureDocument[];
  figureDocs: readonly FigureDoc[];
  savedPlotSpecs: readonly SavedPlotSpec[];
  datasets: readonly Dataset[];
  analysisResults: readonly AnalysisResult[];
  /** The result being replaced: its own refs are rewritten, never a blocker. */
  targetResultId: string;
}

export type BoundView = Pick<PlotView, "xKey" | "yKeys" | "y2Keys" | "groupKey" | "facetKey" | "errKeys">;

export function collectBoundColumns(id: string, s: BindingSlices): BoundColumns {
  const cols = new Map<number, string[]>();
  const mark = (c: number | null | undefined, who: string): void => {
    if (c === null || c === undefined || !Number.isInteger(c) || c < 0) return;
    const list = cols.get(c) ?? [];
    if (!list.includes(who)) list.push(who);
    cols.set(c, list);
  };
  const viewUses = (v: BoundView, who: string): void => {
    mark(v.xKey, who);
    for (const c of v.yKeys ?? []) mark(c, who);
    for (const c of v.y2Keys ?? []) mark(c, who);
    mark(v.groupKey, who);
    mark(v.facetKey, who);
    for (const [k, c] of Object.entries(v.errKeys ?? {})) { mark(Number(k), who); mark(c, who); }
  };
  const errorsUse = (errors: readonly ErrorBinding[] | null | undefined, who: string): void => {
    for (const e of errors ?? []) { mark(e.channel, who); mark(e.target, who); }
  };
  for (const w of s.windows) viewUses(w.view, `plot window “${w.title}”`);
  if (s.live) viewUses(s.live.view, `plot “${s.live.name}”`);
  for (const doc of s.editableFigures) {
    if (doc.bindings.datasetId !== id) continue;
    const who = `figure “${doc.name}”`;
    const b = doc.bindings;
    mark(b.xKey, who);
    for (const c of b.yKeys ?? []) mark(c, who);
    for (const c of b.y2Keys ?? []) mark(c, who);
    mark(b.groupKey, who);
    mark(b.facetKey, who);
    errorsUse(b.errors, who);
    for (const k of ["color", "symbol", "label"] as const) mark(b.encoding?.[k], who);
  }
  for (const f of s.figureDocs) {
    if (!f.live || f.datasetId !== id) continue;
    const who = `figure “${f.name}”`;
    mark(f.config.xKey, who);
    for (const c of f.config.yKeys ?? []) mark(c, who);
    mark(f.config.groupCol, who);
    errorsUse(f.config.errors, who);
  }
  for (const p of s.savedPlotSpecs) {
    const who = `graph “${p.name}”`;
    for (const r of Object.values(p.spec.zones).flat()) if (r && r.datasetId === id) mark(r.channel, who);
  }
  for (const d of s.datasets) {
    for (const c of d.linkedCurves ?? []) if (c.datasetId === id) { mark(c.xKey, `graph “${d.name}”`); mark(c.yKey, `graph “${d.name}”`); }
  }
  for (const h of s.layerHolders) {
    for (const layer of h.layers ?? []) {
      const curves = (layer as InsetLayer | null)?.curves;
      if (!Array.isArray(curves)) continue;
      for (const c of curves) if (c?.datasetId === id) { mark(c.xKey, `inset in “${h.name}”`); mark(c.yKey, `inset in “${h.name}”`); }
    }
  }
  for (const r of s.analysisResults) {
    if (r.id === s.targetResultId) continue;
    const who = `result “${r.name}”`;
    for (const b of r.plotBindings ?? []) if (b.datasetId === id) { for (const c of b.channels) mark(c, who); mark(b.xChannel, who); }
    if (r.selection?.datasetId === id) for (const c of r.selection.channels) mark(c.index, who);
  }
  return { cols };
}

/** `result` with its plotBindings / selection on worksheet `id` followed
 *  through `shifts` (a result is a record, so a dropped channel is cut). */
export function remapResultChannels(result: AnalysisResult, id: string, shifts: readonly ColumnShift[]): AnalysisResult {
  const map = composeShifts(shifts);
  const plotBindings = result.plotBindings?.map((b) => b.datasetId !== id ? b : {
    ...b,
    channels: b.channels.flatMap((c) => { const n = map(c); return n === null ? [] : [n]; }),
    ...(b.xChannel === undefined || b.xChannel === null ? {} : { xChannel: map(b.xChannel) }),
  });
  const selection = result.selection && result.selection.datasetId === id
    ? { ...result.selection, channels: result.selection.channels.flatMap((c) => { const n = map(c.index); return n === null ? [] : [{ ...c, index: n }]; }) }
    : result.selection;
  return {
    ...result,
    ...(plotBindings ? { plotBindings } : {}),
    ...(selection ? { selection } : {}),
  };
}

/** “Replace would remove column ‘χ’ used by figure “A” and graph “B”.” */
export function describeProblems(
  problems: readonly { col: number; label: string; kind: "removed" | "duplicate" }[],
  bound: BoundColumns,
): string {
  const parts = problems.map((p) => {
    const who = bound.cols.get(p.col) ?? [];
    const shown = who.slice(0, 4).join(", ").replace(/, ([^,]*)$/, " and $1");
    const more = who.length > 4 ? ` and ${who.length - 4} more` : "";
    const used = `used by ${shown}${more}`;
    return p.kind === "removed"
      ? `Replace would remove column ‘${p.label}’ ${used}`
      : `Replace cannot tell column ‘${p.label}’ apart (its name is not unique in the old or the new output), ${used}`;
  });
  return `${parts.join("; ")}.`;
}
