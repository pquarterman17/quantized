// Test chooser (#26) — state hook. Builds group vectors from the active
// dataset (columns mode: one group per picked column; group-by mode: a value
// column partitioned by a categorical column), asks /api/stats/recommend which
// test fits (assumption checks + plain-language reasons), then runs the
// recommended test one-click and can land the result as a #36 report. Reads
// the ANALYSIS view (rowstate.analysisData) so exclusions/filters are honored.

import { useEffect, useMemo, useRef, useState } from "react";

import { reportEmit, statsRecommend, statsRunTest } from "../../../lib/api";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { ROW_POLICY, type AnalysisInputs } from "../../../lib/analysisInputs";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";
import {
  buildRunRequest,
  groupsByCategory,
  groupsFromColumns,
  reportRecord,
  type GroupSpec,
  type Recommendation,
} from "../../../lib/statschooser";
import type { CalcResult, Dataset } from "../../../lib/types";
import { addReportWithProvenance } from "../../../store/addReportWithProvenance";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { lazyLineage } from "../../../lib/bookData";
import { useLatestRef } from "../../../lib/previewKey";
import { useGroupableActive } from "../useGroupableActive";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import { datasetInputsToken } from "../workbench/inputsKey";
import { useRunStamp } from "../workbench/useRunStamp";

export type ChooserMode = "columns" | "groupby";

export interface ChooserColumn {
  index: number;
  label: string;
}

export interface StatsChooserState {
  active: Dataset | null;
  /** What is analysed, under the shared input contract. */
  inputs: AnalysisInputs;
  columns: ChooserColumn[];
  /** `columns` plus the CSV text columns that can group rows: the "Group by" choices. */
  groupColumns: ChooserColumn[];
  mode: ChooserMode;
  setMode: (m: ChooserMode) => void;
  // columns mode
  cols: number[];
  toggleCol: (i: number) => void;
  // group-by mode
  valueCol: number;
  byCol: number;
  setValueCol: (i: number) => void;
  setByCol: (i: number) => void;
  byIsCategorical: boolean;
  // shared
  groups: GroupSpec[];
  paired: boolean;
  setPaired: (p: boolean) => void;
  pairable: boolean;
  busy: boolean;
  error: string | null;
  rec: Recommendation | null;
  testResult: CalcResult | null;
  /** The shown recommendation / result was computed for rows or data that have since changed. */
  stale: boolean;
  recommend: () => Promise<void>;
  runRecommended: () => Promise<void>;
  toReport: () => Promise<void>;
}

