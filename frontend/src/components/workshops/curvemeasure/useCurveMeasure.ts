// Curve measurements (intersection of two curves, level crossings, rise / fall
// time) — state hook. Reads curve A (and, for an intersection, curve B, from
// the same or another worksheet) through the shared analysis-view contract,
// runs the measurement on raw data (/api/curve-measure, calc.curve_measure) and
// holds the result under a key of every input, so a changed pick, setting or
// row withholds it instead of showing it stale. "Add as dataset" goes through
// the shared result lifecycle (one undo step, no duplicates, stale on change).

import { useEffect, useMemo, useState } from "react";

import { ROW_POLICY, type AnalysisInputs } from "../../../lib/analysisInputs";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { useLatestRef } from "../../../lib/previewKey";
import type { Dataset } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { afterCommit } from "../workbench/afterCommit";
import { useAnalysisInputs } from "../analysisselection/useAnalysisInputs";
import { useAnalysisCommit } from "../resultcommit/useAnalysisCommit";
import { seedChoice, seedNumber, useReopenSeed, useSeedHold } from "../resultcommit/useReopenSession";
import { useFollowColumnPicks } from "../useFollowColumnPicks";
import { pickColumns, pickLabel, pickUnit, useLoadColumns, validPick, type PickColumn } from "../analysisextras/columnPicks";
import { measureDigest, measureOutput, measureRows } from "./curveMeasureOutput";
import { DEFAULT_SETTINGS, runMeasure, type MeasureMode, type MeasureResult, type MeasureSettings } from "./curveMeasureRun";

export const CURVE_MEASURE_PRODUCER = { id: "curve-measure", label: "Curve measurements", version: 1 } as const;
const MODES: readonly MeasureMode[] = ["intersect", "level", "step"];
const DIRECTIONS = ["both", "rising", "falling"] as const;
const EDGES = ["auto", "rise", "fall"] as const;

export interface CurveMeasureState {
  hasData: boolean;
  inputs: AnalysisInputs;
  settings: MeasureSettings;
  set: <K extends keyof MeasureSettings>(key: K, value: MeasureSettings[K]) => void;
  columns: PickColumn[];
  xCol: number;
  yCol: number;
  setXCol: (i: number) => void;
  setYCol: (i: number) => void;
  /** Curve B (intersection only): its worksheet ("" = the active one) and columns. */
  bId: string;
  setBId: (id: string) => void;
  bDatasets: Dataset[];
  bColumns: PickColumn[];
  bX: number;
  bY: number;
  setBX: (i: number) => void;
  setBY: (i: number) => void;
  xUnit: string;
  yUnit: string;
  xLabel: string;
  yLabel: string;
  busy: boolean;
  error: string | null;
  result: MeasureResult | null;
  run: () => Promise<void>;
  add: () => void;
  addDisabledReason: string | null;
  replacing: string | null;
}

const defaultB = (cols: PickColumn[]): [number, number] => [-1, cols.some((c) => c.index === 1) ? 1 : 0];
const fingerprintOf = (d: Dataset | null | undefined): string => (d && !d.pending ? analysisDataFingerprint(d) : "pending");

