// Peak Analyzer wizard (#31 + #32) — state hook. Orchestrates the 5-step flow
// over the calc endpoints (the fit step's default engine is the mixed-shape
// /api/peaks/model-fit, audit P2.4 — see useModelFit.ts): ① range & baseline (live
// subtract preview via the baseline overlay) → ② find peaks (auto-find params,
// include/exclude, manual add, OR click-on-plot add/remove — interaction plan
// item 5; usePeakCandidates.ts) → ③ model & constraints → ④ fit & review →
// ⑤ report (fit report, or the #32 integrate-only path). All state lives here
// (or in the hooks it composes) so Back/Next never loses edits; the whole
// configuration — since recipe v2 including the model engine, per-peak
// shapes, background and parameter-table edits (lib/peakRecipeFit.ts) —
// round-trips as a PeakRecipe (lib/peakwizard) that re-runs on another
// dataset. Reads the ANALYSIS view (rowstate.analysisData) so
// exclusions/filters are honored.
//
// "Fit this range" (the plot context menu's Peak Fitting submenu, slice 3)
// arrives as a request in store/peakFitRange.ts: the range is applied, the
// wizard goes to step ②, and peaks are found as soon as the step-① baseline
// for THAT range is in (usePeakBaseline's result is tied to its segment).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePeakBaseline } from "./usePeakBaseline";
import { usePeakCandidates, type CandidatePeak } from "./usePeakCandidates";
import { useModelFit, type ModelFitState } from "./useModelFit";
import { modelPeaksForIntegrate, usePeakWizardOutput, type IntegrateResult } from "./usePeakWizardOutput";

