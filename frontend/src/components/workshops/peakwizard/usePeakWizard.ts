// Peak Analyzer wizard (#31 + #32) — state hook. Orchestrates the 5-step flow
// over the EXISTING calc endpoints (zero new math): ① range & baseline (live
// subtract preview via the baseline overlay) → ② find peaks (auto-find params,
// include/exclude, manual add, OR click-on-plot add/remove — interaction plan
// item 5) → ③ model & constraints → ④ fit & review → ⑤ report (fit report, or
// the #32 integrate-only path). All state lives here so Back/Next never loses
// edits; the whole configuration round-trips as a PeakRecipe (lib/peakwizard)
// that re-runs on another dataset. Reads the ANALYSIS view
// (rowstate.analysisData) so exclusions/filters are honored.

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  baselineALS,
  baselineModPoly,
  baselineRollingBall,
  findPeaks,
  fitMultiPeak,
  peaksIntegrate,
  reportEmit,
  type IntegratedPeak,
} from "../../../lib/api";
import { visiblePeakMarkers } from "../../../lib/peakMarkerHit";
import {
  cutRange,
  DEFAULT_RECIPE,
  expandToFullRows,
  loadRecipes,
  regionsFromPeaks,
  saveRecipe as persistRecipe,
  subtractBaseline,
  type PeakRecipe,
} from "../../../lib/peakwizard";
import { peakOverlayArray } from "../../../lib/plotdata";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset, MultiFitResult, Peak } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useActiveDataset, useApp } from "../../../store/useApp";

export const WIZARD_STEPS = [
  "Range & baseline",
  "Find peaks",
  "Model",
  "Fit & review",
  "Report",
] as const;

/** A peak candidate on step ②: detected or manually added, toggleable. */
export interface CandidatePeak {
  center: number;
  height: number;
  fwhm: number;
  included: boolean;
  manual: boolean;
}

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
  addPeakAt: (center: number) => void;
  /** True iff click-on-plot marker editing (interaction item 5) is live: step
   *  ② is showing, a dataset is active, and Escape hasn't paused it (see the
   *  suppression effect below). Drives the plot's crosshair cursor + the
   *  step's status hint; PlotStage reads the actual bridge via the store's
   *  `peakWizardEdit` (null exactly when this is false). */
  markerEditActive: boolean;
  // ④ fit
  fitBusy: boolean;
  fitError: string | null;
  fitResult: MultiFitResult | null;
  runFit: () => Promise<void>;
  // ⑤ report / integrate (#32)
  integrateResult: { peaks: IntegratedPeak[]; total_area: number } | null;
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
  [K in keyof PeakRecipe]?: PeakRecipe[K] extends object
    ? Partial<PeakRecipe[K]>
    : PeakRecipe[K];
};

