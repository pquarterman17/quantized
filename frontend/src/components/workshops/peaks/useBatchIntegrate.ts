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
// Store access by selector only (architecture.test.ts's getState ratchet).

import { useEffect, useMemo, useRef, useState } from "react";

import { csvBlob } from "../../../lib/csvCell";
import { saveBlob } from "../../../lib/download";
import { parseQuantity } from "../../../lib/metadataCleanup";
import { keysAcross, metaValue, pathFromId, type MetaKeyInfo } from "../../../lib/metadataKeys";
import { integratePeaksBatch, type IntegrateBatchResponse } from "../../../lib/api/peaks";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import {
  batchBody,
  batchIntegrateCsv,
  batchIntegrateRows,
  integrateChannels,
  sameGrid,
  seriesFor,
  trendStruct,
  windowsFromPeaks,
  windowsProblem,
  type BatchIntegrateRow,
  type IntegrateChannels,
  type IntegrateWindow,
  type SourceOutcome,
} from "./batchIntegrate";

export type BatchIntegratePhase = "idle" | "running" | "done" | "failed";

interface BatchRun {
  rows: BatchIntegrateRow[];
  outcomes: SourceOutcome[];
  windows: IntegrateWindow[];
  channels: IntegrateChannels;
  baseline: "linear" | "none";
  aligned: boolean;
  metaOf: Map<string, Record<string, unknown>>;
  ranAt: string;
}

export function useBatchIntegrate(seedPeaks: readonly { center: number; fwhm: number }[]) {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const selectedIds = useApp((s) => s.selectedIds);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const roi = useApp((s) => s.qfitRoi);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const addDataset = useApp((s) => s.addDataset);

  const [pickedRaw, setPicked] = useState<string[]>(() =>
    selectedIds.length > 1 ? [...selectedIds] : active ? [active.id] : []);
  const picked = useMemo(() => pickedRaw.filter((id) => datasets.some((d) => d.id === id)), [pickedRaw, datasets]);
  const [windows, setWindows] = useState<IntegrateWindow[]>(() => windowsFromPeaks(seedPeaks));
  const [baseline, setBaseline] = useState<"linear" | "none">("linear");
  const [align, setAlign] = useState(false);
  const [phase, setPhase] = useState<BatchIntegratePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<BatchRun | null>(null);
  const [xField, setXField] = useState("");
  const seq = useRef(0);
  useEffect(() => () => void seq.current++, []);

  const channels = useMemo(() => integrateChannels(active, xKey, yKeys, seriesOrder), [active, xKey, yKeys, seriesOrder]);
  const busy = phase === "running";
  const block = busy
    ? null
    : !channels
      ? "select a dataset with a plotted Y column: the batch integrates that column, by name, in every dataset"
      : picked.length === 0 ? "pick at least one dataset" : windowsProblem(windows);

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
    setError(null);
    const outcomes: SourceOutcome[] = [];
    const series: { name: string; x: number[]; y: number[] }[] = [];
    const metaOf = new Map<string, Record<string, unknown>>();
    for (const dsId of picked) {
      const name = datasets.find((d) => d.id === dsId)?.name ?? dsId;
      try {
        const ds = await resolveDataset(dsId);
        if (!ds) throw new Error("the dataset is no longer available");
        const s = seriesFor(ds, channels);
        metaOf.set(dsId, ds.data.metadata ?? {});
        series.push({ name, x: s.x, y: s.y });
        outcomes.push({ datasetId: dsId, name, ok: true });
      } catch (e) {
        outcomes.push({ datasetId: dsId, name, ok: false, error: e instanceof Error ? e.message : "could not read the dataset" });
      }
      if (!live()) return;
    }
    let res: IntegrateBatchResponse | null = null;
    try {
      if (align && series.length > 1 && !sameGrid(series.map((s) => s.x))) {
        throw new Error("alignment needs every dataset on the same x grid; these differ — turn Align off");
      }
      if (series.length > 0) res = await integratePeaksBatch(batchBody(series, ws, { baseline, align }));
    } catch (e) {
      if (!live()) return;
      setError(e instanceof Error ? e.message : "the batch failed");
      setPhase("failed");
      return;
    }
    if (!live()) return;
    setRun({
      rows: batchIntegrateRows(outcomes, res, ws), outcomes, windows: ws, channels, baseline,
      aligned: res?.aligned ?? false, metaOf, ranAt: new Date().toISOString(),
    });
    setPhase("done");
  };

  const exportCsv = () => {
    if (run) saveBlob(csvBlob(batchIntegrateCsv(run.rows)), "peak-batch-integrate.csv");
  };

  /** Land the trend in the library; returns its id and whatever was skipped. */
  const addTrend = (): { id: string; skipped: string[] } | null => {
    if (!run) return null;
    const field = xField ? pathFromId(xField) : null;
    const { data, skipped } = trendStruct(run.rows, run.windows, run.outcomes, run.metaOf, field, {
      baseline: run.baseline, aligned: run.aligned, ranAt: run.ranAt,
      channels: { x: run.channels.xLabel, y: run.channels.yLabel },
    });
    if (data.time.length === 0) return { id: "", skipped };
    const id = nextDatasetId();
    const vs = field ? ` vs ${String(data.metadata.x_column_name)}` : "";
    addDataset({ id, name: `Integrated ${run.channels.yLabel}${vs} (${data.time.length} datasets)`, data });
    return { id, skipped };
  };

  return {
    datasets, selectedIds, picked, setPicked,
    togglePicked: (dsId: string) => setPicked((p) => (p.includes(dsId) ? p.filter((x) => x !== dsId) : [...p, dsId])),
    windows, setWindows, seedWindows: windowsFromPeaks(seedPeaks), roi,
    baseline, setBaseline, align, setAlign,
    channels, block, busy, phase, error,
    rows: run?.rows ?? null, fields, xField, setXField,
    start, exportCsv, addTrend,
  };
}

export type BatchIntegrateState = ReturnType<typeof useBatchIntegrate>;
