// Peak Analyzer — the mixed-shape model fit engine (audit P2.4 slice 2):
// per-peak shapes, background, the editable parameter table, the
// `/api/peaks/model-fit` round trip and its plot overlays. usePeakWizard owns
// the working data and the candidates; this hook owns everything about the
// model, so the wizard hook stays a thin orchestrator.
//
// ONE CONTENT KEY drives everything that depends on the inputs: the active
// dataset id, the included candidates, the recipe's shape / background degree
// / width link, and a digest of the working x and y (so a range, baseline,
// toggle/add/remove-peak or same-id data change all move it).
//   * Parameters: `seedSetup` (./peakModelParams) derives the defaults; user
//     edits are kept against the key, so an equal re-render keeps them and a
//     real change re-seeds.
//   * Results: any key change DROPS the result, the in-flight request and our
//     overlays — no hand-placed invalidation calls. A table edit after a fit
//     leaves the result visible but STALE: its overlays come off, and the
//     wizard blocks integrate/report on it until a re-fit.
//
// REQUESTS. The repo's sequencing pattern (useCrystalCalc's `crSeq`, the
// calculators' `seq.current !== id`) plus useReflFit's AbortController: every
// run, cancel and reset bumps `seq`, and a response whose id is no longer
// current writes nothing — so a slow, superseded or cancelled fit can never
// overwrite a newer one. Aborting only stops the CLIENT waiting; the
// synchronous backend fit still finishes (its 30 s cap bounds it).
//
// OVERLAYS. The model (+ the step-① baseline, since the fit ran on the
// subtracted trace) goes to the store's `fitOverlay`; the fitted background
// (+ that baseline) replaces the baseline preview in `baselineOverlay`, rows
// mapped 1:1 by position (./modelFitOverlay). Both are taken back only while
// still ours — a compare-and-set inside `useApp.setState`'s updater, so this
// hook never subscribes to those slices. Taking them back within one dataset
// restores the step-① preview; across a dataset switch it only clears (the
// baseline in hand belongs to the OLD dataset). Components and residuals have
// no plot slot; the step's own preview (ModelFitPreview) draws them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fitPeakModel, type PeakModelFitResponse } from "../../../lib/api/peaks";
import { expandToFullRows, type PeakRecipe } from "../../../lib/peakwizard";
import { activeRowIndices, droppedRows } from "../../../lib/rowstate";
import type { BaselineOverlay, Dataset, FitOverlay } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { curveToRows } from "./modelFitOverlay";
import { setupProblems } from "./modelSetupChecks";
import {
  backgroundFromDegree,
  backgroundNote,
  fwhmShared,
  modelFitBody,
  patchParam,
  reshape,
  seedSetup,
  setFwhmShared,
  shapeFromGlobal,
  startFromFit,
  type ModelBackground,
  type ModelParam,
  type ModelSetup,
  type ModelShape,
  type SeedPeak,
} from "./peakModelParams";

export type FitEngine = "model" | "classic";

export interface ModelFitState {
  engine: FitEngine;
  setEngine: (e: FitEngine) => void;
  setup: ModelSetup;
  /** Why the defaults differ from the recipe (no equivalent here). */
  shapeNote: string | null;
  bgNote: string | null;
  setShape: (peak: number, shape: ModelShape) => void;
  setBackground: (bg: ModelBackground) => void;
  patch: (name: string, patch: Partial<Omit<ModelParam, "name">>) => void;
  fwhmShared: boolean;
  toggleShareFwhm: () => void;
  resetSetup: () => void;
  /** Client-side mirror of the backend's parameter rules; Fit is blocked
   *  while non-empty. */
  problems: string[];
  busy: boolean;
  error: string | null;
  notice: string | null;
  result: PeakModelFitResponse | null;
  /** The table changed since `result` was fitted: not reportable. */
  stale: boolean;
  run: () => Promise<void>;
  cancel: () => void;
  startFromResult: () => void;
  /** Drop the result, any in-flight request and our overlays. Stable. */
  clear: () => void;
}

export interface ModelFitInputs {
  active: Dataset | null;
  segment: { x: number[]; kept: number[] } | null;
  workingY: number[] | null;
  baseline: (number | null)[] | null;
  baselineOn: boolean;
  peaks: SeedPeak[];
  model: PeakRecipe["model"];
}

function digest(v: readonly number[] | null | undefined): [number, number, number] {
  let s = 0;
  let w = 0;
  const a = v ?? [];
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    w += a[i] * (i + 1);
  }
  return [a.length, s, w];
}

type Owned = { fit: FitOverlay | null; bg: BaselineOverlay | null };

