// Using a named range as an INPUT (ROW_RANGE_CONTRACT 5.2, slice R4c): a plot draws its columns and only its rows, and
// an analysis reads its columns and rows. Both go through the paths that already exist (the plot's `PlotView.rowRange`
// and the shared analysis selection's `rowRange`, lib/analysisSelection), never a parallel one.
//
// LIVE LINK (ROW_RANGE_CONTRACT 5.2, `rowRange = { named: id }`). The plot window and the analysis row range hold the
// range's id, not a copy of its rows: a retarget of the named range, a row insert or a delete moves them (the cache
// the consumers read is re-read by store/rangeLinkSync), and a range that is later deleted or whose rows were replaced
// REFUSES (no rows drawn, the chip and the tool's input line say why), never widening to every row. A range that cannot
// be read right now (stale, broken, its sheet still loading) is refused at the pick, with the reason.

import { namedRangeIssue, describeNamedRange, type NamedRange } from "../lib/namedRanges";
import { resolveRangeLink } from "../lib/rangeLink";
import { resolveSelectionPlot } from "../lib/selectionplot";
import { plotIntentStageTab } from "../lib/stagetab";
import type { Dataset } from "../lib/types";
import { seedWorksheetAnalysisSelection } from "./analysisSelection";
import { linkPlotRowRange } from "./plotRowRangeSet";
import { installRangeLinkSync } from "./rangeLinkSync";
import { useApp } from "./useApp";

type Resolved = { range: NamedRange; ds: Dataset } | { reason: string };

/** The range, its worksheet, and nothing in the way of reading it now. */
export function resolveNamedRange(id: string): Resolved {
  const s = useApp.getState();
  const range = s.namedRanges.find((r) => r.id === id);
  if (!range) return { reason: "that named range no longer exists" };
  const issue = namedRangeIssue(range, s.datasets);
  if (issue) return { reason: issue };
  const ds = s.datasets.find((d) => d.id === range.target.datasetId)!;
  if (ds.pending) return { reason: `${ds.name} is still loading; try again when it has loaded` };
  return { range, ds };
}

const refuse = (what: string, reason: string): { ok: false; reason: string } => {
  useApp.getState().setStatus(`${what}: ${reason}`);
  return { ok: false, reason };
};

export type UseResult = { ok: true } | { ok: false; reason: string };

/** Plot the range's columns and draw only its rows, following the name live. The columns follow the worksheet's own "Plot
 *  selection" rules (an X-designated column becomes X, error columns pair to their Y), so this is that gesture on the
 *  range. A range with no row limit links too: "every row" is what it names now, and a later retarget limits the plot. */
export function plotNamedRange(id: string): UseResult {
  const found = resolveNamedRange(id);
  if ("reason" in found) return refuse("plot named range", found.reason);
  const { range, ds } = found;
  const app = useApp.getState();
  if (app.activeId !== ds.id) app.setActive(ds.id);
  const wantTab = plotIntentStageTab(ds);
  if (useApp.getState().stageTab !== wantTab) useApp.setState({ stageTab: wantTab });
  const cur = useApp.getState();
  const plan = resolveSelectionPlot(ds.data, new Set(range.target.cols), { xKey: cur.xKey, yKeys: cur.yKeys }, "replace");
  if (plan.actions.length === 0) return refuse("plot named range", `${range.name} has nothing plottable (${plan.summary})`);
  for (const action of plan.actions) {
    if (action.kind === "setXKey") useApp.getState().setXKey(action.xKey);
    else if (action.kind === "setYKeys") useApp.getState().setYKeys(action.yKeys);
    else useApp.getState().setErrKey(action.channel, action.errChannel);
  }
  const linked = linkPlotRowRange(id);
  if (!linked.ok) return refuse("plot named range", linked.reason);
  useApp.getState().setStatus(`plotted named range "${range.name}": ${describeNamedRange(range, useApp.getState().datasets)}`);
  return { ok: true };
}

/** Open the Analysis Center on the range: its columns as the roles and its rows as the row range. */
export function analyzeNamedRange(id: string): UseResult {
  const found = resolveNamedRange(id);
  if ("reason" in found) return refuse("analyze named range", found.reason);
  const { range, ds } = found;
  const rows = resolveRangeLink(id, ds.id, useApp.getState().namedRanges, useApp.getState().datasets);
  if (!seedWorksheetAnalysisSelection(ds.id, range.target.cols, [], rows)) return refuse("analyze named range", "the worksheet no longer exists");
  installRangeLinkSync();
  const app = useApp.getState();
  if (app.activeId !== ds.id) app.setActive(ds.id);
  useApp.getState().setStageTab("analysis");
  useApp.getState().setStatus(`analysis input set from named range "${range.name}": ${describeNamedRange(range, useApp.getState().datasets)}`);
  return { ok: true };
}

/** The analysis input picker's "from named range": replace tool `toolId`'s selection with the range's columns and rows. */
export function analysisInputFromNamedRange(id: string, toolId: string): UseResult {
  const found = resolveNamedRange(id);
  if ("reason" in found) return refuse("named range", found.reason);
  const { range, ds } = found;
  const rows = resolveRangeLink(id, ds.id, useApp.getState().namedRanges, useApp.getState().datasets);
  if (!seedWorksheetAnalysisSelection(ds.id, range.target.cols, [], rows, toolId)) return refuse("named range", "the worksheet no longer exists");
  installRangeLinkSync();
  useApp.getState().setStatus(`analysis input: named range "${range.name}" (${describeNamedRange(range, useApp.getState().datasets)})`);
  return { ok: true };
}
