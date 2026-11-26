// Align to peak: state hook. Picks datasets, a reference-peak window and a
// target, measures every peak in one /api/peaks/align call, and commits the
// shifted copies as derived datasets (./alignPeaks holds every rule).
//
// Each picked dataset is resolved and read on the plotted channels BY COLUMN
// NAME (the batch-integrate convention, ./batchIntegrate's seriesFor); one
// that cannot be read is an error row, never a dead run. The run is stamped
// with the key it launched with (workbench/useRunStamp): a table whose inputs
// moved on is `stale` and cannot be committed until measured again.
// Store access by selector only (architecture.test.ts's getState ratchet).

import { useEffect, useMemo, useRef, useState } from "react";

import { useLatestRef } from "../../../lib/previewKey";
import { alignPeaks, type AlignPeaksResponse } from "../../../lib/api/peaks";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { InputX } from "../../../lib/resultInputsRecord";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { useReopenSeed } from "../resultcommit/useReopenSession";
import { useReplaceLayoutBlock } from "../resultcommit/useReplaceLayoutBlock";
import { afterCommit } from "../workbench/afterCommit";
import { datasetInputsToken } from "../workbench/inputsKey";
import { failureOf, type Failure } from "../workbench/refusal";
import { useRunStamp } from "../workbench/useRunStamp";
import { ALIGN_PRODUCER, alignedName, alignSeed, commitAlignBatch, shiftXData, type AlignItem, type AlignProvenance } from "./alignPeaks";
import { integrateChannels, seriesFor, seriesXKey, windowsFromPeaks } from "./batchIntegrate";

export interface AlignRow {
  datasetId: string;
  name: string;
  ok: boolean;
  position: number | null;
  shift: number | null;
  error: string | null;
}

interface AlignRun {
  rows: AlignRow[];
  items: AlignItem[];
  target: number;
}

interface Measured {
  datasetId: string;
  name: string;
  x: number[];
  y: number[];
  fp: string;
  xk: InputX;
}

