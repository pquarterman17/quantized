// Map stack fit workshop — state hook. Picks a stack (maps on one grid) and a
// value of the independent variable per map, runs the per-pixel fit through the
// job queue (/api/map-stack-fit/job, progress + cancel), and commits one new
// map per output (each parameter, its standard error, reduced chi-square, the
// converged flag) in ONE undo step. Each output is linked to every layer: a
// change to any of them marks it out of date. Nothing is written until the
// job is done, so a cancel leaves nothing behind.

import { useEffect, useMemo, useRef, useState } from "react";

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { listFitModels } from "../../../lib/api/curvefit";
import { submitStackFit, type StackFitResult } from "../../../lib/api/mapStackFit";
import { cancelJob, JobCancelledError, pollJob } from "../../../lib/jobs";
import type { Dataset, FitModel } from "../../../lib/types";
import { commitBatchOutputs } from "../../../store/commitBatchOutputs";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { buildStackRequest, emptyRows, summaryLines, type ParamRow, type StackForm } from "./stackForm";
import { guessLayerValues, type LayerGuess } from "./stackGuess";

export const MAP_STACK_FIT_PRODUCER = { id: "map-stack-fit", label: "Map stack fit", version: 1 } as const;

const isMap = (d: Dataset): boolean => d.data.metadata?.["is2D"] === true;
const shapeKey = (d: Dataset): string => JSON.stringify(d.data.metadata?.["map_shape"] ?? null);
const DEFAULT_MODEL = "Exponential Decay";

export interface MapStackFitState {
  maps: { id: string; name: string; shape: string }[];
  selected: string[];
  toggle: (id: string) => void;
  guess: LayerGuess;
  xText: (id: string) => string;
  setX: (id: string, text: string) => void;
  models: FitModel[];
  model: FitModel | undefined;
  form: StackForm;
  setForm: (patch: Partial<Omit<StackForm, "rows">>) => void;
  setModel: (name: string) => void;
  setRow: (k: number, patch: Partial<ParamRow>) => void;
  busy: boolean;
  progress: number;
  message: string;
  error: string | null;
  summary: string[];
  run: () => Promise<void>;
  cancel: () => void;
}

export function useMapStackFit(): MapStackFitState {
  const active = useActiveDataset();
  const datasets = useApp((s) => s.datasets);
  const resolveDataset = useApp((s) => s.resolveDataset);
  const allMaps = useMemo(() => datasets.filter(isMap), [datasets]);
  const [pick, setPick] = useState<string[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [models, setModels] = useState<FitModel[]>([]);
  const [form, setFormState] = useState<StackForm>({ model: DEFAULT_MODEL, xLabel: "", keepUnconverged: false, rows: [] });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const jobRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    listFitModels().then((r) => {
      if (!alive) return;
      setModels(r.models);
      const m = r.models.find((x) => x.name === DEFAULT_MODEL) ?? r.models[0];
      if (m) setFormState((f) => ({ ...f, model: m.name, rows: emptyRows(m) }));
    }).catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "could not load the fit models"));
    return () => { alive = false; };
  }, []);

  // Until the user ticks something: the active map and every other map on the same grid.
  const selected = useMemo(() => {
    if (pick) return pick.filter((id) => allMaps.some((d) => d.id === id));
    const a = allMaps.find((d) => d.id === active?.id);
    return a ? allMaps.filter((d) => shapeKey(d) === shapeKey(a)).map((d) => d.id) : [];
  }, [pick, allMaps, active?.id]);
  const layers = useMemo(() => allMaps.filter((d) => selected.includes(d.id)), [allMaps, selected]);
  const guess = useMemo(() => guessLayerValues(layers), [layers]);
  const model = models.find((m) => m.name === form.model);

  const xText = (id: string): string => edits[id] ?? guess.values[layers.findIndex((d) => d.id === id)] ?? "";

  const run = async (): Promise<void> => {
    if (!model) return;
    setError(null);
    setSummary([]);
    setBusy(true);
    setProgress(0);
    try {
      const full: Dataset[] = [];
      for (const d of layers) {
        const r = await resolveDataset(d.id);
        if (!r) throw new Error(`${d.name} is unavailable`);
        full.push(r);
      }
      const b = buildStackRequest(form, model, full.map((d) => ({ name: d.name, data: d.data })), full.map((d) => xText(d.id)));
      if ("error" in b) { setError(b.error); return; }
      const { job_id } = await submitStackFit(b.req);
      jobRef.current = job_id;
      const res = await pollJob<StackFitResult>(job_id, (f, m) => { setProgress(f); setMessage(m); });
      const [first, ...rest] = full;
      const computed = (d: Dataset) => ({ id: d.id, computedOn: analysisDataFingerprint(d) });
      const label = `${first!.name} + ${rest.length} · ${model.name} fit`;
      const settings = Object.fromEntries(Object.entries(b.req).filter(([k]) => k !== "datasets"));
      const report = commitBatchOutputs(
        "Map stack fit",
        res.outputs.map((o) => ({
          name: o.name,
          request: {
            producer: MAP_STACK_FIT_PRODUCER,
            sourceId: first!.id,
            computedOn: computed(first!).computedOn,
            alsoFrom: rest.map(computed),
            settings: { ...settings, output: o.name },
            output: () => ({ name: `${label} · ${o.name}`, data: o.dataset }),
          },
        })),
      );
      setSummary([...summaryLines(res.summary), ...report.refused]);
    } catch (e) {
      if (!(e instanceof JobCancelledError)) setError(e instanceof Error ? e.message : "stack fit failed");
      else setSummary(["Cancelled: nothing was added."]);
    } finally {
      jobRef.current = null;
      setBusy(false);
    }
  };

  return {
    maps: allMaps.map((d) => ({ id: d.id, name: d.name, shape: shapeKey(d) })),
    selected,
    toggle: (id) => setPick(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]),
    guess,
    xText,
    setX: (id, text) => setEdits((e) => ({ ...e, [id]: text })),
    models,
    model,
    form,
    setForm: (patch) => setFormState((f) => ({ ...f, ...patch })),
    setModel: (name) => setFormState((f) => ({ ...f, model: name, rows: emptyRows(models.find((m) => m.name === name)) })),
    setRow: (k, patch) => setFormState((f) => ({ ...f, rows: f.rows.map((r, i) => (i === k ? { ...r, ...patch } : r)) })),
    busy,
    progress,
    message,
    error,
    summary,
    run,
    cancel: () => { const id = jobRef.current; if (id) void (async () => { try { await cancelJob(id); } catch { /* already finished */ } })(); },
  };
}