export function useStatsChooser(): StatsChooserState {
  const active = useActiveDataset();
  // The "Group by" picker also offers the sheet's CSV text columns (see useGroupableActive).
  const grouped = useGroupableActive();
  const groupColumns = useMemo<ChooserColumn[]>(() => {
    if (!grouped) return [];
    const xName = String(grouped.data.metadata?.["x_column_name"] ?? "x");
    return [{ index: -1, label: xName }, ...grouped.data.labels.map((label, index) => ({ index, label }))];
  }, [grouped]);
  const columns = useMemo<ChooserColumn[]>(() => {
    if (!active) return [];
    const xName = String(active.data.metadata?.["x_column_name"] ?? "x");
    return [
      { index: -1, label: xName },
      ...active.data.labels.map((lab, i) => ({ index: i, label: lab })),
    ];
  }, [active]);

  const [mode, setMode] = useState<ChooserMode>("columns");
  const [cols, setCols] = useState<number[]>(() =>
    active && active.data.labels.length ? [0] : [],
  );
  const [byCol, setByCol] = useState<number>(() => firstCategorical(active) ?? 0);
  const [valueCol, setValueCol] = useState<number>(() =>
    firstContinuous(active, firstCategorical(active) ?? 0),
  );
  const [paired, setPaired] = useState(false);
  // A column added/removed under a pick follows it by label (../useFollowColumnPicks).
  useFollowColumnPicks(grouped, (follow) => {
    const next = cols.map(follow).filter((c): c is number => c !== null);
    const by = follow(byCol) ?? firstCategorical(active) ?? 0;
    const value = follow(valueCol) ?? firstContinuous(active, by);
    if (next.join() !== cols.join()) setCols(next);
    if (by !== byCol) setByCol(by);
    if (value !== valueCol) setValueCol(value);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [testResult, setTestResult] = useState<CalcResult | null>(null);
  const [queuedRecommendation, setQueuedRecommendation] = useState<{ key: string; id: string; lineage: string | null } | null>(null);
  // Lane WB7: a change to the picks still DROPS the answer (invalidate); a change
  // to the SOURCE rows / data after it landed marks it out of date and withholds
  // Run / Report. `seq` makes an answer for dropped picks land nowhere.
  const seq = useRef(0);
  const stamp = useRunStamp(datasetInputsToken(active));
  const stale = (rec !== null || testResult !== null) && stamp.stale;
  const staleNow = useLatestRef(stale);

  // The shared input contract (lib/analysisInputs): the active worksheet's
  // analysis view over the columns the current mode reads. A lazy Origin
  // preview is refused here; "Recommend" still queues behind the full load.
  const inputs = useAnalysisInputs({ noX: true, yKeys: mode === "columns" ? cols : [valueCol, byCol], policy: ROW_POLICY.analysisView, textGroups: true });
  const data = inputs.ok ? inputs.data : null;

  const groups = useMemo<GroupSpec[]>(() => {
    if (!data) return [];
    return mode === "columns"
      ? groupsFromColumns(data, cols)
      : groupsByCategory(data, valueCol, byCol);
  }, [data, mode, cols, valueCol, byCol]);

  const pairable =
    groups.length === 2 && groups[0].values.length === groups[1].values.length;
  const byIsCategorical =
    !!grouped && byCol >= 0 && isCategorical(channelModelingType(grouped, byCol));

  const toggleCol = (i: number) =>
    setCols((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]));

  const invalidate = () => {
    seq.current++;
    stamp.record(null);
    setBusy(false);
    setRec(null);
    setTestResult(null);
    setError(null);
  };

  const recommendationKey = JSON.stringify({
    datasetId: active?.id ?? null,
    mode,
    cols,
    valueCol,
    byCol,
    paired,
  });

  async function recommend(): Promise<void> {
    // A lazy Origin preview is refused by the shared resolver (its rows are a
    // downsample). `useAnalysisInputs` is already loading the full book, so the
    // recommendation QUEUES on the resolver's own state (the effect below)
    // instead of fetching the book a second way.
    if (!inputs.ok && inputs.code === "pending" && inputs.dataset) {
      setQueuedRecommendation({ key: recommendationKey, id: inputs.dataset.id, lineage: lazyLineage(inputs.dataset) });
      setBusy(true);
      setError(null);
      useApp.getState().setStatus(`Loading full data for "${inputs.dataset.name}" — test recommendation will continue automatically`);
      return;
    }
    if (!inputs.ok && inputs.code === "load-failed") {
      // Say the real cause (not "no groups") and re-kick the single-flight load.
      if (inputs.dataset) useApp.getState().ensureBookData(inputs.dataset.id);
      setBusy(false);
      setError(`Could not recommend a test because the full dataset failed to load: ${inputs.reason}`);
      return;
    }
    if (groups.length === 0) {
      setBusy(false);
      setRec(null);
      setTestResult(null);
      setError("No groups remain in the selected data; check the columns, filters, and excluded rows.");
      return;
    }
    const request = ++seq.current;
    const launchKey = stamp.launchKey();
    setBusy(true);
    setError(null);
    setTestResult(null);
    stamp.record(null);
    try {
      const r = await statsRecommend({
        groups: groups.map((g) => g.values),
        paired: paired && pairable,
      });
      if (request !== seq.current) return;
      stamp.record(launchKey);
      setRec(r);
    } catch (e) {
      if (request !== seq.current) return;
      setRec(null);
      setError(e instanceof Error ? e.message : "recommendation failed");
    } finally {
      if (request === seq.current) setBusy(false);
    }
  }

  // The queued recommendation proceeds only once the resolver yields the full
  // rows of the SAME book for the SAME picks; it stops, with the reason, on
  // anything else. Never recommends from a preview or a replacement.
  useEffect(() => {
    if (!queuedRecommendation) return;
    const stop = (message: string) => {
      setQueuedRecommendation(null);
      setBusy(false);
      setError(message);
    };
    if (active?.id !== queuedRecommendation.id) return stop("The recommendation was skipped because the active dataset changed while loading.");
    if (!inputs.ok && inputs.code === "pending") return; // still loading
    if (!inputs.ok && inputs.code === "load-failed") return stop(`Could not recommend a test because the full dataset failed to load: ${inputs.reason}`);
    if (!inputs.dataset || queuedRecommendation.lineage === null || lazyLineage(inputs.dataset) !== queuedRecommendation.lineage) {
      return stop("Could not recommend a test because the full dataset is unavailable; re-import the source to continue.");
    }
    if (queuedRecommendation.key !== recommendationKey) {
      return stop("The recommendation was skipped because the selected columns changed or the dataset was replaced while loading.");
    }
    setQueuedRecommendation(null);
    void recommend();
    // `recommendationKey` captures every user choice that can change groups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, inputs, recommendationKey, queuedRecommendation]);

  async function runRecommended(): Promise<void> {
    if (!rec || stale) return;
    const req = buildRunRequest(
      rec.endpoint,
      groups.map((g) => g.values),
      rec.paired,
    );
    if (!req) {
      setError(`don't know how to run ${rec.endpoint}`);
      return;
    }
    const request = ++seq.current;
    const launchKey = stamp.launchKey();
    setBusy(true);
    setError(null);
    try {
      const result = await statsRunTest(req.path, req.body);
      if (request !== seq.current) return;
      stamp.record(launchKey);
      setTestResult(result);
    } catch (e) {
      if (request !== seq.current) return;
      setTestResult(null);
      setError(e instanceof Error ? e.message : "test failed");
    } finally {
      if (request === seq.current) setBusy(false);
    }
  }

  async function toReport(): Promise<void> {
    if (!rec || !testResult || !active || stale) return;
    const request = seq.current;
    setBusy(true);
    try {
      const { report } = await reportEmit({
        kind: "stats_table",
        records: [reportRecord(rec.recommendation, testResult)],
        title: `${rec.recommendation} — ${active.name}`,
        caption: rec.reasons.join("; "),
        source_refs: [{ kind: "dataset", id: active.id, name: active.name }],
      });
      if (request !== seq.current || staleNow.current) return; // the answer changed while the report was built
      addReportWithProvenance(`${rec.recommendation} — ${active.name}`, report, active.id);
    } catch (e) {
      toast(`could not add to report — ${e instanceof Error ? e.message : "unknown error"}`, "danger");
    } finally {
      setBusy(false);
    }
  }

  return {
    active,
    inputs,
    columns,
    groupColumns,
    mode,
    setMode: (m) => {
      setMode(m);
      invalidate();
    },
    cols,
    toggleCol: (i) => {
      toggleCol(i);
      invalidate();
    },
    valueCol,
    byCol,
    setValueCol: (i) => {
      setValueCol(i);
      invalidate();
    },
    setByCol: (i) => {
      setByCol(i);
      invalidate();
    },
    byIsCategorical,
    groups,
    paired,
    setPaired: (p) => {
      setPaired(p);
      invalidate();
    },
    pairable,
    busy,
    error,
    rec,
    testResult,
    stale,
    recommend,
    runRecommended,
    toReport,
  };
}

/** First channel that reads as categorical (nominal/ordinal), or null. */
function firstCategorical(active: Dataset | null): number | null {
  if (!active) return null;
  for (let i = 0; i < active.data.labels.length; i++) {
    if (isCategorical(channelModelingType(active, i))) return i;
  }
  return null;
}

/** First continuous channel that isn't `avoid`, else the first other channel. */
function firstContinuous(active: Dataset | null, avoid: number): number {
  if (!active) return 0;
  const n = active.data.labels.length;
  for (let i = 0; i < n; i++) {
    if (i !== avoid && !isCategorical(channelModelingType(active, i))) return i;
  }
  for (let i = 0; i < n; i++) if (i !== avoid) return i;
  return 0;
}
