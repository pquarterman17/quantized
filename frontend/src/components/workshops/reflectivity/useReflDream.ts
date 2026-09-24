// Reflectivity fit — "Estimate uncertainty (DREAM)" state hook (P2.2 slice 4).
// Mirrors the Curve Fit workshop's useBumpsFit job lifecycle: submit to
// POST /api/reflectivity/dream, GET-poll the job (lib/api/reflectivity's
// restatement of lib/jobs — see there why; progress, cancel), then store the posterior SUMMARY on the fit's record
// (reflFitRecord.ts `withPosterior`, one undo step) and keep the live run's
// bands for "Add uncertainty bands". A run is always OF a record — the live
// fit's or a saved one — and re-sends exactly the points that fit sent: every
// channel is rebuilt from its dataset and refused if its digest moved.
//
// Store access is by selector plus `useApp.setState` — no imperative store
// snapshot reads (architecture.test.ts's getState file-count ratchet).

import { useEffect, useRef, useState } from "react";

import {
  cancelReflJob,
  pollReflJob,
  reflDream,
  ReflJobCancelled,
  type ReflFitChannel,
  type ReflPosteriorResult,
} from "../../../lib/api/reflectivity";
import { defaultPlotView } from "../../../lib/plotview";
import { droppedRows } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { nextDatasetId, useApp } from "../../../store/useApp";
import { bandDatasets, R_BAND_FILLS } from "./reflDreamBands";
import { buildChannel } from "./reflFitData";
import { channelDigest, recordsFor, withPosterior, type ReflFitRecord } from "./reflFitRecord";
import { resolveBinding } from "./reflFitRestore";
import { DREAM_DEFAULTS, posteriorSummary, type DreamSettings } from "./reflPosterior";

export interface ReflDreamState {
  settings: DreamSettings;
  setSettings: (patch: Partial<DreamSettings>) => void;
  busy: boolean;
  /** The record the running job is OF, or null. */
  runningFor: string | null;
  /** Job fraction (0..1) and message while polling; null otherwise. */
  progress: number | null;
  message: string;
  error: string | null;
  /** Why this record cannot be sampled, or null. */
  blocked: (record: ReflFitRecord) => string | null;
  /** The live run's bands are available for this record's stored posterior. */
  hasBands: (record: ReflFitRecord) => boolean;
  bandsAdded: (record: ReflFitRecord) => boolean;
  run: (record: ReflFitRecord) => Promise<void>;
  cancel: () => Promise<void>;
  addBands: (record: ReflFitRecord) => string[];
  openBandPlot: (record: ReflFitRecord) => void;
}

/** Why a record cannot be sampled, or null. */
export function dreamBlocked(record: ReflFitRecord): string | null {
  if (record.request.weighting !== "dr") {
    return "DREAM needs dR weighting: this fit minimised log residuals, which is not a chi-square — fit with a dR column to estimate its uncertainty";
  }
  if (!record.result.parameters.some((p) => p.vary && !p.tie)) return "this fit has no free parameters to sample";
  return null;
}

/** The request's channels, rebuilt from the live library exactly as the fit
 *  sent them — or why they cannot be (a dataset or column gone, the data
 *  changed since the fit). */
async function rebuildChannels(record: ReflFitRecord, resolve: (id: string) => Promise<Dataset | undefined>): Promise<ReflFitChannel[]> {
  const { settings, weighting } = record.request;
  const out: ReflFitChannel[] = [];
  for (const [i, ch] of record.request.channels.entries()) {
    const ds = await resolve(ch.datasetId);
    const b = resolveBinding(ch, ds, i + 1);
    if (typeof b === "string") throw new Error(b);
    const d = ds as Dataset;
    const changed = `channel ${i + 1}: the data of "${d.name}" changed since this fit — run the fit again, then estimate its uncertainty`;
    const label = `${d.name} · ${ch.rLabel || "R"}${ch.spin === "none" ? "" : ` (${ch.spin})`}`;
    let channel: ReflFitChannel;
    try {
      channel = buildChannel(d.data, droppedRows(d), b, settings, weighting, ch.lambda, label).channel;
    } catch {
      throw new Error(changed);
    }
    if (ch.digest && channelDigest(channel) !== ch.digest) throw new Error(changed);
    out.push(channel);
  }
  return out;
}