export function usePeakWizard(): PeakWizardState {
  const active = useActiveDataset();
  const addReport = useApp((s) => s.addReport);
  const setBaselineOverlay = useApp((s) => s.setBaselineOverlay);
  const setPeakOverlay = useApp((s) => s.setPeakOverlay);
  const setPeakWizardEdit = useApp((s) => s.setPeakWizardEdit);

  const [step, setStep] = useState(0);
  const [recipe, setRecipe] = useState<PeakRecipe>(DEFAULT_RECIPE);
  const [baseline, setBaseline] = useState<(number | null)[] | null>(null);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidatePeak[]>([]);
  const [findBusy, setFindBusy] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [fitBusy, setFitBusy] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);
  const [fitResult, setFitResult] = useState<MultiFitResult | null>(null);
  const [integrateResult, setIntegrateResult] = useState<PeakWizardState["integrateResult"]>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [recipes, setRecipes] = useState<PeakRecipe[]>(() => loadRecipes());
  const [recipeRev, setRecipeRev] = useState(0);
  // Click-on-plot marker editing (item 5): Escape pauses the mode without
  // leaving step ②; re-entering the step (or any step change and back) resets
  // it, so the pause never outlives the step it was raised on.
  const [editSuppressed, setEditSuppressed] = useState(false);

  const patchRecipe = useCallback((p: DeepPartialRecipe) => {
    setRecipe((r) => ({
      ...r,
      ...(p.range ? { range: { ...r.range, ...p.range } } : {}),
      ...(p.baseline ? { baseline: { ...r.baseline, ...p.baseline } } : {}),
      ...(p.find ? { find: { ...r.find, ...p.find } } : {}),
      ...(p.model ? { model: { ...r.model, ...p.model } } : {}),
      ...(p.report ? { report: { ...r.report, ...p.report } } : {}),
    }));
    // Downstream results are stale the moment the configuration changes.
    setFitResult(null);
    setIntegrateResult(null);
  }, []);

  // The wizard's working segment: analysis rows (x, first channel), range-cut.
  const segment = useMemo(() => {
    const d = analysisData(active);
    if (!d || d.time.length === 0) return null;
    const y = d.values.map((row) => row[0]);
    return cutRange(d.time, y, recipe.range.lo, recipe.range.hi);
  }, [active, recipe.range.lo, recipe.range.hi]);

  // ① Baseline on the working segment; overlays onto the FULL plot x.
  useEffect(() => {
    setBaseline(null);
    setBaselineError(null);
    if (!active || !segment || segment.x.length === 0) {
      setBaselineOverlay(null);
      return;
    }
    if (recipe.baseline.method === "none") {
      setBaselineOverlay(null);
      return;
    }
    let cancelled = false;
    setBaselineBusy(true);
    const activeId = active.id;
    const b = recipe.baseline;
    void (async () => {
      try {
        // #38 deferred edge: auto-baseline must never run on the small
        // preview — resolve the active dataset's full data first (a no-op
        // if it isn't pending). The working `segment` itself is unaffected
        // (recomputed reactively once `active` swaps), so this only guards
        // the eagerly-fired first step.
        const ds = await useApp.getState().resolveDataset(activeId);
        if (cancelled || !ds) return;
        const res = await (b.method === "als"
          ? baselineALS({ y: segment.y, lam: b.lam, p: b.p })
          : b.method === "rollingball"
            ? baselineRollingBall({ y: segment.y, radius: b.radius })
            : baselineModPoly({ y: segment.y, order: b.order }));
        if (cancelled) return;
        setBaseline(res.baseline);
        setBaselineOverlay({
          datasetId: ds.id,
          y: expandToFullRows(res.baseline, segment.kept, ds.data.time.length),
        });
      } catch (e: unknown) {
        if (!cancelled) setBaselineError(e instanceof Error ? e.message : "baseline failed");
      } finally {
        if (!cancelled) setBaselineBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, segment, recipe.baseline, setBaselineOverlay]);

  // The corrected trace every later step consumes.
  const workingY = useMemo(() => {
    if (!segment) return null;
    return baseline && recipe.baseline.method !== "none"
      ? subtractBaseline(segment.y, baseline)
      : segment.y;
  }, [segment, baseline, recipe.baseline.method]);

  // ② Find peaks on the corrected segment; markers overlay on the full x.
  const runFind = useCallback(async () => {
    if (!active || !segment || !workingY) return;
    setFindBusy(true);
    setFindError(null);
    try {
      const res = await findPeaks({
        x: segment.x,
        y: workingY,
        snr_threshold: recipe.find.snr_threshold,
        ...(recipe.find.min_prominence > 0
          ? { min_prominence: recipe.find.min_prominence }
          : {}),
        max_peaks: recipe.find.max_peaks,
      });
      const found: CandidatePeak[] = res.peaks.map((p: Peak) => ({
        center: p.center,
        height: p.height,
        fwhm: p.fwhm,
        included: true,
        manual: false,
      }));
      setCandidates(found);
      setFitResult(null);
      setIntegrateResult(null);
    } catch (e) {
      setFindError(e instanceof Error ? e.message : "peak find failed");
    } finally {
      setFindBusy(false);
    }
  }, [active, segment, workingY, recipe.find]);

  // Keep the marker overlay in sync with the included candidates.
  useEffect(() => {
    if (!active || candidates.length === 0) return;
    const included = candidates.filter((c) => c.included);
    setPeakOverlay({
      datasetId: active.id,
      y: peakOverlayArray(
        active.data.time,
        included.map((p) => ({ center: p.center, height: p.height })),
      ),
    });
  }, [active, candidates, setPeakOverlay]);

  const togglePeak = (i: number) =>
    setCandidates((cs) => cs.map((c, j) => (j === i ? { ...c, included: !c.included } : c)));
  const removePeak = (i: number) => setCandidates((cs) => cs.filter((_, j) => j !== i));
  const addPeakAt = (center: number) => {
    if (!segment || !workingY || segment.x.length === 0) return;
    // Seed height from the nearest working point; FWHM from 2% of the range.
    let nearest = 0;
    for (let i = 1; i < segment.x.length; i++) {
      if (Math.abs(segment.x[i] - center) < Math.abs(segment.x[nearest] - center)) nearest = i;
    }
    const span = segment.x[segment.x.length - 1] - segment.x[0];
    setCandidates((cs) => [
      ...cs,
      {
        center,
        height: workingY[nearest],
        fwhm: span / 50 || 1,
        included: true,
        manual: true,
      },
    ]);
  };

  // Click-on-plot marker editing (interaction item 5, deferred from closed
  // gap #31): live only while step ② is showing, a dataset is active, and
  // Escape hasn't paused it. `addPeakAt`/`removePeak` above are the SAME
  // functions the manual "+ Add" field and the candidate table's "×" button
  // use — no parallel state model. This hook stays the sole owner of
  // `candidates`; the store only carries a thin, disposable projection
  // (visible marker positions + these two callbacks) so PlotStage's plugin
  // can hit-test a click without needing its own copy of the wizard state.
  const markerEditActive = step === 1 && !!active && !editSuppressed;

  // Escape pauses the mode (mirrors useGadgetChip's Escape-to-dismiss) without
  // navigating away from step ②; re-entering the step below un-pauses it.
  useEffect(() => {
    if (step !== 1 || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditSuppressed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, active]);

  // Any step change resets the pause — so it never outlives the visit to ②
  // that raised it, and returning to ② always starts un-paused.
  useEffect(() => {
    setEditSuppressed(false);
  }, [step]);

  // Push the current bridge into the store on every render while active (so a
  // stale `segment`/`workingY` closure — e.g. a baseline recompute landing
  // without the candidate list itself changing — can never leave `addPeakAt`
  // out of sync with what the manual "+ Add" field in step ② would use); a
  // full unmount (wizard closed) always clears it.
  useEffect(() => {
    setPeakWizardEdit(
      markerEditActive
        ? { markers: visiblePeakMarkers(candidates), addPeakAt, removePeak }
        : null,
    );
  }, [markerEditActive, candidates, addPeakAt, removePeak, setPeakWizardEdit]);
  useEffect(() => () => setPeakWizardEdit(null), [setPeakWizardEdit]);

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

  // ⑤ Integrate-only path (#32): regions from the best peak positions we have.
  const runIntegrate = useCallback(async () => {
    if (!segment || !workingY) return;
    const source = fitResult?.peaks?.length
      ? fitResult.peaks
      : candidates.filter((c) => c.included);
    if (source.length === 0) {
      setFitError("no peaks to integrate — find or fit peaks first");
      return;
    }
    setFitBusy(true);
    setFitError(null);
    try {
      const regions = regionsFromPeaks(
        source.map((p) => ({ center: p.center, fwhm: p.fwhm })),
        recipe.report.regionWidth,
        segment.x[0],
        segment.x[segment.x.length - 1],
      );
      const res = await peaksIntegrate({ x: segment.x, y: workingY, regions });
      setIntegrateResult({ peaks: res.peaks, total_area: res.total_area });
    } catch (e) {
      setFitError(e instanceof Error ? e.message : "integration failed");
    } finally {
      setFitBusy(false);
    }
  }, [segment, workingY, fitResult, candidates, recipe.report.regionWidth]);

  // ⑤ Land the result as a #36 report (fit table or integration table).
  const toReport = useCallback(async () => {
    if (!active) return;
    setReportBusy(true);
    try {
      const refs = [{ kind: "dataset", id: active.id, name: active.name }];
      if (recipe.report.mode === "integrate" && integrateResult) {
        const { report } = await reportEmit({
          kind: "integrate",
          result: integrateResult as unknown as Record<string, unknown>,
          title: `Peak integration — ${active.name}`,
          source_refs: refs,
        });
        addReport(`Peak integration — ${active.name}`, report, active.id);
      } else if (fitResult) {
        const { report } = await reportEmit({
          kind: "multipeak_fit",
          result: fitResult as unknown as Record<string, unknown>,
          title: `Peak analysis — ${active.name}`,
          source_refs: refs,
        });
        addReport(`Peak analysis — ${active.name}`, report, active.id);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "report failed", "danger");
    } finally {
      setReportBusy(false);
    }
  }, [active, recipe.report.mode, integrateResult, fitResult, addReport]);

  const saveRecipe = (name: string) => {
    const named = { ...recipe, name };
    setRecipe(named);
    setRecipes(persistRecipe(named));
    toast(`recipe "${name}" saved`);
  };

  const applyRecipe = (name: string) => {
    const r = recipes.find((x) => x.name === name);
    if (!r) return;
    setRecipe(r);
    setCandidates([]);
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
    findBusy,
    findError,
    runFind,
    togglePeak,
    removePeak,
    addPeakAt,
    markerEditActive,
    fitBusy,
    fitError,
    fitResult,
    runFit,
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
