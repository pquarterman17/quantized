// Peak Analyzer — the mixed-shape model fit engine (audit P2.4 slice 2):
// per-peak shapes, background, the editable parameter table, the
// `/api/peaks/model-fit` round trip and its plot overlays. usePeakWizard owns
// the working data and the candidates; this hook owns everything about the
// model, so the wizard hook stays a thin orchestrator.
//
// PARAMETERS. `seedSetup` (./peakModelParams) derives the defaults from the
// included candidates + the recipe's global shape / background degree / width
// link, so touching nothing reproduces the recipe's intent. User edits are
// kept against a CONTENT key of those inputs: a re-render that rebuilds equal
// arrays keeps the edits; a real change (re-find, include/exclude, a new
// global shape, different data) re-seeds.
//
// REQUESTS. The repo's sequencing pattern (useCrystalCalc's `crSeq`, the
// calculators' `seq.current !== id`) plus useReflFit's AbortController: every
// run, cancel and clear bumps `seq`, and a response whose id is no longer
// current writes nothing — so a slow, superseded or cancelled fit can never
// overwrite a newer one. Aborting only stops the CLIENT waiting; the
// synchronous backend fit still finishes (its 30 s cap bounds it).
//
// OVERLAYS. The model (+ the step-① baseline, since the fit ran on the
// subtracted trace) goes to the store's `fitOverlay`; the fitted background
// (+ that baseline) replaces the baseline preview in `baselineOverlay`. Both
// are remembered as OURS and cleared/restored only while still ours, the
// useReflFit ownership pattern. Components and residuals have no plot slot;
// the step's own preview (ModelFitPreview) draws them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fitPeakModel, type PeakModelFitResponse } from "../../../lib/api/peaks";
import { fullPlottedX } from "../../../lib/fitselectionActions";
import { expandToFullRows, type PeakRecipe } from "../../../lib/peakwizard";
import type { BaselineOverlay, Dataset, FitOverlay } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { baselineOffsets, fullRowOverlay } from "./modelFitOverlay";
import {
  backgroundFromDegree,
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
  /** Why the default shape differs from the recipe's (no equivalent here). */
  shapeNote: string | null;
  setShape: (peak: number, shape: ModelShape) => void;
  setBackground: (bg: ModelBackground) => void;
  patch: (name: string, patch: Partial<Omit<ModelParam, "name">>) => void;
  fwhmShared: boolean;
  toggleShareFwhm: () => void;
  resetSetup: () => void;
  busy: boolean;
  error: string | null;
  notice: string | null;
  result: PeakModelFitResponse | null;
  /** The table changed since `result` was fitted. */
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
  range: PeakRecipe["range"];
  xKey: number | null;
}

function contentKey(i: ModelFitInputs): string {
  const x = i.segment?.x ?? [];
  let ySum = 0;
  for (const v of i.workingY ?? []) ySum += v;
  return JSON.stringify([i.peaks, i.model.shape, i.model.bgDegree, i.model.linkMode,
    x.length, x[0], x[x.length - 1], ySum]);
}

