// Batch peak integration — state hook. Picks datasets and integration windows,
// runs /api/peaks/integrate-batch once over every picked dataset, and keeps the
// dataset x window table for the view, the CSV and the trend dataset
// (./batchIntegrate holds every rule; this file only sequences it).
//
// RUN. Each picked dataset is resolved (a lazy Origin book is fetched), read
// on the plotted channels by column name, and sent; one that cannot be read is
// an error row naming why, never a dead batch. The route is synchronous, so a
// run is one request; a newer run, or unmount, makes an older one write
// nothing (the `seq` pattern of usePeakBatch).
//
// OUT OF DATE (lane WB4). The run keeps its own sequenced request (it resolves
// several datasets before the one call, so it is not a useWorkbenchPreview
// run) and stamps the table with the key it was LAUNCHED with
// (workbench/useRunStamp): the picks, windows, baseline, alignment, the plot's X/Y
// selection (not the active dataset's labels: Add trend itself switches the active
// dataset) and each picked dataset's row / data identity. A table whose key has
// moved on is `stale`: it stays listed, marked, but cannot be exported to CSV or
// written to the library as the trend dataset until the next Integrate.
//
// Store access by selector only (architecture.test.ts's getState ratchet).

import type { InputX } from "../../../lib/resultInputsRecord";
import { useEffect, useMemo, useRef, useState } from "react";

import { csvBlob } from "../../../lib/csvCell";
import { saveBlob } from "../../../lib/download";
import { parseQuantity } from "../../../lib/metadataCleanup";
import { keysAcross, metaValue, pathFromId, type MetaKeyInfo } from "../../../lib/metadataKeys";
import { integratePeaksBatch, type IntegrateBatchResponse } from "../../../lib/api/peaks";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { datasetInputsToken } from "../workbench/inputsKey";
import { afterCommit } from "../workbench/afterCommit";
import { Refusal, type Failure, failureOf } from "../workbench/refusal";
import { useRunStamp } from "../workbench/useRunStamp";
import { commitBatchTable } from "../../../store/commitBatchTable";
import { useReopenSeed } from "../resultcommit/useReopenSession";
import { useReplaceLayoutBlock } from "../resultcommit/useReplaceLayoutBlock";
import {
  batchBody,
  batchIntegrateCsv,
  batchIntegrateRows,
  integrateChannels,
  sameGrid,
  seriesFor,
  seriesXKey,
  trendStruct,
  windowsFromPeaks,
  windowsProblem,
  type BatchIntegrateRow,
  type IntegrateChannels,
  type IntegrateWindow,
  type SourceOutcome,
} from "./batchIntegrate";

const BATCH_INTEGRATE_PRODUCER = { id: "peak-batch-integrate", label: "Batch integrate", version: 1 } as const;

export type BatchBaseline = "linear" | "none" | "tangent";
/** A recorded or chosen baseline value, falling back to the default linear one. */
export const asBaseline = (v: unknown): BatchBaseline => (v === "none" || v === "tangent" ? v : "linear");

export type BatchIntegratePhase = "idle" | "running" | "done" | "failed";

interface BatchRun {
  rows: BatchIntegrateRow[];
  outcomes: SourceOutcome[];
  windows: IntegrateWindow[];
  channels: IntegrateChannels;
  baseline: BatchBaseline;
  aligned: boolean;
  metaOf: Map<string, Record<string, unknown>>;
  /** Each read dataset's analysis-view fingerprint at run time (the commit's staleness basis). */
  fps: Map<string, string>;
  /** The X column each read dataset was integrated against (resolved by name; null = time axis). */
  xKeys: Record<string, InputX>;
  ranAt: string;
}

/** Recorded integration windows, or null when the record is not a usable list. */
function recordedWindows(value: unknown): IntegrateWindow[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: IntegrateWindow[] = [];
  for (const w of value) {
    if (!w || typeof w !== "object" || typeof w.lo !== "number" || typeof w.hi !== "number") return null;
    out.push({ lo: w.lo, hi: w.hi });
  }
  return out;
}

