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
//
// PUBLISH (audit P2.1 uncertainties). "Publish to peak table" writes the
// CURRENT, converged result as the dataset's durable `PeakTable`, standard
// errors and shapes included (./modelFitPeakTable). What the table needs
// beyond the response is captured WHEN THE FIT LANDS — the dataset's data
// fingerprint, the x channel, the recipe name and baseline method, the
// background under each centre — never re-read at publish time, when the
// inputs may have moved on. Replacing an existing table asks first (a narrow
// range fit would otherwise silently shrink a full-pattern table), one
// publish runs at a time, and a failure is reported, never swallowed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fitPeakModel, type PeakModelFitResponse } from "../../../lib/api/peaks";
import { peakDataFingerprint } from "../../../lib/peakTableFit";
import type { PeakRecipe } from "../../../lib/peakwizard";
import { DEFAULT_FIT, type FitEngine, type PeakRecipeFit } from "../../../lib/peakRecipeFit";
import type { BaselineOverlay, Dataset, FitOverlay } from "../../../lib/types";
import { askConfirm } from "../../../store/confirmDialog";
import { publishBuiltPeakTable } from "../../../store/peakTables";
import { useApp } from "../../../store/useApp";
import { curveToRows, segmentRows, segmentToFullRows } from "./modelFitOverlay";
import { modelFitPublishProblem, peakBackgrounds, peakTableFromModelFit } from "./modelFitPeakTable";
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
  /** Why the result cannot be published to the peak table, or null. */
  publishBlock: string | null;
  /** Write the result as the dataset's durable peak table (with errors). */
  publishToTable: () => Promise<void>;
  /** The last publish's outcome, cleared by any new fit, reset or table edit. */
  publishNote: { ok: boolean; text: string } | null;
  publishing: boolean;
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
  /** The recipe's fit section — the single store of the user's edits. */
  fit: PeakRecipeFit;
  setFit: (update: (fit: PeakRecipeFit) => PeakRecipeFit) => void;
  /** Provenance for a publish: the plotted x channel the segment was cut
   *  from, the recipe's name and its step-① baseline method. */
  xKey?: number | null;
  recipeName?: string;
  baselineMethod?: string;
}

/** A landed fit plus what a publish needs from the moment it landed. */
interface Ran {
  result: PeakModelFitResponse;
  setup: string;
  datasetId: string;
  fingerprint: string;
  xKey: number | null;
  recipe: string | null;
  baseline: string;
  bgAtCenter: number[];
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ran, setRan] = useState<Ran | null>(null);
  const [publishNote, setPublishNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const existingTable = useApp((s) => s.datasets.find((d) => d.id === active?.id)?.peakTable ?? null);
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
    setPublishNote(null);
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
    if (!stale) return;
    dropOverlays(true);
    setPublishNote(null); // "published" no longer describes what is on screen
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
    setPublishNote(null);
    try {
      const res = await fitPeakModel(modelFitBody(setup, segment.x, workingY), controller.signal);
      if (seq.current !== id) return; // superseded — a newer run/cancel/reset owns this panel
      dropOverlays(false);
      setRan({
        result: res, setup: sent, datasetId: active.id, fingerprint: peakDataFingerprint(active),
        xKey: inp.xKey ?? null, recipe: inp.recipeName || null, baseline: baselineOn ? inp.baselineMethod ?? "on" : "none",
        bgAtCenter: peakBackgrounds(res, segment.x, baselineOn ? baseline : null),
      });
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

  const publishBlock = !ran
    ? "fit first"
    : stale
      ? "the parameters changed since this fit — re-fit before publishing"
      : modelFitPublishProblem(ran.result);
  const publishToTable = async () => {
    if (!ran || publishBlock || publishing) return;
    const id = seq.current;
    const n = ran.result.peaks.length;
    const note = (v: { ok: boolean; text: string }) => {
      if (seq.current === id) setPublishNote(v); // else a newer fit/reset owns the panel
    };
    setPublishing(true);
    try {
      if (existingTable && !(await askConfirm(
        "Replace the peak table?",
        `This dataset already has a ${existingTable.peaks.length}-peak table ` +
          `(${existingTable.provenance.producer === "model_fit" ? "a Peak Analyzer model fit" : "from the Peaks workshop"}). ` +
          `Publishing replaces it with these ${n} peak${n === 1 ? "" : "s"}; exclusions carry over to matching peaks, ` +
          "and Undo restores the old table.",
        "Replace",
      ))) return;
      const why = await publishBuiltPeakTable(ran.datasetId, ran.fingerprint, (ds) =>
        peakTableFromModelFit(ran.result, ds, {
          xKey: ran.xKey, recipe: ran.recipe, baseline: ran.baseline,
          bgAtCenter: ran.bgAtCenter, fingerprint: ran.fingerprint,
        }, ds.peakTable));
      note(why
        ? { ok: false, text: `not published — ${why}` }
        : { ok: true, text: `published ${n} peak${n === 1 ? "" : "s"} with their errors to the peak table` });
    } catch (e) {
      note({ ok: false, text: `not published — ${e instanceof Error ? e.message : "publishing failed"}` });
    } finally {
      setPublishing(false);
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
    publishBlock,
    publishToTable,
    publishNote,
    publishing,
    startFromResult: () => {
      if (ran) edit({ ...setup, params: startFromFit(setup.params, ran.result.parameters) });
    },
    clear,
  };
}
