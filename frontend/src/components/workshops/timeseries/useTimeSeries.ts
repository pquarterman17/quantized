// Time series workshop (GAP_AUDIT_9 G13): state hook. One channel of the active
// worksheet's ANALYSIS view (guard #11) against its X/time column goes to the
// five backend tools (routes/timeseries.py) on an explicit Run; a result is
// shown only while the series and settings still match it, and "Add as
// worksheet" commits through the result-lifecycle contract
// (store/commitComputedOutput: one undo step, no duplicate, stale on a change).
//
// Fail closed: blank / non-finite rows and an unevenly spaced X are refused
// with a reason (the latter unless "allow uneven spacing" is ticked); nothing is
// interpolated or dropped silently.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { analysisSeries, ROW_POLICY, type AnalysisInputs } from "../../../lib/analysisInputs";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { rowRangeKey } from "../../../lib/rangedView";
import { channelModelingType, isCategorical } from "../../../lib/modeling";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useActiveDataset } from "../../../store/useApp";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import type { TimeSeriesRecipe } from "../../../lib/toolResultKinds";
import { tsFigures, tsOutput, type TsFigure } from "./timeSeriesOutputs";
import { restoredOptions, useTimeSeriesResultBridge, type TimeSeriesBridge } from "./useTimeSeriesResultBridge";
import { runTimeSeries, tsDefaultOptions, tsProblem, tsRunKey, type TsOptions, type TsResult, type TsTab } from "./timeSeriesRun";

const PRODUCER = { id: "time-series", label: "Time series", version: 1 } as const;

interface Ran { key: string; result: TsResult; x: number[]; y: number[]; yLabel: string; xName: string }

export interface TimeSeriesState extends TimeSeriesBridge {
  hasData: boolean;
  inputs: AnalysisInputs;
  columns: { index: number; label: string }[];
  col: number;
  setCol: (i: number) => void;
  tab: TsTab;
  setTab: (t: TsTab) => void;
  opts: TsOptions;
  patch: <K extends keyof TsOptions>(section: K, value: TsOptions[K] extends object ? Partial<TsOptions[K]> : TsOptions[K]) => void;
  problem: string | null;
  busy: boolean;
  error: string | null;
  /** The result for the CURRENT series and settings, or null. */
  result: TsResult | null;
  stale: boolean;
  figures: TsFigure[];
  run: () => Promise<void>;
  canCommit: boolean;
  commit: () => void;
  done: string | null;
  /** The shown result's channel and X labels (the book's header). */
  yLabel: string;
  xName: string;
}

function firstContinuous(active: ReturnType<typeof useActiveDataset>): number {
  if (!active) return -1;
  const n = active.data.labels.length;
  for (let i = 0; i < n; i++) if (!isCategorical(channelModelingType(active, i))) return i;
  return n ? 0 : -1;
}

export function useTimeSeries(): TimeSeriesState {
  const active = useActiveDataset();
  const [col, setCol] = useState(() => firstContinuous(active));
  const [tab, setTab] = useState<TsTab>("correlogram");
  const [opts, setOpts] = useState<TsOptions>(tsDefaultOptions);
  const [ranBy, setRanBy] = useState<Partial<Record<TsTab, Ran>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => () => void seq.current++, []);

  const columns = useMemo(() => (active ? active.data.labels.map((label, index) => ({ index, label })) : []), [active]);
  useEffect(() => {
    seq.current++;
    setCol(firstContinuous(active));
    setRanBy({}); setError(null); setDone(null); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  useFollowColumnPicks(active, (follow) => {
    const next = follow(col);
    if (next !== col) setCol(next ?? firstContinuous(active));
  });

  const inputs = useAnalysisInputs({ xKey: null, yKeys: col >= 0 ? [col] : [], policy: ROW_POLICY.analysisView });
  const series = useMemo(() => (inputs.ok && col >= 0 ? analysisSeries(inputs) : null), [inputs, col]);
  // (The row range is part of the run key: a result computed on other rows is not this one.)
  const fingerprint = `${active && !active.pending ? analysisDataFingerprint(active) : "pending"}:${rowRangeKey(inputs.ok ? inputs.rowRange : null)}`;
  const key = tsRunKey(tab, fingerprint, col, opts);
  const problem = !series ? "Select a dataset and a channel." : tsProblem(tab, series.y, opts);
  const yLabel = columns.find((c) => c.index === col)?.label ?? `column ${col}`;
  const xName = String(active?.data.metadata?.["x_column_name"] ?? "x");

  const patch: TimeSeriesState["patch"] = (section, value) =>
    setOpts((o) => ({ ...o, [section]: typeof o[section] === "object" ? { ...(o[section] as object), ...(value as object) } : value }));

  async function run(): Promise<void> {
    if (!series || problem || busy) return;
    const id = ++seq.current;
    const { x, y } = series;
    setBusy(true); setError(null); setDone(null);
    try {
      const result = await runTimeSeries(tab, y, x, opts);
      if (seq.current === id) setRanBy((m) => ({ ...m, [tab]: { key, result, x, y, yLabel, xName } }));
    } catch (e) {
      if (seq.current === id) { setRanBy((m) => ({ ...m, [tab]: undefined })); setError(e instanceof Error ? e.message : "time-series run failed"); }
    } finally {
      if (seq.current === id) setBusy(false);
    }
  }

  const ran = ranBy[tab] ?? null;
  const current = ran && ran.key === key ? ran : null;
  const figures = useMemo(() => (current ? tsFigures(current.result, current.x, current.y, current.yLabel, current.xName) : []), [current]);
  const canCommit = !!current && !!active && !active.pending && !busy;
  const restore = useCallback((r: TimeSeriesRecipe) => {
    seq.current++;
    setCol(r.col); setTab(r.tool); setOpts(restoredOptions(r));
    setRanBy({}); setError(null); setDone(null); setBusy(false);
  }, []);
  const snapshot = useMemo(() => (current ? { run: current.result, x: current.x, y: current.y, yLabel: current.yLabel, xName: current.xName } : null), [current]);
  const bridge = useTimeSeriesResultBridge({ active, tab, col, opts, snapshot, busy, restore });

  function commit(): void {
    if (!current || !active || !canCommit) return;
    const { name, data } = tsOutput(current.result, current.x, current.y, current.yLabel, current.xName);
    const optionsOf: Record<TsTab, unknown> = { correlogram: opts.corr, stationarity: opts.stat, decompose: opts.decomp, changepoint: opts.cp, arima: opts.arima };
    const outcome = commitComputedOutput({
      producer: PRODUCER,
      sources: [{ id: active.id, computedOn: analysisDataFingerprint(active) }],
      settings: { tab, col, allowIrregular: opts.allowIrregular, options: optionsOf[tab] },
      name, data, xKey: null, yChannel: col, quiet: true,
    });
    if (outcome.kind === "refused") setError(outcome.reason);
    else setDone(outcome.kind === "existing" ? `"${name}" is already added; nothing was duplicated.` : `Added "${name}".`);
  }

  return {
    hasData: !!active, inputs, columns, col, setCol, tab, setTab: (t) => { setTab(t); setError(null); setDone(null); }, opts, patch, problem, busy, error,
    result: current?.result ?? null, stale: !!ran && !current, figures, run, canCommit, commit, done,
    yLabel: current?.yLabel ?? yLabel, xName: current?.xName ?? xName, ...bridge,
  };
}
