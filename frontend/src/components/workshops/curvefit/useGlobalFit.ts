// Curve Fit — Global fit state hook (the lazy "Global fit" mode). Picks the
// series (globalFitData: channels of the active dataset, or datasets matched by
// column label), holds the parameter table with a per-parameter "shared" flag,
// and runs POST /api/fitting/global/job (calc.global_curve_fit, MATLAB
// fitting.globalCurveFit) on the poll-model job runner with Cancel in the
// StatusBar. Each member's fitted curve goes to the store's ordinary fit
// overlay whenever that member's dataset is the one on the plot, so every
// dataset shows its own curve on its own plot.
//
// Fits run unweighted over the analysis rows (exclusions/filters applied, gap
// rows dropped). An untouched start column is not sent: the route auto-guesses
// per dataset, which suits per-dataset amplitudes far better than one shared
// start. Bounds are always sent — the table shows what the fit will use.
//
// Out of date (lane WB4): a global fit stays a button on the poll-model job, so
// it keeps its own run and stamps the result with the key it was LAUNCHED with
// (workbench/useRunStamp): source, picks, shared ticks, start / bound table,
// model, X channel and the picked datasets' row / data identity. A result whose
// key has moved on is `stale`: still listed, marked, but not drawn on the plot,
// not reported, not exported and its "Show" is off, until a refit.
//
// Durable save: "→ Report" lands a per-dataset table in the Library (the
// report path every workshop uses). Nothing is written to `Dataset.fitSpec`:
// the recalc graph refits a spec on its own, which would silently replace a
// shared-parameter result with an independent fit.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  compareDatasetsJob,
  globalFitJob,
  type DatasetCompareResult,
  type GlobalFitRequest,
  type GlobalFitResult,
} from "../../../lib/api/globalFit";
import { reportEmit } from "../../../lib/api/report";
import { boundsForWire, parseFitParams, rowsFromModel, type FitParamRow } from "../../../lib/fitParams";
import { fmtNum } from "../../../lib/format";
import { cancelJob, JobCancelledError, pollJob } from "../../../lib/jobs";
import { effectiveChannels } from "../../../lib/plotdata";
import { selectedFitData } from "../../../lib/fitselection";
import { analysisData } from "../../../lib/rowstate";
import type { FitModel, FitOverlay } from "../../../lib/types";
import { addReportWithProvenance } from "../../../store/addReportWithProvenance";
import { trackJob } from "../../../store/pendingOpActions";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { datasetInputsToken } from "../workbench/inputsKey";
import { Refusal } from "../workbench/refusal";
import { useRunStamp } from "../workbench/useRunStamp";
import {
  channelMembers,
  datasetMembers,
  memberData,
  memberKey,
  memberOverlay,
  reportRecords,
  shareConstraints,
  type GlobalMember,
  type GlobalSource,
} from "./globalFitData";

/** The model to fit: a registry model, or a saved equation (`equation` set). */
export type GlobalModel = Pick<FitModel, "name" | "paramNames" | "p0" | "lb" | "ub"> & { equation?: string };

export interface GlobalFitRun {
  fit: GlobalFitResult;
  members: GlobalMember[];
  /** Each member's fitted curve, bound to the Y/X it was fitted on. */
  overlays: FitOverlay[];
}

export interface GlobalFitState {
  source: GlobalSource;
  setSource: (s: GlobalSource) => void;
  candidates: GlobalMember[];
  /** Datasets without the plotted X/Y columns (datasets source only). */
  missing: string[];
  picked: string[];
  togglePick: (key: string) => void;
  rows: FitParamRow[];
  setRow: (i: number, patch: Partial<FitParamRow>) => void;
  shared: boolean[];
  setShared: (i: number, v: boolean) => void;
  busy: boolean;
  /** The running job's last message ("Nelder-Mead iteration n"); null when idle. */
  progress: string | null;
  /** The job's reported fraction (0..1); null until it reports one. */
  progressFraction: number | null;
  error: string | null;
  /** `error` is a refusal (the picks, table or data cannot be fitted), not a failed job. */
  refusal: boolean;
  run: (mode?: "fit" | "compare") => Promise<void>;
  /** The last dataset comparison (Origin "Compare Datasets"); null until run. */
  comparison: DatasetCompareResult | null;
  cancel: () => Promise<void>;
  result: GlobalFitRun | null;
  /** `result` was fitted under picks, ticks, table, model or data that have since changed. */
  stale: boolean;
  /** Member whose curve is on the plot (null: none of them is plotted). */
  shownIndex: number | null;
  show: (i: number) => void;
  reporting: boolean;
  toReport: () => Promise<void>;
}

/** Clear the plot's fit overlay only if it is still `own` (atomic compare-and-clear). */
function takeBackOverlay(own: FitOverlay | null): void {
  if (own) useApp.setState((st) => (st.fitOverlay === own ? { fitOverlay: null } : {}));
}