export function useBatchIntegrate(seedPeaks: readonly { center: number; fwhm: number }[]) {
  const active = useActiveDataset();
  // Opened from a committed trend (lane RO2): every recorded source is picked,
  // with the recorded windows, baseline, alignment and trend X.
  const seed = useReopenSeed(BATCH_INTEGRATE_PRODUCER.id, active?.id);
  const datasets = useApp((s) => s.datasets);
  const selectedIds = useApp((s) => s.selectedIds);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const roi = useApp((s) => s.qfitRoi);
  const resolveDataset = useApp((s) => s.resolveDataset);

  const [pickedRaw, setPicked] = useState<string[]>(() =>
    seed ? [...seed.sourceIds]
      : selectedIds.length > 1 ? [...selectedIds] : active ? [active.id] : []);
  const picked = useMemo(() => pickedRaw.filter((id) => datasets.some((d) => d.id === id)), [pickedRaw, datasets]);
  const [windows, setWindowsRaw] = useState<IntegrateWindow[]>(() => recordedWindows(seed?.settings["windows"]) ?? windowsFromPeaks(seedPeaks));
  // Recorded windows that cannot be restored are NOT replaced by the current
  // peaks' without saying so: the commit adds a new output until they are set.
  const [seedProblem, setSeedProblem] = useState<string | null>(() => (seed && recordedWindows(seed.settings["windows"]) === null
    ? "The recorded integration windows could not be restored, so the windows come from the current peaks. Set them; until then a commit adds a new output." : null));
  const setWindows = (next: IntegrateWindow[]) => { setSeedProblem(null); setWindowsRaw(next); };
  const [baseline, setBaseline] = useState<BatchBaseline>(() => asBaseline(seed?.settings["baseline"]));
  const [align, setAlign] = useState(() => seed?.settings["aligned"] === true);
  const [phase, setPhase] = useState<BatchIntegratePhase>("idle");
  // The failure carries its kind (a typed `Refusal`), not a text to compare.
  const [failure, setFailure] = useState<Failure | null>(null);
  const error = failure?.message ?? null;
  const [run, setRun] = useState<BatchRun | null>(null);
  const [xField, setXField] = useState(() => (typeof seed?.settings["xField"] === "string" ? seed.settings["xField"] : ""));
  const seq = useRef(0);
  useEffect(() => () => void seq.current++, []);

  const channels = useMemo(() => integrateChannels(active, xKey, yKeys, seriesOrder), [active, xKey, yKeys, seriesOrder]);
  const busy = phase === "running";
  const block = busy
    ? null
    : !channels
      ? "select a dataset with a plotted Y column: the batch integrates that column, by name, in every dataset"
      : picked.length === 0 ? "pick at least one dataset" : windowsProblem(windows);

  const stamp = useRunStamp(JSON.stringify([
    picked, windows, baseline, align, xKey, yKeys, seriesOrder,
    picked.map((id) => datasetInputsToken(datasets.find((d) => d.id === id))),
  ]));
  const stale = run !== null && stamp.stale;

  // Numeric metadata fields the integrated datasets carry, for the trend's x.
  const fields: MetaKeyInfo[] = useMemo(() => {
    if (!run) return [];
    const ok = run.outcomes.filter((o) => o.ok).map((o) => ({ id: o.datasetId, data: { metadata: run.metaOf.get(o.datasetId) ?? {} } }));
    const numeric = (id: string, path: string[]) => {
      const v = metaValue(run.metaOf.get(id), path);
      return v !== undefined && !("error" in parseQuantity(v));
    };
    return keysAcross(ok).filter((f) => f.ids.some((id) => numeric(id, f.path)));
  }, [run]);

  const start = async () => {
    if (block || busy || !channels) return;
    const id = ++seq.current;
    const live = () => seq.current === id;
    const ws = windows.map((w) => ({ ...w }));
    setPhase("running");
    setFailure(null);
    const outcomes: SourceOutcome[] = [];
    const series: { name: string; x: number[]; y: number[] }[] = [];
    const metaOf = new Map<string, Record<string, unknown>>();
    const fps = new Map<string, string>();
    const xKeys: Record<string, InputX> = {};
    const hadPending = picked.some((dsId) => datasets.find((d) => d.id === dsId)?.pending);
    for (const dsId of picked) {
      const name = datasets.find((d) => d.id === dsId)?.name ?? dsId;
      try {
        const ds = await resolveDataset(dsId);
        if (!ds) throw new Error("the dataset is no longer available");
        const s = seriesFor(ds, channels);
        metaOf.set(dsId, ds.data.metadata ?? {});
        fps.set(dsId, analysisDataFingerprint(ds));
        xKeys[dsId] = seriesXKey(ds, channels);
        series.push({ name, x: s.x, y: s.y });
        outcomes.push({ datasetId: dsId, name, ok: true });
      } catch (e) {
        outcomes.push({ datasetId: dsId, name, ok: false, error: e instanceof Error ? e.message : "could not read the dataset" });
      }
      if (!live()) return;
    }
    // A lazy book that just arrived moved the key: let that commit land first,
    // then take the key this run is asked with (not what it ends up under).
    if (hadPending) await afterCommit();
    if (!live()) return;
    const launchKey = stamp.launchKey();
    let res: IntegrateBatchResponse | null = null;
    try {
      if (align && series.length > 1 && !sameGrid(series.map((s) => s.x))) {
        throw new Refusal("alignment needs every dataset on the same x grid; these differ — turn Align off");
      }
      if (series.length > 0) res = await integratePeaksBatch(batchBody(series, ws, { baseline, align }));
    } catch (e) {
      if (!live()) return;
      setFailure(failureOf(e, "the batch failed"));
      setPhase("failed");
      return;
    }
    if (!live()) return;
    stamp.record(launchKey);
    setRun({
      rows: batchIntegrateRows(outcomes, res, ws), outcomes, windows: ws, channels, baseline,
      aligned: res?.aligned ?? false, metaOf, fps, xKeys, ranAt: new Date().toISOString(),
    });
    setPhase("done");
  };

  const exportCsv = () => {
    if (run && !stale) saveBlob(csvBlob(batchIntegrateCsv(run.rows)), "peak-batch-integrate.csv");
  };

  const buildTrend = (r: BatchRun) => trendStruct(r.rows, r.windows, r.outcomes, r.metaOf, xField ? pathFromId(xField) : null, {
    baseline: r.baseline, aligned: r.aligned, ranAt: r.ranAt, channels: { x: r.channels.xLabel, y: r.channels.yLabel },
  });
  // Replace's column check (lane RPL) runs before the button, on the table it would write.
  const primaryId = run?.outcomes.find((o) => o.ok && run.fps.has(o.datasetId))?.datasetId;
  const trendLabels = useMemo(
    () => (run && !stale ? buildTrend(run).data.labels : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, stale, xField],
  );
  useReplaceLayoutBlock(BATCH_INTEGRATE_PRODUCER.id, primaryId, trendLabels, seedProblem);

  /** Land the trend in the library (or replace the reopened one); returns its id and whatever was skipped. */
  const addTrend = (): { id: string; skipped: string[]; replaced: boolean } | null => {
    if (!run || stale) return null;
    const field = xField ? pathFromId(xField) : null;
    const { data, skipped } = buildTrend(run);
    if (data.time.length === 0) return { id: "", skipped, replaced: false };
    const vs = field ? ` vs ${String(data.metadata.x_column_name)}` : "";
    // One undo step, no duplicate on a repeat click, stale when ANY integrated
    // dataset changes (store/analysisOutputCommit.ts).
    const outcome = commitBatchTable({
      producer: BATCH_INTEGRATE_PRODUCER,
      sources: run.outcomes.filter((o) => o.ok && run.fps.has(o.datasetId)).map((o) => ({ id: o.datasetId, computedOn: run.fps.get(o.datasetId)! })),
      settings: { windows: run.windows, baseline: run.baseline, aligned: run.aligned, xField, y: run.channels.yLabel },
      reopenExtra: { channels: run.channels },
      xKey: run.xKeys,
      name: `Integrated ${run.channels.yLabel}${vs} (${data.time.length} datasets)`,
      data,
    });
    // A repeat Add (or a refusal) already said so in the status line.
    return outcome.kind === "created" || outcome.kind === "replaced" ? { id: outcome.outputId, skipped, replaced: outcome.kind === "replaced" } : null;
  };

  return {
    datasets, selectedIds, picked, setPicked,
    togglePicked: (dsId: string) => setPicked((p) => (p.includes(dsId) ? p.filter((x) => x !== dsId) : [...p, dsId])),
    seedProblem, windows, setWindows, seedWindows: windowsFromPeaks(seedPeaks), roi,
    baseline, setBaseline, align, setAlign,
    channels, block, busy, phase, error, refusal: failure?.refusal === true, stale,
    rows: run?.rows ?? null, fields, xField, setXField,
    start, exportCsv, addTrend,
  };
}

export type BatchIntegrateState = ReturnType<typeof useBatchIntegrate>;
