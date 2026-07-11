// Selection → plot mapping (WORKSHEET_PLAN item 7): Origin's "highlight
// columns, then plot" gesture. Turns a set of selected worksheet columns
// (col index -1 = the pinned x/time column, 0..N-1 = value channels — the
// SAME numbering `useWorksheetView.toggleSort`/`lib/columnmeta` already use)
// into store actions (setXKey / setYKeys / the setErrKey action), using the
// SAME column-designation alignment (lib/columnmeta.columnMetaList) that
// drives the header badges (item 4) and error-bar pairing
// (lib/errorbars.originErrKeys) — so all three can never drift apart. This
// module only DECIDES; the caller (useWorksheetView) applies the actions
// through the existing store — no new plotting pathway (mirrors
// lib/dragaxis.ts's resolveAxisDrop / useAxisDrop split).

import { columnMetaList } from "./columnmeta";
import { defaultDenseChannels } from "./plotdata";
import type { PlotSpec } from "./plotspec";
import type { DataStruct } from "./types";

export type SelectionPlotAction =
  | { kind: "setXKey"; xKey: number | null }
  | { kind: "setYKeys"; yKeys: number[] | null }
  | { kind: "setErrKey"; channel: number; errChannel: number };

export interface SelectionPlotResult {
  /** Store actions to run, in order (empty when the selection has nothing
   *  plottable — e.g. only Label/Disregard/error columns selected). */
  actions: SelectionPlotAction[];
  /** Human-readable summary for a status message. */
  summary: string;
}

export interface SelectionPlotAxis {
  xKey: number | null;
  yKeys: number[] | null;
}

/** Map a worksheet column selection onto plot store actions:
 *  - An X-designated value column in the selection wins as the new X axis.
 *    Absent one, selecting the pinned x/time column (-1) explicitly resets X
 *    to `.time` (xKey null). Absent BOTH, the CURRENT xKey is left untouched
 *    (no setXKey action at all).
 *  - Every remaining selected value column becomes a Y series, in ascending
 *    channel order, EXCEPT: the column just chosen as X (never also a Y),
 *    any secondary "X" designation (Origin's own rule — never its own
 *    series), and "Label"/"Disregard" columns (never plotted).
 *  - A selected "Y-error" column pairs to the nearest PRECEDING selected Y
 *    column (mirrors `lib/errorbars.originErrKeys`'s rule, scoped to this
 *    selection) and is never itself added to the Y list. An error column
 *    with no preceding Y in the selection is dropped silently (never plotted
 *    as data, matching `lib/errorbars.originHiddenChannels`).
 *  - `mode: "replace"` ("Plot selection") sets yKeys to exactly the
 *    selection's Y set; `mode: "add"` ("Add to plot") unions it into the
 *    CURRENT yKeys (expanding the null "auto/dense" sentinel to its concrete
 *    default first, mirroring `lib/dragaxis.ts`'s `ensureVisible`).
 */