export function useModelFit(inp: ModelFitInputs): ModelFitState {
  const { active, segment, workingY, baseline, baselineOn, peaks, model, range, xKey } = inp;
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const setBaselineOverlay = useApp((s) => s.setBaselineOverlay);
  const [engine, setEngine] = useState<FitEngine>("model");
  const [edited, setEdited] = useState<{ key: string; setup: ModelSetup } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ran, setRan] = useState<{ result: PeakModelFitResponse; setup: string } | null>(null);
  const seq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const own = useRef<{ fit: FitOverlay | null; bg: BaselineOverlay | null }>({ fit: null, bg: null });

  const key = contentKey(inp);
  const seeded = useMemo(
    () => seedSetup(peaks, peaks.map(() => shapeFromGlobal(model.shape)),
      backgroundFromDegree(model.bgDegree), segment?.x ?? [], workingY ?? [], model.linkMode),
    [peaks, model.shape, model.bgDegree, model.linkMode, segment, workingY],
  );
  const setup = edited && edited.key === key ? edited.setup : seeded;
  const setupJson = useMemo(() => JSON.stringify(setup), [setup]);
  const edit = (next: ModelSetup) => setEdited({ key, setup: next });
  const reshapeTo = (shapes: ModelShape[], bg: ModelBackground) =>
    edit(reshape(setup, peaks, shapes, bg, segment?.x ?? [], workingY ?? []));

  // Latest values for the stable `clear` (called from usePeakWizard's
  // `patchRecipe`, a []-deps callback) without re-creating it every render.
  const restoreRef = useRef<() => BaselineOverlay | null>(() => null);
  restoreRef.current = () =>
    active && segment && baseline && baselineOn
      ? { datasetId: active.id, y: expandToFullRows(baseline, segment.kept, active.data.time.length) }
      : null;

  // What the plot shows now, via selectors (not an imperative getState, per
  // architecture.test.ts's getState ratchet): our curves are taken back only
  // while they are still the ones showing — another tool may have replaced them.
  const liveFit = useApp((s) => s.fitOverlay);
  const liveBg = useApp((s) => s.baselineOverlay);
  const live = useRef({ fit: liveFit, bg: liveBg });
  live.current = { fit: liveFit, bg: liveBg };

  const dropOverlays = useCallback(() => {
    if (own.current.fit && live.current.fit === own.current.fit) setFitOverlay(null);
    if (own.current.bg && live.current.bg === own.current.bg) setBaselineOverlay(restoreRef.current());
    own.current = { fit: null, bg: null };
  }, [setFitOverlay, setBaselineOverlay]);

  const clear = useCallback(() => {
    seq.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setRan(null);
    setError(null);
    setNotice(null);
    dropOverlays();
  }, [dropOverlays]);

  // A result describes ONE dataset: switching the active one drops it, and
  // unmounting (the panel closing) stops the wait and takes our curve off.
  const activeId = active?.id ?? null;
  useEffect(() => clear, [activeId, clear]);

  const publish = (res: PeakModelFitResponse, ds: Dataset, x: number[]) => {
    const fullX = fullPlottedX(ds.data, xKey);
    const offset = baselineOn && baseline ? baselineOffsets(x, baseline) : null;
    const fit = { datasetId: ds.id, y: fullRowOverlay(fullX, res.curves.x, res.curves.model, offset) };
    const bg = res.background.kind === "none" && !offset
      ? null
      : { datasetId: ds.id, y: fullRowOverlay(fullX, res.curves.x, res.curves.background, offset) };
    own.current = { fit, bg };
    setFitOverlay(fit);
    if (bg) setBaselineOverlay(bg);
  };

  const run = async () => {
    if (!active || !segment || !workingY || peaks.length === 0) {
      setError("include at least one peak first");
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
      const res = await fitPeakModel(modelFitBody(setup, segment.x, workingY, range), controller.signal);
      if (seq.current !== id) return; // superseded — a newer run/cancel/clear owns this panel
      dropOverlays();
      setRan({ result: res, setup: sent });
      publish(res, active, segment.x);
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
    // Switching engine is a configuration change like any recipe patch: the
    // model's result and its plot curves go (the classic engine draws none).
    setEngine: (e) => {
      if (e === engine) return;
      clear();
      setEngine(e);
    },
    setup,
    shapeNote: shapeFromGlobal(model.shape) === "pseudo_voigt" && model.shape !== "Pseudo-Voigt"
      ? `${model.shape} has no mixed-model equivalent: peaks start as pseudo-Voigt (use the Classic engine for ${model.shape})`
      : null,
    setShape: (i, s) => reshapeTo(setup.shapes.map((old, j) => (j === i ? s : old)), setup.background),
    setBackground: (bg) => reshapeTo(setup.shapes, bg),
    patch: (name, p) => edit(patchParam(setup, name, p)),
    fwhmShared: shared,
    toggleShareFwhm: () => edit({ ...setup, params: setFwhmShared(setup.params, !shared) }),
    resetSetup: () => setEdited(null),
    busy,
    error,
    notice,
    result: ran?.result ?? null,
    stale: ran !== null && ran.setup !== setupJson,
    run,
    cancel,
    startFromResult: () => {
      if (ran) edit({ ...setup, params: startFromFit(setup.params, ran.result.parameters) });
    },
    clear,
  };
}
