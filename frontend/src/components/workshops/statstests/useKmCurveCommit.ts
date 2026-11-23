// Statistical tests: "Add curve as worksheet" / "Add as plot" for a Kaplan-Meier
// result, on the shared result-commit contract (store/analysisOutputCommit.ts):
// one undo step with the Library result, a repeat adds nothing, the output goes
// out of date when the source worksheet changes, linked to the source. Off by
// default: nothing is written until a button is clicked. Both buttons write the
// SAME worksheet (same key); "Add as plot" also gives it its own plot window
// with the curve drawn as a step.

import { useMemo } from "react";

import type { KaplanMeierResult } from "../../../lib/api/statsTestsSurvival";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { dataFingerprint } from "../../../lib/dataFingerprint";
import { kaplanMeierPlotView, kaplanMeierWorksheet } from "../../../lib/survivalCurveWorksheet";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useAnalysisCommit } from "../resultcommit/useAnalysisCommit";

const KM_PRODUCER = { id: "km-curve", label: "Kaplan-Meier curve", version: 1 } as const;

/** The Kaplan-Meier answer on screen, with what it was computed from. */
export interface KmRun {
  result: KaplanMeierResult;
  sourceId: string;
  /** `analysisDataFingerprint` of the source as the test ran. */
  computedOn: string;
  sourceName: string;
  timeLabel: string;
  timeUnit: string;
  settings: Record<string, unknown>;
  /** The time-to-event column the test read (channel index; null = the time axis). */
  timeKey: number | null;
}

export function kmRunOf(result: KaplanMeierResult, source: Dataset, labels: string[], timeIndex: number, settings: Record<string, unknown>): KmRun {
  return {
    result, sourceId: source.id, computedOn: analysisDataFingerprint(source), sourceName: source.name,
    timeLabel: labels[0] ?? "time", timeUnit: timeIndex >= 0 ? source.data.units[timeIndex] ?? "" : "", settings,
    timeKey: timeIndex >= 0 ? timeIndex : null,
  };
}

export interface KmCurveCommit {
  /** Why the buttons are disabled (null when enabled). */
  disabledReason: string | null;
  addWorksheet: () => void;
  addPlot: () => void;
}

export function useKmCurveCommit(km: KmRun | null, stale: boolean): KmCurveCommit {
  const createWindow = useApp((s) => s.createWindow);
  const focusWindow = useApp((s) => s.focusWindow);
  const sheet = useMemo(() => (km ? kaplanMeierWorksheet(km.result, km.timeLabel, km.timeUnit) : null), [km]);
  const name = km ? `Kaplan-Meier curve — ${km.sourceName}` : "";
  const base = km && sheet && !stale ? {
    producer: KM_PRODUCER,
    sourceId: km.sourceId,
    computedOn: km.computedOn,
    settings: { ...km.settings, output: dataFingerprint(sheet.data) },
    xKey: km.timeKey, // the time-to-event column the curve was computed from (C9)
    output: () => ({ name, data: sheet.data }),
  } : null;
  const worksheet = useAnalysisCommit(base && { ...base, quiet: true, status: `added ${name}` });
  const plot = useAnalysisCommit(base && {
    ...base,
    status: `added ${name} as a plot`,
    // Its own window, so the source plot is left alone (as the fit band does).
    beforeWrite: () => focusWindow(createWindow(null, undefined, "Kaplan-Meier curve")),
    intoFocused: true,
  });
  const disabledReason = !km ? "Run Kaplan-Meier first: there is no current result to add."
    : stale ? "Out of date: the source rows changed after this result was computed. Run the test again."
    : worksheet.disabledReason;
  return {
    disabledReason,
    addWorksheet: () => {
      if (!disabledReason) worksheet.commit();
    },
    addPlot: () => {
      if (disabledReason || !sheet) return;
      // The view goes on after the rebind, which resets it to the dataset defaults.
      if (plot.commit()?.kind === "created") useApp.setState(kaplanMeierPlotView(sheet));
    },
  };
}
