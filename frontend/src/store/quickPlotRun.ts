// Quick Plot's MENU path (row menu, palette, workbook row): the one-click
// gesture, plus the error-pairing CONFIDENCE check (plans/
// LIBRARY_WORKBOOK_UX_PLAN.md: "ask before applying `low`"). The grade and the
// question load lazily (`lib/quickPlotErrorReview.ts`), which asks about any
// adjacency-only pairing, withholds a unit-blocked one unasked, and then runs
// `quickPlotDataset` with what to leave out. Cancelling creates nothing.
//
// `seedIsSettled` keeps the common case SYNCHRONOUS, exactly as Quick Plot
// always was: a cheap, conservative test that the review could neither ask
// nor withhold anything. Anything it cannot vouch for takes the lazy review,
// so it may say "unsure" but never "settled" wrongly (pinned against the whole
// confidence corpus by store/quickPlotErrorConfidence.test.ts).

import { compareUnits } from "../lib/errorUnitEvidence";
import { flatNorm } from "../lib/errorLabelCandidates";
import { classifyErrorLabelInLabels } from "../lib/errorLabelClassify";
import { declaresErrorRoles, figureSeedErrorBindings, type ErrorBinding } from "../lib/errorRoles";
import { quickPlotAvailability } from "../lib/quickPlot";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

/** True when every seeded pairing is DECLARED (Origin designations, a
 *  parser's `error_roles`) or a base-name match (`dR` -> `R`) whose units do
 *  not contradict: header evidence the grade never rates `low`. A seeded
 *  binding the label rules would NOT produce (the user chose it) is passed
 *  through by the review unasked, so vouching for one is safe too. */
export function seedIsSettled(ds: Pick<Dataset, "data" | "errorRoles">): boolean {
  const { labels, units = [] } = ds.data;
  if (declaresErrorRoles(ds.data)) return true;
  return figureSeedErrorBindings(ds).every((b) => {
    const base = b.target >= 0 && classifyErrorLabelInLabels(labels, b.channel)?.base;
    return (
      !!base &&
      flatNorm(labels[b.target]) === base &&
      compareUnits(units[b.channel], units[b.target]) !== "mismatch"
    );
  });
}

/** Quick Plot `datasetId` from a user gesture; `onDone` runs only when a
 *  figure was actually created (a refusal has no plot to return the Stage to). */
export function runQuickPlot(datasetId: string, onDone?: () => void): void {
  const create = (withhold?: readonly ErrorBinding[]): boolean => {
    const ok = useApp.getState().quickPlotDataset(datasetId, withhold);
    if (ok) onDone?.();
    return ok;
  };
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  if (!ds || !quickPlotAvailability(ds).available || seedIsSettled(ds)) {
    create();
    return;
  }
  void import("../lib/quickPlotErrorReview").then(
    (m) => m.reviewQuickPlotPairings(ds, create),
    () => useApp.setState({ status: "Quick Plot cancelled" }),
  );
}