export function resolveSelectionPlot(
  data: DataStruct,
  selectedCols: ReadonlySet<number>,
  current: SelectionPlotAxis,
  mode: "replace" | "add",
): SelectionPlotResult {
  if (selectedCols.size === 0) return { actions: [], summary: "no columns selected" };

  const meta = columnMetaList(data);
  const valueCols = [...selectedCols].filter((c) => c >= 0).sort((a, b) => a - b);

  // 1. Resolve X: an X-designated selected value column wins outright; else
  // an explicit selection of the pinned x/time column resets to `.time`;
  // else leave the current xKey alone (xKey stays `undefined` = "no change").
  // A resolved X that already MATCHES the current xKey also collapses back to
  // "no change" — no spurious setXKey (and macro step) for a no-op.
  let xKey: number | null | undefined;
  const xDesignated = valueCols.find((c) => meta[c]?.designation === "X");
  if (xDesignated !== undefined) xKey = xDesignated;
  else if (selectedCols.has(-1)) xKey = null;
  if (xKey === current.xKey) xKey = undefined;
  const resolvedXKey = xKey !== undefined ? xKey : current.xKey;

  // 2. Resolve Y + Y-error pairing, in ascending selected-column order.
  const yList: number[] = [];
  const errActions: SelectionPlotAction[] = [];
  let lastY: number | null = null;
  for (const c of valueCols) {
    if (c === resolvedXKey) continue; // never also a Y
    const d = meta[c]?.designation;
    if (d === "Label" || d === "Disregard" || d === "X-error" || d === "X") continue; // never plotted
    if (d === "Y-error") {
      if (lastY !== null) errActions.push({ kind: "setErrKey", channel: lastY, errChannel: c });
      continue; // an error column is never itself a Y series
    }
    yList.push(c);
    lastY = c;
  }

  const actions: SelectionPlotAction[] = [];
  if (xKey !== undefined) actions.push({ kind: "setXKey", xKey });
  if (yList.length > 0) {
    const base = mode === "add" ? (current.yKeys ?? defaultDenseChannels(data, resolvedXKey)) : [];
    const yKeys = mode === "replace" ? yList : [...new Set([...base, ...yList])].sort((a, b) => a - b);
    actions.push({ kind: "setYKeys", yKeys });
  }
  actions.push(...errActions);

  const verb = mode === "replace" ? "Plot selection" : "Add to plot";
  const summary =
    yList.length === 0
      ? "nothing plottable in the selection"
      : `${verb}: ${yList.length} channel${yList.length === 1 ? "" : "s"}${xKey !== undefined ? ", X updated" : ""}`;
  return { actions, summary };
}

/** Selection → Graph Builder handoff (MAIN_PLAN #4): turn a worksheet column
 *  selection into a prefilled `lib/plotspec` PlotSpec instead of plotting
 *  directly. Same column numbering and the same designation semantics as
 *  `resolveSelectionPlot` above, adapted to the well grammar:
 *  - "Label"/"Disregard" columns and error columns (X-error/Y-error) are
 *    skipped — the spec grammar has no error wells, and labels never plot.
 *  - An X-designated selected column wins the X well (Origin's own rule);
 *    absent one, the FIRST selected value column takes X when two or more
 *    are selected. A single selected column (or an explicit selection of the
 *    pinned x/time column, -1, alongside values) leaves the X well empty —
 *    `specToRender` then plots against the dataset's own x/time column.
 *  - Every remaining value column lands in the Y well, ascending order.
 *  Returns null when nothing plottable is selected (empty selection, only
 *  the x column, or only label/error columns) — the caller disables/skips.
 *  The mark stays the harmless "scatter" default; the consumer re-infers it
 *  via `withInferredMark` with a live MarkContext. Row state is NOT read
 *  here: the spec renders through `specToRender` → rowstate.analysisData, so
 *  exclusion (#50) + filter (#53) are honored by the chokepoint (guard #11). */
export function selectionToSpec(
  data: DataStruct,
  datasetId: string,
  cols: Iterable<number>,
): PlotSpec | null {
  const meta = columnMetaList(data);
  const unique = [...new Set(cols)];
  const hasExplicitX = unique.some((c) => c < 0);
  const valueCols = unique
    .filter((c) => c >= 0)
    .filter((c) => {
      const d = meta[c]?.designation;
      return d !== "Label" && d !== "Disregard" && d !== "X-error" && d !== "Y-error";
    })
    .sort((a, b) => a - b);
  if (valueCols.length === 0) return null;

  const xDesignated = valueCols.find((c) => meta[c]?.designation === "X");
  let xChannel: number | null = null;
  let yCols: number[];
  if (xDesignated !== undefined) {
    xChannel = xDesignated;
    // Any FURTHER X-designated column is a secondary X — never its own Y
    // series (the same rule resolveSelectionPlot applies).
    yCols = valueCols.filter((c) => meta[c]?.designation !== "X");
  } else if (!hasExplicitX && valueCols.length >= 2) {
    xChannel = valueCols[0];
    yCols = valueCols.slice(1);
  } else {
    yCols = valueCols;
  }
  if (yCols.length === 0) return null; // e.g. only an X-designated column selected

  return {
    version: 1,
    zones: {
      x: xChannel === null ? null : { datasetId, channel: xChannel },
      y: yCols.map((channel) => ({ datasetId, channel })),
      group: null,
      facet: null,
    },
    mark: "scatter",
  };
}
