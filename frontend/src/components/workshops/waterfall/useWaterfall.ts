// Waterfall workshop — state hook. Stacks one channel across the chosen datasets
// (defaults to the current multi-selection, else the whole library) and exports a
// consolidated CSV with or without the offset baked in. Pure math lives in
// lib/waterfall.ts; this hook just holds the controls + derives the traces.

import { useEffect, useMemo, useState } from "react";

import { saveBlob } from "../../../lib/download";
import {
  alignToUnionX,
  autoSpacing,
  buildWaterfall,
  commonChannels,
  extractSeries,
  waterfallToCSV,
  type OffsetMode,
  type WaterfallOptions,
} from "../../../lib/waterfall";
import { useApp } from "../../../store/useApp";

export interface WaterfallState {
  /** Every library dataset, with an `included` flag (the stacked set). */
  datasets: { id: string; name: string; included: boolean }[];
  channels: string[];
  channel: string;
  autoSpace: boolean;
  spacing: number; // resolved step actually used (auto or manual)
  manualSpacing: number;
  mode: OffsetMode;
  reverse: boolean;
  logY: boolean;
  /** Offset-applied, union-aligned data for rendering: x + one y column per trace. */
  aligned: { x: number[]; ys: (number | null)[][] };
  traceLabels: string[];
  count: number; // number of included datasets
  setIncluded: (id: string, on: boolean) => void;
  setChannel: (c: string) => void;
  setAutoSpace: (on: boolean) => void;
  setManualSpacing: (v: number) => void;
  setMode: (m: OffsetMode) => void;
  setReverse: (on: boolean) => void;
  setLogY: (on: boolean) => void;
  exportCSV: (baked: boolean) => Promise<void>;
}

export function useWaterfall(): WaterfallState {
  const datasets = useApp((s) => s.datasets);
  const selectedIds = useApp((s) => s.selectedIds);
  const setStatus = useApp((s) => s.setStatus);

  // Default the stacked set to the multi-selection (if ≥2), else the whole library.
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    if (selectedIds.length >= 2) {
      return new Set(datasets.filter((d) => !selectedIds.includes(d.id)).map((d) => d.id));
    }
    return new Set();
  });

  const included = datasets.filter((d) => !excluded.has(d.id));

  // The waterfall stack is a render path #38's original audit missed
  // (PlotStage/WindowCanvas/useMultiPanelStage/WorksheetPane were wired, this
  // wasn't) — trigger the fetch for every included-but-pending dataset so the
  // stack converges on full data instead of silently stacking previews.
  // ensureBookData is single-flight/idempotent, so re-checking on every
  // datasets/excluded change is harmless.
  useEffect(() => {
    for (const d of datasets) {
      if (!excluded.has(d.id) && d.pending) useApp.getState().ensureBookData(d.id);
    }
  }, [datasets, excluded]);

  const channels = useMemo(() => commonChannels(included.map((d) => d.data)), [included]);
  const [channel, setChannelRaw] = useState(channels[0] ?? "");
  const [autoSpace, setAutoSpace] = useState(true);
  const [manualSpacing, setManualSpacing] = useState(1);
  const [mode, setMode] = useState<OffsetMode>("add");
  const [reverse, setReverse] = useState(false);
  const [logY, setLogY] = useState(false);

  // Keep the channel valid as the included set changes.
  const activeChannel = channels.includes(channel) ? channel : (channels[0] ?? "");

  const series = useMemo(
    () =>
      activeChannel
        ? included.map((d) => extractSeries(d.data, d.id, d.name, activeChannel))
        : [],
    [included, activeChannel],
  );

  const resolvedSpacing = autoSpace ? autoSpacing(series.map((s) => s.range)) : manualSpacing;
  const opts: WaterfallOptions = { spacing: resolvedSpacing, mode, reverse };

  const traces = useMemo(() => buildWaterfall(series, opts), [series, resolvedSpacing, mode, reverse]);
  const aligned = useMemo(() => alignToUnionX(traces), [traces]);

  const setIncluded = (id: string, on: boolean) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportCSV = async (baked: boolean): Promise<void> => {
    if (series.length === 0) {
      setStatus("waterfall: no datasets to export");
      return;
    }
    // #38 deferred edge: the stacked set defaults to the WHOLE library —
    // resolve every included dataset's full data first (bounded concurrency)
    // rather than silently exporting previews for the never-activated ones.
    const resolved = await useApp.getState().resolveDatasets(included.map((d) => d.id));
    const resolvedSeries = activeChannel
      ? resolved.map((d) => extractSeries(d.data, d.id, d.name, activeChannel))
      : [];
    const csv = waterfallToCSV(resolvedSeries, opts, activeChannel, baked);
    const tag = baked ? "offset" : "raw";
    saveBlob(new Blob([csv], { type: "text/csv" }), `waterfall_${activeChannel}_${tag}.csv`);
    setStatus(`exported waterfall CSV (${baked ? "with" : "without"} offset) — ${resolvedSeries.length} datasets`);
  };

  return {
    datasets: datasets.map((d) => ({ id: d.id, name: d.name, included: !excluded.has(d.id) })),
    channels,
    channel: activeChannel,
    autoSpace,
    spacing: resolvedSpacing,
    manualSpacing,
    mode,
    reverse,
    logY,
    aligned,
    traceLabels: traces.map((t) => t.label),
    count: included.length,
    setIncluded,
    setChannel: setChannelRaw,
    setAutoSpace,
    setManualSpacing,
    setMode,
    setReverse,
    setLogY,
    exportCSV,
  };
}