export function useGlobalFit(model: GlobalModel | null): GlobalFitState {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const selectedIds = useApp((s) => s.selectedIds);
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const setActive = useApp((s) => s.setActive);
  const [source, setSourceState] = useState<GlobalSource>("channels");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [rows, setRows] = useState<FitParamRow[]>(() => rowsFromModel(model as FitModel | undefined));
  const [shared, setSharedFlags] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [progressFraction, setProgressFraction] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refusalText, setRefusalText] = useState<string | null>(null);
  const [result, setResult] = useState<GlobalFitRun | null>(null);
  const [comparison, setComparison] = useState<DatasetCompareResult | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const [reporting, setReporting] = useState(false);
  const jobRef = useRef<string | null>(null);
  const ownOverlay = useRef<FitOverlay | null>(null);

  // A new model re-seeds the table, forgets the flags (names changed) and
  // drops the previous model's result and curve.
  const modelKey = model ? `${model.name}|${model.equation ?? ""}` : "";
  useEffect(() => {
    setRows(rowsFromModel(model as FitModel | undefined));
    setSharedFlags([]);
    setResult(null);
    setComparison(null);
    takeBackOverlay(ownOverlay.current);
  }, [modelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const primaryY = useMemo(() => selectedFitData(active, xKey, yKeys, seriesOrder)?.yKey ?? null, [active, xKey, yKeys, seriesOrder]);
  const { candidates, missing } = useMemo(() => {
    if (!active) return { candidates: [], missing: [] };
    if (source === "channels") return { candidates: channelMembers(active, xKey), missing: [] };
    if (primaryY == null) return { candidates: [], missing: [] };
    const r = datasetMembers(datasets, active, xKey, primaryY);
    return { candidates: r.members, missing: r.missing };
  }, [active, datasets, source, xKey, primaryY]);

  // Default pick: the plotted channels, or the Library selection.
  const defaultPick = useMemo(() => {
    if (!active) return [];
    if (source === "channels") {
      const data = analysisData(active);
      const plotted = data ? effectiveChannels(data, yKeys, xKey, active.channelRoles, seriesOrder) : [];
      return candidates.filter((m) => plotted.includes(m.yKey)).map(memberKey);
    }
    return candidates.filter((m) => selectedIds.includes(m.datasetId)).map(memberKey);
  }, [active, candidates, source, xKey, yKeys, seriesOrder, selectedIds]);
  const pickedKeys = picked ?? defaultPick;

  // A verdict describes the picks, ticks and start/bound table it was run with:
  // changing any of them (or the source) drops it rather than leaving it up; a
  // fit result is marked out of date by the same key. Beyond the form it depends on the model, the X channel and the
  // picked datasets' row / data identity (an edit to a member's rows or data).
  const pickedIds = [...new Set(pickedKeys.map((k) => k.split(":")[0]!))];
  const dataKey = pickedIds.map((id) => datasetInputsToken(datasets.find((d) => d.id === id))).join("|");
  // The ticks normalized to the model's parameters (an untouched [] is all-off),
  // and the X channel only where it defines the members: with datasets, "Show"
  // activates another dataset, which must not count as an edit.
  const ticks = model ? model.paramNames.map((_, j) => (shared[j] ? 1 : 0)).join("") : "";
  const freshKey = `${source}|${pickedKeys.join(",")}|${ticks}|${JSON.stringify(rows)}|${modelKey}|${source === "channels" ? xKey : ""}|${dataKey}`;
  const stamp = useRunStamp(freshKey);
  const stale = result !== null && stamp.stale;
  useEffect(() => setComparison(null), [freshKey]);

  // The member on the plot: the chosen one while its dataset is active, else
  // the active dataset's first member.
  const activeId = active?.id ?? null;
  const shownIndex = useMemo(() => {
    if (!result) return null;
    if (shown != null && result.members[shown]?.datasetId === activeId) return shown;
    const i = result.members.findIndex((m) => m.datasetId === activeId);
    return i < 0 ? null : i;
  }, [result, shown, activeId]);

  useEffect(() => {
    // An out-of-date fit's curve is not drawn (and one already drawn is taken back).
    if (stale) takeBackOverlay(ownOverlay.current);
    if (!result || stale || shownIndex == null) return;
    const ov = result.overlays[shownIndex]!;
    ownOverlay.current = ov;
    setFitOverlay(ov);
  }, [result, stale, shownIndex, setFitOverlay]);

  // On unmount, take back only OUR overlay.
  useEffect(() => () => takeBackOverlay(ownOverlay.current), []);

  async function run(mode: "fit" | "compare" = "fit"): Promise<void> {
    if (!model || busy) return;
    setError(null);
    setRefusalText(null);
    const refuse = (message: string) => {
      setError(message);
      setRefusalText(message);
    };
    const members = candidates.filter((m) => pickedKeys.includes(memberKey(m)));
    // Freeze the pick: "Show" activates a dataset, which collapses the Library
    // selection a default pick would otherwise follow.
    setPicked(pickedKeys);
    if (members.length < 2) {
      refuse("Pick at least two series to fit together.");
      return;
    }
    const parsed = parseFitParams(rows, model as FitModel);
    if (parsed.error) {
      refuse(parsed.error);
      return;
    }
    const launchKey = stamp.launchKey(); // what this run was asked with, not what it ends under
    setBusy(true);
    setProgress("queued");
    setProgressFraction(null);
    const op = trackJob(mode === "compare" ? "Compare datasets" : "Global fit");
    try {
      const data = [];
      for (const m of members) {
        const ds = await resolveDataset(m.datasetId);
        const d = ds ? memberData(ds, m) : null;
        if (!ds || !d || d.x.length === 0) throw new Refusal(`${m.label} has no finite X/Y pairs to fit`);
        data.push({ ds, d });
      }
      const base = rowsFromModel(model as FitModel);
      const startsEdited = rows.some((r, i) => r.start !== base[i]?.start);
      const req: GlobalFitRequest = {
        ...(model.equation ? { equation: model.equation } : { model: model.name }),
        datasets: data.map(({ d }) => ({ x: d.x, y: d.y })),
        // Compare tests the ticked parameters; none ticked tests them all.
        constraints: shareConstraints(
          model.paramNames,
          mode === "compare" && !shared.some(Boolean) ? model.paramNames.map(() => true) : shared,
          members.length,
        ),
        ...(startsEdited ? { p0: parsed.p0 } : {}),
        lower: boundsForWire(parsed.lower),
        upper: boundsForWire(parsed.upper),
      };
      const { job_id } = await (mode === "compare" ? compareDatasetsJob(req) : globalFitJob(req));
      jobRef.current = job_id;
      op.cancellable(() => void cancel());
      const onProgress = (f: number, msg?: string) => {
        setProgress(msg || null);
        setProgressFraction(f);
        op.progress(f, msg);
      };
      if (mode === "compare") {
        setComparison(await pollJob<DatasetCompareResult>(job_id, onProgress));
        return;
      }
      const fit = await pollJob<GlobalFitResult>(job_id, onProgress);
      const overlays = data.map(({ ds, d }, i): FitOverlay => ({
        datasetId: ds.id,
        binding: { yKey: members[i]!.yKey, xKey: d.xKey },
        y: memberOverlay(ds, d.pairs, fit.yFit[i] ?? []),
        curveFit: true,
      }));
      setShown(null);
      stamp.record(launchKey);
      setResult({ fit, members, overlays });
    } catch (e) {
      if (mode === "compare") setComparison(null);
      if (e instanceof Refusal) setRefusalText(e.message);
      if (!(e instanceof JobCancelledError)) setError(e instanceof Error ? e.message : "global fit failed");
    } finally {
      op.end();
      jobRef.current = null;
      setBusy(false);
      setProgress(null);
      setProgressFraction(null);
    }
  }

  async function cancel(): Promise<void> {
    const id = jobRef.current;
    if (!id) return;
    try {
      await cancelJob(id);
    } catch {
      /* already terminal — the poll loop settles it */
    }
  }

  function show(i: number): void {
    const m = result?.members[i];
    if (!m || stale) return;
    setShown(i);
    if (m.datasetId !== activeId) setActive(m.datasetId);
  }

  async function toReport(): Promise<void> {
    if (!result || !model || stale) return;
    setReporting(true);
    try {
      const { fit, members } = result;
      const sharedNames = fit.shared.map((g) => fit.paramNames[g.paramIdx] ?? g.name);
      const refs = [...new Set(members.map((m) => m.datasetId))].map((id) => ({
        kind: "dataset",
        id,
        name: datasets.find((d) => d.id === id)?.name ?? id,
      }));
      const title = `Global ${model.name} fit`;
      const { report } = await reportEmit({
        kind: "stats_table",
        records: reportRecords(fit, members),
        title,
        caption: `${members.length} series; shared: ${sharedNames.join(", ") || "none"}; reduced χ² = ${fmtNum(fit.chiSqRed)}`,
        source_refs: refs,
      });
      addReportWithProvenance(title, report, activeId);
    } catch (e) {
      setError(`could not add to report — ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setReporting(false);
    }
  }

  return {
    source,
    setSource: (s) => {
      setSourceState(s);
      setPicked(null);
    },
    candidates,
    missing,
    picked: pickedKeys,
    togglePick: (key) =>
      setPicked(pickedKeys.includes(key) ? pickedKeys.filter((k) => k !== key) : [...pickedKeys, key]),
    rows,
    setRow: (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))),
    shared,
    setShared: (i, v) =>
      setSharedFlags((s) => {
        const next = model ? model.paramNames.map((_, j) => s[j] ?? false) : [...s];
        next[i] = v;
        return next;
      }),
    busy,
    progress,
    progressFraction,
    error,
    refusal: error !== null && error === refusalText,
    run,
    comparison,
    cancel,
    result,
    stale,
    shownIndex,
    show,
    reporting,
    toReport,
  };
}