export function useAlignPeaks(seedPeaks: readonly { center: number; fwhm: number }[]) {
  const active = useActiveDataset();
  // Opened from an aligned output ("Open in Align to peak"): its source, peak
  // window and target position come back (see alignSeed).
  const reopened = useReopenSeed(ALIGN_PRODUCER.id, active?.id);
  const seed = useMemo(() => (reopened ? alignSeed(reopened.settings) : null), [reopened]);
  const datasets = useApp((s) => s.datasets);
  const selectedIds = useApp((s) => s.selectedIds);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const roi = useApp((s) => s.qfitRoi);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const setStatus = useApp((s) => s.setStatus);

  const [pickedRaw, setPicked] = useState<string[]>(() =>
    reopened ? [...reopened.sourceIds] : selectedIds.length > 1 ? [...selectedIds] : active ? [active.id] : []);
  const picked = useMemo(() => pickedRaw.filter((id) => datasets.some((d) => d.id === id)), [pickedRaw, datasets]);
  const seedWindow = windowsFromPeaks(seedPeaks)[0] ?? (roi ? { lo: roi[0], hi: roi[1] } : null);
  const [lo, setLoRaw] = useState(seed?.window[0] ?? seedWindow?.lo ?? Number.NaN);
  const [hi, setHiRaw] = useState(seed?.window[1] ?? seedWindow?.hi ?? Number.NaN);
  const [targetMode, setTargetModeRaw] = useState<"first" | "typed">(seed ? "typed" : "first");
  const [typed, setTypedRaw] = useState(seed?.target ?? Number.NaN);
  // A record that does not read back is not guessed at: the commit adds a new output until it is set.
  const [seedProblem, setSeedProblem] = useState<string | null>(() => (reopened && !seed
    ? "The recorded peak window and target could not be restored. Set them; until then a commit adds a new output." : null));
  const edited = <T,>(set: (v: T) => void) => (v: T) => { setSeedProblem(null); set(v); };
  const setLo = edited(setLoRaw);
  const setHi = edited(setHiRaw);
  const setTargetMode = edited(setTargetModeRaw);
  const setTyped = edited(setTypedRaw);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [run, setRun] = useState<AlignRun | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const datasetsRef = useLatestRef(datasets);
  const seq = useRef(0);
  useEffect(() => () => void seq.current++, []);

  const channels = useMemo(() => integrateChannels(active, xKey, yKeys, seriesOrder), [active, xKey, yKeys, seriesOrder]);
  const busy = phase === "running";
  const block = busy ? null
    : !channels ? "select a dataset with a plotted Y column: the peak is measured on that column, by name, in every dataset"
    : picked.length === 0 ? "pick at least one dataset"
    : !(Number.isFinite(lo) && Number.isFinite(hi) && lo < hi) ? "set the peak window: low must be a number below high"
    : targetMode === "typed" && !Number.isFinite(typed) ? "type the target position"
    : null;

  const stamp = useRunStamp(JSON.stringify([
    picked, lo, hi, targetMode, targetMode === "typed" ? typed : null, xKey, yKeys, seriesOrder,
    picked.map((id) => datasetInputsToken(datasets.find((d) => d.id === id))),
  ]));
  const stale = run !== null && stamp.stale;

  const start = async () => {
    if (block || busy || !channels) return;
    const id = ++seq.current;
    const live = () => seq.current === id;
    setPhase("running");
    setFailure(null);
    setAdded(null);
    const sent: Measured[] = [];
    const rows: AlignRow[] = [];
    const hadPending = picked.some((dsId) => datasets.find((d) => d.id === dsId)?.pending);
    for (const dsId of picked) {
      const name = datasets.find((d) => d.id === dsId)?.name ?? dsId;
      try {
        const ds = await resolveDataset(dsId);
        if (!ds) throw new Error("the dataset is no longer available");
        const s = seriesFor(ds, channels);
        sent.push({ datasetId: dsId, name, x: s.x, y: s.y, fp: analysisDataFingerprint(ds), xk: seriesXKey(ds, channels) });
      } catch (e) {
        rows.push({ datasetId: dsId, name, ok: false, position: null, shift: null, error: e instanceof Error ? e.message : "could not read the dataset" });
      }
      if (!live()) return;
    }
    if (hadPending) await afterCommit();
    if (!live()) return;
    const launchKey = stamp.launchKey();
    let res: AlignPeaksResponse | null = null;
    try {
      if (sent.length > 0) {
        res = await alignPeaks({
          xs: sent.map((s) => s.x), ys: sent.map((s) => s.y), lo, hi,
          ...(targetMode === "typed" ? { target: typed } : {}),
        });
      }
    } catch (e) {
      if (!live()) return;
      setFailure(failureOf(e, "the alignment failed"));
      setPhase("failed");
      return;
    }
    if (!live()) return;
    const items: AlignItem[] = [];
    const latest = datasetsRef.current;
    sent.forEach((s, i) => {
      if (!res) return;
      const shift = res.shifts[i] ?? null;
      const position = res.positions[i] ?? null;
      const ok = res.ok[i] === true && shift !== null && position !== null;
      rows.push({ datasetId: s.datasetId, name: s.name, ok, position, shift, error: res.errors[i] ?? null });
      const src = latest.find((d) => d.id === s.datasetId);
      if (!ok || !src || shift === null || position === null) return;
      const prov: AlignProvenance = {
        window: [lo, hi], position, shift, target: res.target, targetMode, method: res.method, xLabel: channels.xLabel,
      };
      items.push({
        name: alignedName(s.name),
        data: shiftXData(src.data, s.xk === undefined ? null : s.xk, shift, prov),
        sourceId: s.datasetId, computedOn: s.fp, xKey: s.xk,
        settings: { window: [lo, hi], targetMode, target: res.target, shift, y: channels.yLabel },
        reopenExtra: { channels },
      });
    });
    const order = new Map(picked.map((dsId, i) => [dsId, i]));
    rows.sort((a, b) => (order.get(a.datasetId) ?? 0) - (order.get(b.datasetId) ?? 0));
    stamp.record(launchKey);
    setRun({ rows, items, target: res?.target ?? Number.NaN });
    setPhase("done");
  };

  // Replace's column check (lane RPL): an aligned copy has its source's columns; only the reopened source's output is replaced.
  const primaryId = reopened?.sourceIds[0];
  const outLabels = useMemo(() => (run && !stale ? run.items.find((it) => it.sourceId === primaryId)?.data.labels ?? null : null), [run, stale, primaryId]);
  useReplaceLayoutBlock(ALIGN_PRODUCER.id, primaryId, outLabels, seedProblem);

  /** Land the shifted copies in the library; returns how many were written. */
  const addAligned = (): number | null => {
    if (!run || stale || run.items.length === 0) return null;
    const sources = datasets.filter((d) => run.items.some((it) => it.sourceId === d.id));
    const { ids, refused, replaced } = commitAlignBatch(run.items, sources, useApp.getState);
    const swapped = replaced ? `replaced ${replaced} aligned dataset${replaced === 1 ? "" : "s"} in place` : "";
    const msg = ids.length === 0 && refused.length === 0 && replaced === 0
      ? "these aligned datasets are already in the library; nothing was duplicated"
      : [swapped, ids.length || !replaced ? `added ${ids.length} aligned dataset${ids.length === 1 ? "" : "s"}` : ""]
        .filter(Boolean).join("; ") + (refused.length ? `; ${refused.length} refused: ${refused[0]}` : "");
    setAdded(msg);
    setStatus(msg);
    return ids.length;
  };

  return {
    datasets, selectedIds, picked, setPicked,
    togglePicked: (dsId: string) => setPicked((p) => (p.includes(dsId) ? p.filter((x) => x !== dsId) : [...p, dsId])),
    lo, hi, setLo, setHi, roi, seedWindow, targetMode, setTargetMode, typed, setTyped,
    channels, block, busy, phase, error: failure?.message ?? null, refusal: failure?.refusal === true, stale,
    rows: run?.rows ?? null, target: run?.target ?? null, canAdd: !!run && !stale && run.items.length > 0, added,
    start, addAligned,
  };
}

export type AlignPeaksState = ReturnType<typeof useAlignPeaks>;