export function useModelFit(inp: ModelFitInputs): ModelFitState {
  const { active, segment, workingY, baseline, baselineOn, peaks, model } = inp;
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const setBaselineOverlay = useApp((s) => s.setBaselineOverlay);
  const [engine, setEngineState] = useState<FitEngine>("model");
  const [edited, setEdited] = useState<{ key: string; setup: ModelSetup } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ran, setRan] = useState<{ result: PeakModelFitResponse; setup: string } | null>(null);
  const seq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const own = useRef<Owned>({ fit: null, bg: null });

  const activeId = active?.id ?? null;
  const key = useMemo(
    () => JSON.stringify([activeId, peaks, model.shape, model.bgDegree, model.linkMode,
      digest(segment?.x), digest(workingY)]),
    [activeId, peaks, model.shape, model.bgDegree, model.linkMode, segment, workingY],
  );
  const seeded = useMemo(
    () => seedSetup(peaks, peaks.map(() => shapeFromGlobal(model.shape)),
      backgroundFromDegree(model.bgDegree), segment?.x ?? [], workingY ?? [], model.linkMode),
    [peaks, model.shape, model.bgDegree, model.linkMode, segment, workingY],
  );
  const setup = edited && edited.key === key ? edited.setup : seeded;
  const setupJson = useMemo(() => JSON.stringify(setup), [setup]);
  const problems = useMemo(() => setupProblems(setup), [setup]);
  const edit = (next: ModelSetup) => setEdited({ key, setup: next });
  const reshapeTo = (shapes: ModelShape[], bg: ModelBackground) =>
    edit(reshape(setup, peaks, shapes, bg, segment?.x ?? [], workingY ?? [], model.linkMode));

  // The step-① preview as usePeakBaseline draws it, for restoring.
  const previewRef = useRef<() => BaselineOverlay | null>(() => null);
  previewRef.current = () =>
    active && segment && baseline && baselineOn
      ? { datasetId: active.id, y: expandToFullRows(baseline, segment.kept, active.data.time.length) }
      : null;

  const dropOverlays = useCallback((restore: boolean) => {
    const { fit, bg } = own.current;
    own.current = { fit: null, bg: null };
    if (!fit && !bg) return;
    const preview = restore ? previewRef.current() : null;
    useApp.setState((s) => {
      const next: { fitOverlay?: null; baselineOverlay?: BaselineOverlay | null } = {};
      if (fit && s.fitOverlay === fit) next.fitOverlay = null;
      if (bg && s.baselineOverlay === bg) next.baselineOverlay = preview;
      return Object.keys(next).length ? next : s;
    });
  }, []);

  const reset = useCallback((restore: boolean) => {
    seq.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setRan(null);
    setError(null);
    setNotice(null);
    dropOverlays(restore);
  }, [dropOverlays]);
  const clear = useCallback(() => reset(false), [reset]);

  // Any input change invalidates: within one dataset the preview comes back;
  // across a switch (or on unmount) we only clear.
  const lastActive = useRef(activeId);
  useEffect(() => {
    const same = lastActive.current === activeId;
    lastActive.current = activeId;
    reset(same);
  }, [key, activeId, reset]);
  useEffect(() => () => reset(false), [reset]);

  const stale = ran !== null && ran.setup !== setupJson;
  useEffect(() => {
    if (stale) dropOverlays(true);
  }, [stale, dropOverlays]);

  const publish = (res: PeakModelFitResponse, ds: Dataset, seg: { x: number[]; kept: number[] }) => {
    const n = ds.data.time.length;
    const rows = activeRowIndices(n, droppedRows(ds));
    const segToRow = seg.kept.map((k) => rows[k]);
    const offsets = baselineOn && baseline ? baseline : null;
    const c = res.curves;
    const fit = { datasetId: ds.id, y: curveToRows(c.x, c.model, seg.x, segToRow, n, offsets) };
    const bg = res.background.kind === "none" && !offsets
      ? null
      : { datasetId: ds.id, y: curveToRows(c.x, c.background, seg.x, segToRow, n, offsets) };
    own.current = { fit, bg };
    setFitOverlay(fit);
    if (bg) setBaselineOverlay(bg);
  };

  const run = async () => {
    if (!active || !segment || !workingY || peaks.length === 0) {
      setError("include at least one peak first");
      return;
    }
    if (problems.length > 0) {
      setError(`fix the parameter table first: ${problems[0]}`);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = ++seq.current;
    const sent = setupJson;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fitPeakModel(modelFitBody(setup, segment.x, workingY), controller.signal);
      if (seq.current !== id) return; // superseded — a newer run/cancel/reset owns this panel
      dropOverlays(false);
      setRan({ result: res, setup: sent });
      publish(res, active, segment);
    } catch (e) {
      if (seq.current !== id) return;
      setError(e instanceof Error ? e.message : "model fit failed");
    } finally {
      if (seq.current === id) {
        setBusy(false);
        abortRef.current = null;
      }
    }
  };

  const cancel = () => {
    seq.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setNotice("fit cancelled — the server may still finish it; its answer will be ignored");
  };

  const shared = fwhmShared(setup.params);
  return {
    engine,
    // Switching engine is a configuration change: the model's result and its
    // plot curves go (the classic engine draws none).
    setEngine: (e) => {
      if (e === engine) return;
      reset(true);
      setEngineState(e);
    },
    setup,
    shapeNote: shapeFromGlobal(model.shape) === "pseudo_voigt" && model.shape !== "Pseudo-Voigt"
      ? `${model.shape} has no mixed-model equivalent: peaks start as pseudo-Voigt (use the Classic engine for ${model.shape})`
      : null,
    bgNote: backgroundNote(model.bgDegree),
    setShape: (i, s) => reshapeTo(setup.shapes.map((old, j) => (j === i ? s : old)), setup.background),
    setBackground: (bg) => reshapeTo(setup.shapes, bg),
    patch: (name, p) => edit(patchParam(setup, name, p)),
    fwhmShared: shared,
    toggleShareFwhm: () => edit(setFwhmShared(setup, !shared)),
    resetSetup: () => setEdited(null),
    problems,
    busy,
    error,
    notice,
    result: ran?.result ?? null,
    stale,
    run,
    cancel,
    startFromResult: () => {
      if (ran) edit({ ...setup, params: startFromFit(setup.params, ran.result.parameters) });
    },
    clear,
  };
}
