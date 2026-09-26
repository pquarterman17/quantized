// Peak Analyzer — the mixed-shape model fit engine (audit P2.4 slice 2):
// per-peak shapes, background, the editable parameter table, the
// `/api/peaks/model-fit` round trip and its plot overlays. usePeakWizard owns
// the working data and the candidates; this hook owns everything about the
// model, so the wizard hook stays a thin orchestrator.
//
// ONE CONTENT KEY drives everything that depends on the inputs: the active
// dataset id, the included candidates, the recipe's shape / background degree
// / width link, the engine, and a digest of the working x and y (so a range,
// baseline, toggle/add/remove-peak or same-id data change all move it).
//   * Parameters (slice 3): the USER'S EDITS live in the recipe's fit section
//     (`fit`, lib/peakRecipeFit.ts — engine, per-peak shapes, background, and
//     field-level parameter edits by stable name), so they save and load with
//     the recipe. The table is `buildSetup` (./peakModelParams): re-seeded
//     from the current data on every input change, the Share-FWHM flag
//     applied, then every stored edit re-applied on top. The wizard renumbers
//     the edits when a peak leaves or re-joins the model, so an edit stays
//     with its peak (an excluded peak's come back on re-include).
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
import type { PeakRecipe } from "../../../lib/peakwizard";
import { DEFAULT_FIT, type FitEngine, type PeakRecipeFit } from "../../../lib/peakRecipeFit";
import type { BaselineOverlay, Dataset, FitOverlay } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { curveToRows, segmentRows, segmentToFullRows } from "./modelFitOverlay";
import { interpolateAt, modelFitDraft, modelFitPublishBlock } from "./modelFitPublish";
import { setupProblems } from "./modelSetupChecks";
import {
  backgroundNote,
  buildSetup,
  fwhmShared,
  modelFitBody,
  patchParam,
  recordEdits,
  shapeFromGlobal,
  startFromFit,
  withShareFwhm,
  type ModelBackground,
  type ModelParam,
  type ModelSetup,
  type ModelShape,
  type SeedPeak,
} from "./peakModelParams";