import { fitMultiPeak } from "../../../lib/api/peaks";
import { dropGapRows } from "../../../lib/api/finitePairs";
import {
  cutRange,
  DEFAULT_RECIPE,
  loadRecipesChecked,
  saveRecipe as persistRecipe,
  subtractBaseline,
  type PeakRecipe,
} from "../../../lib/peakwizard";
import {
  extractPeak,
  insertedAt,
  insertPeak,
  remapFitPeaks,
  removedAt,
  type PeakRecipeFit,
  type PeakSlice,
} from "../../../lib/peakRecipeFit";
import { selectedFitData } from "../../../lib/fitselection";
import type { Dataset, MultiFitResult } from "../../../lib/types";
import { recordUse } from "../../../lib/recipeIndex";
import { consumePeakFitRange, usePeakFitRange } from "../../../store/peakFitRange";
import { notifyMigrationWarnings, toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";

export type { CandidatePeak };

/** Recipe-load warnings already shown this session (see the effect below). */
const warnedRecipes = new Set<string>();

export const WIZARD_STEPS = [
  "Range & baseline",
  "Find peaks",
  "Model",
  "Fit & review",
  "Report",
] as const;

export interface PeakWizardState {
  active: Dataset | null;
  step: number;
  setStep: (i: number) => void;
  next: () => void;
  back: () => void;
  recipe: PeakRecipe;
  patchRecipe: (p: DeepPartialRecipe) => void;
  // ① baseline preview
  baselineBusy: boolean;
  baselineError: string | null;
  // ② candidates
  candidates: CandidatePeak[];
  findBusy: boolean;
  findError: string | null;
  runFind: () => Promise<void>;
  togglePeak: (i: number) => void;
  removePeak: (i: number) => void;
  /** Delete the model's peak `k` (the k-th INCLUDED candidate). */
  removeModelPeak: (k: number) => void;
  addPeakAt: (center: number) => void;
  /** True iff click-on-plot marker editing (interaction item 5) is live: step
   *  ② is showing, a dataset is active, and Escape hasn't paused it. Drives the
   *  plot's crosshair cursor + the step's status hint; PlotStage reads the
   *  actual bridge via the store's `peakWizardEdit` (null exactly when this is
   *  false). */
  markerEditActive: boolean;
  // ④ fit
  fitBusy: boolean;
  fitError: string | null;
  fitResult: MultiFitResult | null;
  runFit: () => Promise<void>;
  /** The mixed-shape model engine (audit P2.4) — the default fit engine. */
  model: ModelFitState;
  /** Step ⑤ has a CURRENT fit to report from the ACTIVE engine. */
  canReportFit: boolean;
  /** Why step ⑤ refuses to integrate/report right now (a stale model fit). */
  reportBlock: string | null;
  // ⑤ report / integrate (#32)
  integrateResult: IntegrateResult;
  runIntegrate: () => Promise<void>;
  reportBusy: boolean;
  toReport: () => Promise<void>;
  // recipes
  recipes: PeakRecipe[];
  saveRecipe: (name: string) => void;
  applyRecipe: (name: string) => void;
  /** Bumped when a saved recipe is applied — the panel keys the step bodies on
   *  this so their local field echoes re-seed from the new recipe. */
  recipeRev: number;
}

type DeepPartialRecipe = {
  [K in Exclude<keyof PeakRecipe, "fit">]?: PeakRecipe[K] extends object
    ? Partial<PeakRecipe[K]>
    : PeakRecipe[K];
};

export function usePeakWizard(): PeakWizardState {
  const active = useActiveDataset();
  const setBaselineOverlay = useApp((s) => s.setBaselineOverlay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);

  const [step, setStep] = useState(0);
  const [recipe, setRecipe] = useState<PeakRecipe>(DEFAULT_RECIPE);
  const [fitBusy, setFitBusy] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);
  const [fitResult, setFitResult] = useState<MultiFitResult | null>(null);
  const [integrateResult, setIntegrateResult] = useState<PeakWizardState["integrateResult"]>(null);
  // Saved recipes, read once; a record that cannot be read (an unknown
  // version, a malformed fit section) is skipped and said so, never guessed.
  // Each warning is shown once per session (keyed by recipe name + version +
  // what), not on every mount — StrictMode's double effect included.
  const [stored] = useState(loadRecipesChecked);
  const [recipes, setRecipes] = useState<PeakRecipe[]>(stored.recipes);
  useEffect(() => {
    const fresh = stored.warnings.filter((w) => !warnedRecipes.has(w.key));
    for (const w of fresh) warnedRecipes.add(w.key);
    notifyMigrationWarnings(fresh.map((w) => w.message));
  }, [stored]);
  const [recipeRev, setRecipeRev] = useState(0);

  const patchRecipe = useCallback((p: DeepPartialRecipe) => {
    setRecipe((r) => ({
      ...r,
      ...(p.range ? { range: { ...r.range, ...p.range } } : {}),
      ...(p.baseline ? { baseline: { ...r.baseline, ...p.baseline } } : {}),
      ...(p.find ? { find: { ...r.find, ...p.find } } : {}),
      ...(p.model ? { model: { ...r.model, ...p.model } } : {}),
      ...(p.report ? { report: { ...r.report, ...p.report } } : {}),
      // A new width link decides width sharing afresh: the Share-FWHM
      // toggle's choice (a flag, never tie edits) steps aside.
      ...(p.model?.linkMode !== undefined && p.model.linkMode !== r.model.linkMode
        ? { fit: { ...r.fit, shareFwhm: null } }
        : {}),
    }));
    // Downstream results are stale the moment the configuration changes.
    setFitResult(null);
    setIntegrateResult(null);
  }, []);
  // The model fit's edits (engine, shapes, background, parameter table) —
  // stable setters, so the candidate ops that renumber them stay stable (R9).
  const setFit = useCallback((update: (f: PeakRecipeFit) => PeakRecipeFit) =>
    setRecipe((r) => ({ ...r, fit: update(r.fit) })), []);
  // A peak leaving the model takes its edits with it; an EXCLUDED one's are
  // set aside by candidate id (session only) and come back when it is
  // re-included. The map write inside the updater is idempotent (the same
  // slice from the same `f`), so a StrictMode double call is harmless.
  const setAside = useRef(new Map<number, PeakSlice>());
  const peakLeft = useCallback((k: number, id: number, ids: readonly number[], keep: boolean) =>
    setFit((f) => {
      if (keep) setAside.current.set(id, extractPeak(f, k, ids));
      else setAside.current.delete(id);
      return remapFitPeaks(f, removedAt(k));
    }), [setFit]);
  const peakJoined = useCallback((k: number, id: number, ids: readonly number[]) =>
    setFit((f) => {
      const shifted = remapFitPeaks(f, insertedAt(k));
      const slice = setAside.current.get(id);
      return slice ? insertPeak(shifted, k, slice, ids) : shifted;
    }), [setFit]);
  const dropResults = useCallback(() => {
    setAside.current.clear(); // a new candidate list: nothing to come back
    setFitResult(null);
    setIntegrateResult(null);
  }, []);

  // The wizard's working segment: the PLOTTED X + primary Y over the analysis
  // rows (audit P1 #1), range-cut — so the whole recipe (baseline, find, fit,
  // integrate) tracks what the user sees, not time/values[0].
  const segment = useMemo(() => {
    const sel = selectedFitData(active, xKey, yKeys, seriesOrder);
    if (!sel || sel.x.length === 0) return null;
    const cut = cutRange(sel.x, sel.y, recipe.range.lo, recipe.range.hi);
    const pairs = dropGapRows(cut.x, cut.y);
    return {
      x: pairs.x,
      y: pairs.y,
      kept: pairs.keep.map((i) => cut.kept[i]!),
      gapCount: pairs.n - pairs.keep.length,
      sourceCount: pairs.n,
    };
  }, [active, xKey, yKeys, seriesOrder, recipe.range.lo, recipe.range.hi]);

  const { baseline, baselineBusy, baselineError } = usePeakBaseline(
    active,
    segment,
    recipe.baseline,
    setBaselineOverlay,
  );

  // The corrected trace every later step consumes.
  const workingY = useMemo(() => {
    if (!segment) return null;
    return baseline && recipe.baseline.method !== "none"
      ? subtractBaseline(segment.y, baseline)
      : segment.y;
  }, [segment, baseline, recipe.baseline.method]);

  const cands = usePeakCandidates({
    active, step, segment, workingY, baseline, find: recipe.find, xKey, onReplaced: dropResults, peakLeft, peakJoined,
  });
  const { candidates, runFind } = cands;

  // "Fit this range" from the plot's context menu: apply the range, go to ②,
  // then find peaks once the working trace for THAT range is ready. The armed
  // find remembers exactly what was asked (dataset + range); it fires or is
  // dropped on the first TERMINAL outcome for that range — no data (runFind
  // then says so), no baseline wanted, the baseline in, the baseline failed
  // or the dataset unavailable (usePeakBaseline reports both as an error) —
  // and is dropped the moment the dataset or range stops being the one asked
  // for, so it can never fire later on some unrelated change.
  const rangeRequest = usePeakFitRange((s) => s.request);
  const [pendingFind, setPendingFind] = useState<{ datasetId: string; lo: number; hi: number } | null>(null);
  useEffect(() => {
    if (!rangeRequest || !active) return;
    consumePeakFitRange(rangeRequest.seq);
    if (rangeRequest.datasetId !== active.id) {
      toast("that range was selected on another dataset — select it on this one to fit it", "danger");
      return;
    }
    patchRecipe({ range: { lo: rangeRequest.lo, hi: rangeRequest.hi } });
    setStep(1);
    setPendingFind({ datasetId: active.id, lo: rangeRequest.lo, hi: rangeRequest.hi });
  }, [rangeRequest, active, patchRecipe]);
  useEffect(() => {
    if (!pendingFind) return;
    const asked = active?.id === pendingFind.datasetId
      && recipe.range.lo === pendingFind.lo && recipe.range.hi === pendingFind.hi;
    if (!asked || !segment) {
      setPendingFind(null);
    } else if (segment.x.length === 0 || recipe.baseline.method === "none" || baseline !== null) {
      setPendingFind(null);
      void runFind();
    } else if (baselineError) {
      setPendingFind(null);
    }
  }, [pendingFind, active, recipe.range.lo, recipe.range.hi, recipe.baseline.method, segment, baseline, baselineError, runFind]);

  // ④ Simultaneous fit of the included candidates.
  const runFit = useCallback(async () => {
    const seeds = candidates.filter((c) => c.included);
    if (!segment || !workingY || seeds.length === 0) {
      setFitError("include at least one peak first");
      return;
    }
    setFitBusy(true);
    setFitError(null);
    try {
      if (segment.x.length === 0) throw new Error("no finite X/Y pairs are available to fit");
      if (segment.gapCount > 0) {
        toast(`${segment.gapCount} of ${segment.sourceCount} rows are gaps; they were excluded from the fit.`);
      }
      const res = await fitMultiPeak({
        x: segment.x,
        y: workingY,
        peaks: seeds.map((s) => ({ center: s.center, fwhm: s.fwhm, height: s.height })),
        model: recipe.model.shape,
        bg_degree: recipe.model.bgDegree,
        constrain: recipe.model.constrain,
        link_mode: recipe.model.linkMode,
      });
      setFitResult(res);
      setIntegrateResult(null);
    } catch (e) {
      setFitError(e instanceof Error ? e.message : "fit failed");
    } finally {
      setFitBusy(false);
    }
  }, [segment, workingY, candidates, recipe.model]);

  // The mixed-shape model engine (audit P2.4) and step ⑤ (integrate / report).
  const included = useMemo(
    () => candidates.filter((c) => c.included).map(({ center, height, bg, fwhm }) => ({ center, height, bg, fwhm })),
    [candidates],
  );
  // useModelFit invalidates its own result from a content key of these inputs
  // (dataset, included peaks, recipe model, engine, working x/y) — see its header.
  const model = useModelFit({
    active, segment, workingY, baseline, baselineOn: recipe.baseline.method !== "none",
    peaks: included, model: recipe.model, fit: recipe.fit, setFit,
    xKey, recipeName: recipe.name, baselineMethod: recipe.baseline.method,
  });
  // Step ⑤ reads the ACTIVE engine's CURRENT fit only: a stale model result
  // (table edited since) is blocked, with the reason shown there.
  const modelResult = model.engine === "model" && !model.stale ? model.result : null;
  const reportBlock = model.engine === "model" && model.stale
    ? "the model table changed since the last fit — re-fit in step 4 before integrating or reporting"
    : null;
  // An integration seeded from a fit that is gone, replaced or stale — or
  // from the other engine — describes nothing current.
  useEffect(() => setIntegrateResult(null), [modelResult, model.engine]);
  const classicResult = model.engine === "classic" ? fitResult : null;
  const fitted = useMemo(
    () => (modelResult ? modelPeaksForIntegrate(modelResult) : classicResult?.peaks.length ? classicResult.peaks : null),
    [modelResult, classicResult],
  );
  const { runIntegrate, reportBusy, toReport } = usePeakWizardOutput({
    active, segment, workingY, fitted, candidates, classicResult, modelResult,
    report: recipe.report, integrateResult, setIntegrateResult, setBusy: setFitBusy, setError: setFitError,
    blocked: reportBlock,
  });

  // `recipe.fit` IS the live model configuration (useModelFit edits it in
  // place), so a saved recipe carries the engine, shapes and table as shown.
  // A table the loader would have to repair (or the backend would refuse) is
  // not saved: the reason is the first parameter problem. Nor is a save onto
  // the name of a stored record this app cannot read (lib/peakwizard).
  const saveRecipe = (name: string) => {
    if (model.problems.length > 0) {
      toast(`recipe not saved — fix the parameter table first: ${model.problems[0]}`, "danger");
      return;
    }
    const named = { ...recipe, name };
    try {
      setRecipes(persistRecipe(named));
    } catch (e) {
      toast(`recipe not saved — ${e instanceof Error ? e.message : "storage refused it"}`, "danger");
      return;
    }
    setRecipe(named);
    toast(`recipe "${name}" saved`);
  };

  const applyRecipe = (name: string) => {
    const r = recipes.find((x) => x.name === name);
    if (!r) return;
    // P3.5 "recently used" — after the existence guard, so applying a recipe
    // that is already gone records nothing.
    recordUse({ kind: "peak", scope: "global", id: r.name });
    setRecipe(r);
    cands.clearCandidates();
    setAside.current.clear();
    setFitResult(null);
    setIntegrateResult(null);
    setStep(0);
    setRecipeRev((n) => n + 1);
  };

  return {
    active,
    step,
    setStep,
    next: () => setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1)),
    back: () => setStep((s) => Math.max(s - 1, 0)),
    recipe,
    patchRecipe,
    baselineBusy,
    baselineError,
    candidates,
    findBusy: cands.findBusy,
    findError: cands.findError,
    runFind,
    togglePeak: cands.togglePeak,
    removePeak: cands.removePeak,
    removeModelPeak: cands.removeModelPeak,
    addPeakAt: cands.addPeakAt,
    markerEditActive: cands.markerEditActive,
    fitBusy,
    fitError,
    fitResult,
    runFit,
    model,
    canReportFit: modelResult !== null || classicResult !== null,
    reportBlock,
    integrateResult,
    runIntegrate,
    reportBusy,
    toReport,
    recipes,
    saveRecipe,
    applyRecipe,
    recipeRev,
  };
}
