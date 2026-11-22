// Replace-in-place and the worksheet's column layout (lane RPL). A committed
// output replaced by a new computation may reorder, add or drop columns, but
// everything bound to the OLD worksheet by column index must not break
// silently: `outputLayoutVerdict` allows the replace only when every bound
// column still exists by (unique) name, and `outputLayoutPatch` re-points the
// bindings by name through the same shift remap a column delete / insert / move
// uses (store/columnRemovalRefs.ts). Both are computed from the LIVE state:
// before a commit (the banner) and again at commit time (a binding added in
// between is caught). See lib/outputColumnBindings.ts for the sites covered.

import type { ColumnShift } from "../lib/channelRemap";
import { formulaExtension } from "../lib/formulaExt";
import { collectBoundColumns, describeProblems, remapResultChannels } from "../lib/outputColumnBindings";
import { planColumnMapByName } from "../lib/outputColumnMap";
import type { Dataset } from "../lib/types";
import { columnRemovalRefsPatch } from "./columnRemovalRefs";
import type { AppState } from "./useApp";
import { plotWindowDatasetId, plotWindowView } from "./windowDocuments";

export type LayoutVerdict = { ok: true; shifts: ColumnShift[] } | { ok: false; reason: string };

const sameLabels = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((l, i) => l === b[i]);

export function outputLayoutVerdict(
  s: Pick<AppState, "datasets" | "plotWindows" | "layers" | "activeId" | "editableFigures" | "figureDocs" | "savedPlotSpecs" | "analysisResults" | "xKey" | "yKeys" | "y2Keys" | "groupKey" | "facetKey" | "errKeys">,
  outputId: string,
  newLabels: readonly string[],
  targetResultId: string,
): LayoutVerdict {
  const old = s.datasets.find((d) => d.id === outputId);
  if (!old) return { ok: true, shifts: [] };
  const oldLabels = old.data.labels;
  if (sameLabels(oldLabels, newLabels)) return { ok: true, shifts: [] };

  // A derived worksheet re-derives from this output's whole table (its
  // pipeline picks columns by index): any layout change is refused by name.
  const derived = s.datasets.filter((d) => d.derivedFrom?.datasetId === outputId);
  if (derived.length) {
    return { ok: false, reason: `Replace would change the columns of ${derived.map((d) => `“${d.name}”`).join(", ")}, which derives from this output.` };
  }

  const windows = s.plotWindows.filter((w) => plotWindowDatasetId(w) === outputId);
  const active = s.activeId === outputId ? old : null;
  const bound = collectBoundColumns(outputId, {
    windows: windows.map((w) => ({ title: w.title, view: plotWindowView(w) })),
    layerHolders: [
      ...s.plotWindows.map((w) => ({ name: w.title, layers: plotWindowView(w).layers })),
      { name: "the active plot", layers: s.layers },
      ...s.editableFigures.map((d) => ({ name: d.name, layers: d.plot.view.layers })),
    ],
    live: active ? { name: active.name, view: s } : null,
    editableFigures: s.editableFigures,
    figureDocs: s.figureDocs,
    savedPlotSpecs: s.savedPlotSpecs,
    datasets: s.datasets,
    analysisResults: s.analysisResults,
    targetResultId,
  });

  // Other worksheets' formulas reading this one through sheet("Name", L).
  const readers = s.datasets.filter((d) => d.id !== outputId && d.formulas?.some((f) => f.sheets?.some((b) => b.id === outputId)));
  if (readers.length) {
    const ext = formulaExtension();
    if (!ext) {
      return { ok: false, reason: `Replace would change columns read by ${readers.map((d) => `“${d.name}”`).join(", ")} through sheet(); load the formula module first.` };
    }
    for (const [col, names] of ext.sheetColumnsRead(s.datasets, outputId)) {
      const list = bound.cols.get(col) ?? [];
      for (const name of names) list.push(`worksheet “${name}” (sheet())`);
      bound.cols.set(col, list);
    }
  }

  const plan = planColumnMapByName(oldLabels, newLabels, new Set(bound.cols.keys()));
  return plan.ok ? { ok: true, shifts: plan.shifts } : { ok: false, reason: describeProblems(plan.problems, bound) };
}

/** The store patch that re-points every binding of worksheet `id` through
 *  `shifts` (`datasets` = the worksheets AFTER the replace; `skipResultId` =
 *  the replaced result, whose refs are already the new ones). One undo step is
 *  the caller's job. */
export function outputLayoutPatch(
  s: AppState, id: string, shifts: readonly ColumnShift[], datasets: readonly Dataset[], skipResultId: string,
): Partial<AppState> {
  let acc: Partial<AppState> = {};
  let ds = datasets;
  for (const shift of shifts) {
    const patch = columnRemovalRefsPatch({ ...s, ...acc }, id, shift, ds);
    acc = { ...acc, ...patch };
    if (patch.datasets) ds = patch.datasets;
  }
  if (!shifts.length) return {};
  const base = acc.analysisResults ?? s.analysisResults;
  return { ...acc, datasets: [...ds], analysisResults: base.map((r) => (r.id === skipResultId ? r : remapResultChannels(r, id, shifts))) };
}