export function useCurveMeasure(): CurveMeasureState {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const columns = useMemo(() => pickColumns(active), [active]);
  const load = useLoadColumns();

  // "Open in Curve measurements": start from the recorded choices; the reset
  // effect leaves them alone until the dataset changes.
  const seed = useReopenSeed(CURVE_MEASURE_PRODUCER.id, active?.id);
  const rec = seed?.settings;
  const text = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
  const holdSeed = useSeedHold(!!seed, [active?.id]);
  const [settings, setSettings] = useState<MeasureSettings>(() => ({
    mode: seedChoice(rec?.mode, MODES, DEFAULT_SETTINGS.mode),
    level: text(rec?.level, ""),
    hysteresis: text(rec?.hysteresis, ""),
    direction: seedChoice(rec?.direction, DIRECTIONS, "both"),
    lowPct: text(rec?.lowPct, DEFAULT_SETTINGS.lowPct),
    highPct: text(rec?.highPct, DEFAULT_SETTINGS.highPct),
    edge: seedChoice(rec?.edge, EDGES, "auto"),
    lowLevel: text(rec?.lowLevel, ""),
    highLevel: text(rec?.highLevel, ""),
  }));
  const [picks, setPicks] = useState<[number, number]>(() => (rec ? [seedNumber(rec.xCol, -1), seedNumber(rec.yCol, 0)] : [-1, 0]));
  // Curve B is a worksheet id only when it was a different worksheet (the second recorded source).
  const [bId, setBId] = useState<string>(() => (rec && rec.bOther === true ? (seed?.sourceIds[1] ?? "") : ""));
  const [bPicks, setBPicks] = useState<[number, number]>(() => (rec ? [seedNumber(rec.bX, -1), seedNumber(rec.bY, 0)] : [-1, 0]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<{ key: string; res: MeasureResult } | null>(null);

  const bData = bId === "" ? active : (datasets.find((d) => d.id === bId) ?? null);
  const bColumns = useMemo(() => pickColumns(bData), [bData]);
  const xCol = validPick(columns, picks[0], -1);
  const yCol = validPick(columns, picks[1], 0);
  const bX = validPick(bColumns, bPicks[0], -1);
  const bY = validPick(bColumns, bPicks[1], 0);
  const inputs = useAnalysisInputs({ xKey: xCol, yKeys: [yCol], policy: ROW_POLICY.analysisView });
  const fpA = useMemo(() => fingerprintOf(active), [active]);
  const fpB = useMemo(() => fingerprintOf(bData), [bData]);
  const s = settings;
  const intersect = s.mode === "intersect";
  const modeKey = s.mode === "intersect" ? [bData?.id ?? null, fpB, bX, bY]
    : s.mode === "level" ? [s.level, s.hysteresis, s.direction]
    : [s.lowPct, s.highPct, s.edge, s.lowLevel, s.highLevel];
  // Every input the result depends on (rows of both curves, picks, the mode's settings).
  const key = JSON.stringify([active?.id, fpA, s.mode, xCol, yCol, ...modeKey]);
  const liveKey = useLatestRef(key);
  const result = stored && stored.key === key ? stored.res : null;
  const hasData = !!active && columns.length >= 2;

  // A new dataset resets the picks.
  useEffect(() => {
    if (holdSeed()) return; // a reopen's recorded choices, not the defaults
    setPicks([-1, 0]);
    setBId("");
    setBPicks(defaultB(columns));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  // A removed second worksheet falls back to the active one.
  useEffect(() => {
    if (bId !== "" && !datasets.some((d) => d.id === bId)) setBId("");
  }, [bId, datasets]);
  useFollowColumnPicks(active, (follow) => setPicks((p) => [follow(p[0]) ?? -1, follow(p[1]) ?? 0]));

  async function run(): Promise<void> {
    if (!active) return;
    const clickKey = key;
    setBusy(true);
    setError(null);
    try {
      if (intersect && !bData) throw new Error("The second curve's worksheet is no longer available.");
      let launchKey = clickKey;
      if (active.pending || (intersect && bData?.pending)) {
        // A lazy book's arrival moves the fingerprint in the key: install it, let that commit land, re-read the key.
        await resolveDataset(active.id);
        if (intersect && bData && bData.id !== active.id) await resolveDataset(bData.id);
        await afterCommit();
        launchKey = liveKey.current;
      }
      const a = await load(active.id, [xCol, yCol]);
      const b = intersect && bData ? await load(bData.id, [bX, bY]) : null;
      const res = await runMeasure(settings, { x: a.columns[0]!, y: a.columns[1]! }, b && { x: b.columns[0]!, y: b.columns[1]! });
      setStored({ key: launchKey, res });
    } catch (e) {
      setStored(null);
      setError(e instanceof Error ? e.message : "measurement failed");
    } finally {
      setBusy(false);
    }
  }

  const labels = {
    xLabel: pickLabel(columns, xCol),
    xUnit: active ? pickUnit(active.data, xCol) : "",
    yLabel: pickLabel(columns, yCol),
    yUnit: active ? pickUnit(active.data, yCol) : "",
  };
  const other = intersect && bData && active && bData.id !== active.id ? bData : null;
  const commit = useAnalysisCommit(result && active ? {
    producer: CURVE_MEASURE_PRODUCER,
    sourceId: active.id,
    computedOn: fpA,
    alsoFrom: other ? [{ id: other.id, computedOn: fpB }] : undefined,
    xKey: xCol < 0 ? null : xCol, // -1 is the time axis (C9)
    settings: { ...s, xCol, yCol, bOther: !!other, bX: intersect ? bX : -1, bY: intersect ? bY : -1, ...measureDigest(result) },
    status: `added the ${s.mode === "intersect" ? "intersections" : s.mode === "level" ? "level crossings" : "step times"}`,
    output: (source) => {
      const out = measureOutput(result, labels);
      return { name: `${source.name} (${out.suffix})`, data: out.data };
    },
  } : null);

  return {
    hasData, inputs, settings, columns, xCol, yCol,
    set: (k, v) => setSettings((p) => ({ ...p, [k]: v })),
    setXCol: (i) => setPicks((p) => [i, p[1]]),
    setYCol: (i) => setPicks((p) => [p[0], i]),
    bId,
    setBId: (id) => {
      setBId(id);
      setBPicks(defaultB(pickColumns(id === "" ? active : (datasets.find((d) => d.id === id) ?? null))));
    },
    bDatasets: datasets, bColumns, bX, bY,
    setBX: (i) => setBPicks((p) => [i, p[1]]),
    setBY: (i) => setBPicks((p) => [p[0], i]),
    ...labels, busy, error, result, run,
    add: () => { if (!commit.disabledReason) commit.commit(); },
    addDisabledReason: result && measureRows(result) === 0 ? "There is nothing to add: no positions were found." : commit.disabledReason,
    replacing: commit.replacing,
  };
}