export function useReflDream(): ReflDreamState {
  const resolveDataset = useApp((s) => s.resolveDataset);
  const recordHistory = useApp((s) => s.recordHistory);
  const addDataset = useApp((s) => s.addDataset);
  const createWindow = useApp((s) => s.createWindow);
  const setStatus = useApp((s) => s.setStatus);
  const datasets = useApp((s) => s.datasets);
  const [settings, setSettingsState] = useState<DreamSettings>(DREAM_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [runningFor, setRunningFor] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The last run's full result (with its bands), for the record it is OF.
  const [live, setLive] = useState<{ recordId: string; ranAt: string; result: ReflPosteriorResult } | null>(null);
  const [addedFor, setAddedFor] = useState<Record<string, string[]>>({});
  const jobRef = useRef<string | null>(null);
  const mounted = useRef(true);
  // The library as it is NOW, for the write after the job's round trip (the
  // same subscription useReflFitHistory's `publish` uses).
  const liveDatasets = useRef<Dataset[] | null>(null);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = useApp.subscribe((s) => {
      liveDatasets.current = s.datasets;
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      // Closing the workshop mid-run stops the server's work too.
      if (jobRef.current) void cancelReflJob(jobRef.current).catch(() => undefined);
    };
  }, []);

  function setSettings(patch: Partial<DreamSettings>): void {
    setSettingsState((s) => ({ ...s, ...patch }));
  }

  /** The live bands belong to exactly the posterior the record now stores. */
  function hasBands(record: ReflFitRecord): boolean {
    return live != null && live.recordId === record.id && record.posterior?.ranAt === live.ranAt;
  }

  async function run(record: ReflFitRecord): Promise<void> {
    if (busy) return;
    const why = dreamBlocked(record);
    if (why) {
      setError(why);
      return;
    }
    const chosen = { ...settings };
    setBusy(true);
    setRunningFor(record.id);
    setError(null);
    setProgress(0);
    setMessage("submitting");
    try {
      const channels = await rebuildChannels(record, resolveDataset);
      const centre = Object.fromEntries(record.result.parameters.filter((p) => p.vary && !p.tie).map((p) => [p.name, p.value]));
      const { job_id } = await reflDream({
        parameters: record.request.parameters,
        channels,
        weighting: "dr",
        centre,
        samples: chosen.samples,
        burn: chosen.burn,
        pop: chosen.pop,
        seed: chosen.seed,
      });
      if (!mounted.current) {
        // Closed while the request was in flight: the cleanup had no id to cancel.
        void cancelReflJob(job_id).catch(() => undefined);
        return;
      }
      jobRef.current = job_id;
      const res = await pollReflJob<ReflPosteriorResult>(job_id, (f, m) => {
        if (!mounted.current) return;
        setProgress(f);
        setMessage(m);
      });
      if (!mounted.current) return;
      const ranAt = new Date().toISOString();
      const now = liveDatasets.current ?? datasets;
      if (!now.some((d) => recordsFor(d).some((r) => r.id === record.id))) {
        setError("the fit this estimate belongs to is no longer stored (deleted or undone) — nothing was saved");
        return;
      }
      recordHistory("reflectivity uncertainty");
      useApp.setState((s) => ({ datasets: withPosterior(s.datasets, record.id, posteriorSummary(res, chosen, ranAt)) }));
      setLive({ recordId: record.id, ranAt, result: res });
      const c = res.convergence;
      setStatus(
        `reflectivity uncertainty for fit #${record.seq} — ${c.n_draws} draws, R-hat max ${c.rhat_max == null ? "n/a" : c.rhat_max.toFixed(3)}${c.converged ? "" : " (not converged)"}`,
      );
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ReflJobCancelled) setStatus("reflectivity uncertainty estimate cancelled");
      else setError(e instanceof Error ? e.message : "the uncertainty estimate failed");
    } finally {
      jobRef.current = null;
      if (mounted.current) {
        setBusy(false);
        setRunningFor(null);
        setProgress(null);
        setMessage("");
      }
    }
  }

  async function cancel(): Promise<void> {
    const id = jobRef.current;
    if (!id) return;
    try {
      await cancelReflJob(id);
    } catch {
      /* job already terminal — the poll loop settles it */
    }
  }

  function addBands(record: ReflFitRecord): string[] {
    if (!live || !hasBands(record)) return [];
    const done = addedFor[live.ranAt];
    if (done) return done;
    const ids = bandDatasets(live.result, record, datasets, live.ranAt).map((c) => {
      const id = nextDatasetId();
      addDataset({ id, name: c.name, data: c.data, ...c.placement });
      return id;
    });
    setAddedFor((m) => ({ ...m, [live.ranAt]: ids }));
    setStatus(`added ${ids.length} uncertainty-band datasets for reflectivity fit #${record.seq}`);
    return ids;
  }

  function openBandPlot(record: ReflFitRecord): void {
    const ids = addBands(record);
    if (!ids.length) return;
    createWindow(ids[0], { ...defaultPlotView(), yScale: "log", seriesStyles: { ...R_BAND_FILLS } }, "Reflectivity uncertainty");
  }

  return {
    settings,
    setSettings,
    busy,
    runningFor,
    progress,
    message,
    error,
    blocked: dreamBlocked,
    hasBands,
    bandsAdded: (record) => live != null && hasBands(record) && live.ranAt in addedFor,
    run,
    cancel,
    addBands,
    openBandPlot,
  };
}