export type { FitEngine };

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
  /** Why the result cannot go to the durable peak table now, or null. */
  publishBlock: string | null;
  /** Write the result into the active dataset's durable peak table (audit
   *  P2.1) — values, standard errors, shapes and provenance. One undo step. */
  publish: () => Promise<void>;
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
  /** The recipe's fit section — the single store of the user's edits. */
  fit: PeakRecipeFit;
  setFit: (update: (fit: PeakRecipeFit) => PeakRecipeFit) => void;
  /** The recipe's name / range / baseline, for the published provenance. */
  recipe?: Pick<PeakRecipe, "name" | "range" | "baseline">;
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
  const { active, segment, workingY, baseline, baselineOn, peaks, model, fit, setFit } = inp;
  const engine = fit.engine;
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const setBaselineOverlay = useApp((s) => s.setBaselineOverlay);
  // The channel the working segment was cut from (usePeakWizard's
  // `selectedFitData(active, xKey, ...)`): a change moves the segment and so
  // drops the result, so at publish time it is the axis the fit ran on.
  const xKey = useApp((s) => s.xKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ran, setRan] = useState<{ result: PeakModelFitResponse; setup: string } | null>(null);
  const seq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const own = useRef<Owned>({ fit: null, bg: null });

  const activeId = active?.id ?? null;
  const key = useMemo(
    () => JSON.stringify([activeId, peaks, model.shape, model.bgDegree, model.linkMode, engine,
      digest(segment?.x), digest(workingY)]),
    [activeId, peaks, model.shape, model.bgDegree, model.linkMode, engine, segment, workingY],
  );
  const setup = useMemo(
    () => buildSetup(peaks, fit, model, segment?.x ?? [], workingY ?? []),
    [peaks, fit, model, segment, workingY],
  );
  const setupJson = useMemo(() => JSON.stringify(setup), [setup]);
  const problems = useMemo(() => setupProblems(setup), [setup]);
  /** Record a table change (`next` derived from the CURRENT `setup`) as edits. */
  const edit = (next: ModelSetup) =>
    setFit((f) => ({ ...f, params: recordEdits(f.params, setup.params, next.params) }));
  const setShape = (i: number, s: ModelShape) =>
    setFit((f) => {
      const shapes = [...f.shapes];
      for (let j = shapes.length; j < i; j++) shapes[j] = null;
      shapes[i] = s;
      return { ...f, shapes };
    });

  // The step-① preview as usePeakBaseline draws it, for restoring.
  const previewRef = useRef<() => BaselineOverlay | null>(() => null);
  previewRef.current = () =>
    active && segment && baseline && baselineOn
      ? { datasetId: active.id, y: segmentToFullRows(baseline, active, segment.kept) }
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
    const segToRow = segmentRows(ds, seg.kept);
    const offsets = baselineOn && baseline ? baseline : null;
    const c = res.curves;
    const curve = { datasetId: ds.id, y: curveToRows(c.x, c.model, seg.x, segToRow, n, offsets) };
    const bg = res.background.kind === "none" && !offsets
      ? null
      : { datasetId: ds.id, y: curveToRows(c.x, c.background, seg.x, segToRow, n, offsets) };
    own.current = { fit: curve, bg };
    setFitOverlay(curve);
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

  // A lazy Origin book still showing its downsampled PREVIEW (`pending`,
  // lib/types.ts): activating it only STARTS the full-data fetch
  // (useApp.setActive -> ensureBookData, not awaited), and the wizard resolves
  // it only on the baseline path, so a fit can run on the preview. Its values
  // and fingerprint would describe rows the saved dataset does not have, and
  // every reader would later drop the table silently — refuse instead. When
  // the full data lands, `active.data` changes, the content key moves and the
  // preview fit is dropped anyway, so a re-fit is all it takes.
  const publishBlock = !active
    ? "select a dataset first"
    : active.pending
      ? "this dataset's full data is still loading — the fit ran on its preview; Re-fit once it has loaded"
      : modelFitPublishBlock(ran?.result ?? null, stale);
  // Publish (audit P2.1): the draft is built here, the lazy half (ids,
  // exclusions, store write) loads on demand — ./modelFitPublish's header says
  // why. `seq` guards the await: a reset or a new run in the meantime means
  // this result is no longer the one on screen. A failure (the chunk will not
  // load, the store write throws) is shown, never swallowed.
  const publishToTable = async () => {
    const res = ran?.result;
    if (!active || !segment || !res || publishBlock) {
      if (publishBlock) setError(publishBlock);
      return;
    }
    const offsets = baselineOn && baseline ? baseline : null;
    const xs = segment.x;
    const draft = modelFitDraft(res, {
      recipe: inp.recipe ?? null,
      offsetAt: offsets ? (x) => interpolateAt(xs, offsets, x) : null,
    });
    const id = seq.current;
    try {
      const { publishModelFit } = await import("./modelFitPublishRun");
      if (seq.current !== id) return;
      const n = publishModelFit(active.id, xKey, draft);
      if (n !== null) toast(`published ${n} peak(s) to the peak table of ${active.name}`);
    } catch (e) {
      if (seq.current === id) setError(`could not publish to the peak table — ${e instanceof Error ? e.message : "unknown error"}`);
    }
  };

  const shared = fwhmShared(setup.params);
  return {
    engine,
    // Switching engine is a configuration change: `engine` is in the content
    // key, so the model's result and its plot curves go (the classic engine
    // draws none).
    setEngine: (e) => {
      if (e !== engine) setFit((f) => ({ ...f, engine: e }));
    },
    setup,
    shapeNote: shapeFromGlobal(model.shape) === "pseudo_voigt" && model.shape !== "Pseudo-Voigt"
      ? `${model.shape} has no mixed-model equivalent: peaks start as pseudo-Voigt (use the Classic engine for ${model.shape})`
      : null,
    bgNote: backgroundNote(model.bgDegree),
    setShape,
    setBackground: (bg: ModelBackground) => setFit((f) => ({ ...f, background: bg })),
    patch: (name, p) => edit(patchParam(setup, name, p)),
    fwhmShared: shared,
    // A flag, not tie edits (./peakModelParams `withShareFwhm`).
    toggleShareFwhm: () => setFit((f) => withShareFwhm(f, setup, !shared)),
    // Back to the seeded defaults: every shape, background and table edit
    // goes; the engine choice is not a table edit and stays.
    resetSetup: () => setFit((f) => ({ ...DEFAULT_FIT, engine: f.engine })),
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
    publishBlock,
    publish: publishToTable,
    clear,
  };
}
