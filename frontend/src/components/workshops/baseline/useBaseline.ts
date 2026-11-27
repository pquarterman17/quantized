// Baseline workshop — state hook. Estimates a slowly-varying background under the
// active dataset's first channel via /api/baseline (ALS / rolling-ball / modpoly /
// SNIP / anchors / Shirley / XRD low-angle / analytic polynomials), overlays it on
// the plot, and can subtract it into a new dataset. The GOTO #2 anchor method is
// interactive: clicks on the plot place/move/remove anchors (store bridge →
// anchorEditPlugin), the preview re-estimates debounced, and Apply subtracts
// through the store's applyCorrections chokepoint (bgAnchors params) so it rides
// the same step-executor/recalc-DAG path as every other correction — no parallel
// pipeline. The estimators are golden vs MATLAB in calc.baseline (the GOTO
// additions are reference-value tested); this hook is just orchestration.

import { useEffect, useMemo, useRef, useState } from "react";

import { armRegionPick, regionPickOwner, regionPickTaken, releaseRegionPick } from "../../../lib/regionPickOwner";
import type { BaselineOverlay, CorrectionParams, Dataset } from "../../../lib/types";
import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import { rememberBaselineFull } from "../../../store/fitOverlayUpgrade";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { useAnalysisCommit } from "../resultcommit/useAnalysisCommit";
import { useReopenSeed, useSeedHold } from "../resultcommit/useReopenSession";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";
import { baselineSeed } from "./baselineReopen";
import { baselineBinding, baselineInput, batchInput, inputToken, loadingBooks, type BaselineBinding } from "./baselineInput";
import { baselineBy, callBaseline, callBaselinePreview, type BaselinePreview } from "./baselineCall";
import { bgSubName, commitBaselineBatch, subtractBaselineData, type BaselineBatchItem } from "./baselineBatch";

const BASELINE_PRODUCER = { id: "baseline-subtract", label: "Baseline subtract", version: 1 } as const;

export type BaselineMethod =
  | "als"
  | "rollingball"
  | "modpoly"
  | "snip"
  | "region"
  | "anchor"
  | "shirley"
  | "xrdla"
  | "linear"
  | "quadratic"
  | "poly";

/** Per-method tuning knobs (only the relevant subset is shown for each method). */
export interface BaselineParams {
  lam: number; // ALS smoothness (λ)
  p: number; // ALS asymmetry
  radius: number; // rolling-ball radius
  order: number; // modpoly / region / poly-n polynomial order
  maxWindowDeg: number; // SNIP clipping window
  regionXMin: number; // region: box left edge (NaN -> data min)
  regionXMax: number; // region: box right edge (NaN -> data max)
  // Optional 2-D y-box (MATLAB `onBGMouseUp` parity, GAP #96/#20): NaN on
  // either edge means "no y constraint" (NOT "full data range" — unlike
  // regionXMin/Max, an unset y edge is omitted from the request entirely).
  regionYMin: number;
  regionYMax: number;
  maxIter: number; // Shirley iteration cap
  anchorMethod: string; // anchor interpolation: linear | pchip | spline
}

const DEFAULTS: BaselineParams = {
  lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 2.0,
  regionXMin: Number.NaN, regionXMax: Number.NaN,
  regionYMin: Number.NaN, regionYMax: Number.NaN,
  maxIter: 50, anchorMethod: "pchip",
};

export type { BaselineBinding } from "./baselineInput";

export interface BaselineState {
  active: Dataset | null;
  method: BaselineMethod;
  params: BaselineParams;
  baseline: (number | null)[] | null;
  busy: boolean;
  error: string | null;
  /** Anchor method (#2): the picked (x, y) anchors, in click order. */
  anchors: [number, number][];
  /** Plotted channels the next estimate will use. */
  binding: BaselineBinding | null;
  setMethod: (m: BaselineMethod) => void;
  setParams: (patch: Partial<BaselineParams>) => void;
  compute: () => Promise<void>;
  subtract: () => Promise<void>;
  /** "Apply to N selected": the same method + params on every selected dataset,
   *  outputs grouped in one folder, ONE undo entry. */
  applyToSelected: () => Promise<void>;
  /** The panel started from a reopened result's settings (they outrank a preset). */
  fromResult: boolean;
  /** An estimate is being computed. */
  estimating: boolean;
  /** The shown estimate was computed for a different method, knobs, anchors or input. */
  estimateStale: boolean;
  /** Why "Subtract → new worksheet" is unavailable (stale, already added, adding now); null when enabled. */
  subtractDisabledReason: string | null;
  /** The output a commit replaces (opened from its result, Replace chosen), else null. */
  replacing: string | null;
  /** Datasets selected in the Library (the batch targets). */
  selectedCount: number;
  /** The batch's output dataset ids still in the Library (for "Overlay these"). */
  batchOutputIds: string[];
  clear: () => void;
  /** Arm the plot's rubber-band so the next drag fills the region box edges. */
  pickRegion: () => void;
  clearAnchors: () => void;
  /** Anchor method (#2): subtract via the corrections chokepoint (bgAnchors
   *  params) — records a replayable correction step + rides the recalc DAG. */
  applyAnchors: () => Promise<void>;
}

/** One estimate, with exactly what it was computed on (the shell keys it). */
interface Estimate extends BaselinePreview {
  binding: BaselineBinding;
  /** The source's analysis-view fingerprint: the shared commit refuses a source that changed since. */
  fp: string;
}

export function useBaseline(): BaselineState {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const setStatus = useApp((s) => s.setStatus);
  const setBaselineOverlay = useApp((s) => s.setBaselineOverlay);
  const setPlotTool = useApp((s) => s.setPlotTool);
  const regionPicked = useApp((s) => s.regionPicked);
  const setRegionPicked = useApp((s) => s.setRegionPicked);
  const setBaselineAnchorEdit = useApp((s) => s.setBaselineAnchorEdit);
  // "Open in Baseline" (lane RO): start from the recorded method, knobs, anchors.
  const seed = useReopenSeed(BASELINE_PRODUCER.id, active?.id);
  const [seeded] = useState(() => baselineSeed(seed?.settings, DEFAULTS));
  const holdSeed = useSeedHold(!!seeded, [active, xKey, yKeys, seriesOrder]);
  const [method, setMethod] = useState<BaselineMethod>(seeded?.method ?? "als");
  const [params, setParamsState] = useState<BaselineParams>(seeded?.params ?? DEFAULTS);
  const [anchors, setAnchors] = useState<[number, number][]>(seeded?.method === "anchor" ? seeded.anchors : []);
  const [batchBusy, setBusy] = useState(false);
  const selectedCount = useApp((s) => s.selectedIds.length);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const liveIds = useApp((s) => s.datasets.filter((d) => batchIds.includes(d.id)).map((d) => d.id).join("|"));
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null); // the estimate is not ready yet
  const binding = active ? baselineBinding(active, xKey, yKeys, seriesOrder) : null;
  // The estimate rides the shared workbench shell (../workbench): keyed on
  // every input it is computed from, so an answer for older inputs is never
  // current (Subtract then says why) and one that lands after a change, a
  // Clear or Close is dropped. Estimate is a button (manual); the anchor
  // method re-estimates itself, debounced, as anchors are placed or dragged.
  const inputKey = active ? JSON.stringify([inputToken(active), xKey, yKeys, seriesOrder]) : "";
  const preview = useWorkbenchPreview<Estimate>({
    key: active ? JSON.stringify([inputKey, method, params, method === "anchor" ? anchors : null]) : "",
    auto: method === "anchor" && anchors.length >= 2,
    delayMs: 150,
    fallbackError: "baseline failed",
    run: async () => {
      // #38 deferred edge: never estimate a baseline against the small
      // preview — resolve the active dataset's full data first. A book's
      // load swaps its Dataset object; the loaded one keeps this input token
      // (baselineInput.ts), so the swap does not abort or reset this run.
      if (!active) throw new Error("select a dataset first");
      if (active.pending) loadingBooks.set(active.id, inputToken(active));
      let ds: Dataset | undefined;
      try {
        ds = await useApp.getState().resolveDataset(active.id);
        if (ds) inputToken(ds); // claim the token even if no render ran yet
      } finally {
        loadingBooks.delete(active.id);
      }
      if (!ds) throw new Error("the dataset is no longer available");
      const state = useApp.getState();
      const input = baselineInput(ds, state.xKey, state.yKeys, state.seriesOrder);
      if (typeof input === "string") throw new Error(input);
      const res = await callBaselinePreview(method, input.x, input.y, params, anchors, baselineBy(ds.data, input.binding.xKey, input.binding.yKey));
      return { ...res, binding: input.binding, fp: analysisDataFingerprint(ds) };
    },
  });
  const shown = preview.latest?.value ?? null; // possibly stale: still drawn, never subtracted
  const fresh = preview.current;
  const baseline = shown?.baseline ?? null;
  const discard = preview.discard;
  const busy = batchBusy || preview.running;
  // MAIN #8f: the bridge exposes anchors through a GETTER so the bridge's own
  // identity can stay stable across edits (PlotViewport tears down + rebuilds
  // the uPlot instance whenever the bridge reference changes). The memo keeps
  // the array identity stable per `anchors` state so the plugin's per-scale
  // pixel cache holds across unrelated re-renders.
  const anchorPoints = useMemo(() => anchors.map(([x, y], index) => ({ index, x, y })), [anchors]);
  const anchorPointsRef = useRef(anchorPoints);
  anchorPointsRef.current = anchorPoints;

  // A new active dataset invalidates the current estimate + its overlay (and
  // the anchors — they're coordinates on the OLD data).
  useEffect(() => {
    if (holdSeed()) return; // keep a reopen's recorded anchors
    discard();
    setError(null);
    setHint(null);
    setAnchors([]);
    setBaselineOverlay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, setBaselineOverlay, discard]);

  const setParams = (patch: Partial<BaselineParams>): void =>
    setParamsState((p) => ({ ...p, ...patch }));

  // The plot's rubber-band writes its pick to the store (x always, y only
  // for a genuine 2-D box drag); pull it into the box-edge params (already
  // ordered + clamped) and consume it once. A fresh pick always sets BOTH
  // y edges (to NaN when yRange is absent) rather than only setting them
  // when present — otherwise an x-only re-drag after an earlier box pick
  // would silently keep masking against the stale y-box.
  useEffect(() => {
    // Curve Fit's drag (armed, or just taken there), not ours.
    if (!regionPicked || regionPickOwner() === "curvefit" || regionPickTaken(regionPicked)) return;
    releaseRegionPick("baseline", regionPicked);
    const [xLo, xHi] = regionPicked.x;
    const [yLo, yHi] = regionPicked.yRange ?? [Number.NaN, Number.NaN];
    setParamsState((p) => ({ ...p, regionXMin: xLo, regionXMax: xHi, regionYMin: yLo, regionYMax: yHi }));
    setRegionPicked(null);
  }, [regionPicked, setRegionPicked]);

  const pickRegion = (): void => {
    armRegionPick("baseline"); // only Baseline takes this drag
    setPlotTool("region");
  };

  async function compute(): Promise<void> {
    if (!active) return;
    if (method === "anchor" && anchors.length < 2) {
      setHint("place at least 2 anchors on the plot");
      return;
    }
    setError(null);
    setHint(null);
    await preview.refresh();
  }

  // A "the estimate is not ready" hint (e.g. "place at least 2 anchors") goes
  // once a new estimate lands, including an automatic one; other errors stay.
  // The returned `error` also masks the hint while an estimate is current, so
  // no render pairs a landed estimate with the stale hint (this effect clears
  // the state one commit later).
  useEffect(() => {
    if (fresh) setHint(null);
  }, [fresh]);

  // Draw each new estimate on the plot (a dropped answer never gets here).
  useEffect(() => {
    if (!shown || !active) return;
    const overlay: BaselineOverlay = {
      datasetId: active.id, binding: { yKey: shown.binding.yKey, xKey: shown.binding.xKey }, y: shown.baseline,
      ...(shown.full ? { lean: true as const } : {}),
    };
    if (shown.full) rememberBaselineFull(overlay, shown.full); // exports fetch it (store/fitOverlayUpgrade)
    setBaselineOverlay(overlay);
    // Only a NEW estimate redraws; `active` is read for its id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, setBaselineOverlay]);

  // Anchor mode (#2): publish the click/drag bridge for the plot's
  // anchorEditPlugin while the method is live; null it otherwise (the same
  // wizard-scoped bridge idiom as usePeakWizard's peakWizardEdit). Unlike
  // that bridge it is published ONCE per activation — `anchors` is
  // deliberately NOT a dependency; the plugin reads the live list through
  // `getAnchors` (see the AnchorEditBridge identity contract, MAIN #8f), so
  // an anchor edit no longer republishes the bridge and rebuilds the plot.
  useEffect(() => {
    if (method !== "anchor" || !active) {
      setBaselineAnchorEdit(null);
      return;
    }
    setBaselineAnchorEdit({
      getAnchors: () => anchorPointsRef.current,
      addAnchor: (x, y) => setAnchors((a) => [...a, [x, y]]),
      moveAnchor: (index, x, y) =>
        setAnchors((a) => a.map((pt, i) => (i === index ? ([x, y] as [number, number]) : pt))),
      removeAnchor: (index) => setAnchors((a) => a.filter((_, i) => i !== index)),
    });
    return () => setBaselineAnchorEdit(null);
  }, [method, active, setBaselineAnchorEdit]);

  // Anchor mode (#2): the shell re-estimates (debounced) as anchors are
  // placed/dragged; drop the estimate when there aren't enough anchors yet.
  useEffect(() => {
    if (method !== "anchor" || (active && anchors.length >= 2)) return;
    discard();
    setBaselineOverlay(null);
  }, [method, anchors, active, setBaselineOverlay, discard]);

  // The panel fires subtract/applyAnchors as `void …`: a rejected full-data
  // resolve must reach the error line or it is invisible (audit 2026-10-01).
  async function resolveActive(id: string): Promise<Dataset | undefined> {
    try {
      return await useApp.getState().resolveDataset(id);
    } catch (e) {
      setError(`couldn't load the full dataset — ${e instanceof Error ? e.message : "error"}`);
      return undefined;
    }
  }

  // One undo step, no duplicate on a repeat click, one commit while a slow
  // full-baseline fetch is pending, stale when the source changes
  // (store/analysisOutputCommit.ts). The key covers the method, its knobs, the
  // plotted channels and the estimate itself.
  // Built only from a CURRENT estimate, so method/params/anchors here are
  // exactly the ones it was computed with.
  const commit = useAnalysisCommit(active && fresh ? {
    producer: BASELINE_PRODUCER,
    sourceId: active.id,
    computedOn: fresh.fp,
    xKey: fresh.binding.xKey, // the X the baseline was estimated against (C9)
    settings: {
      method, params, binding: fresh.binding, anchors: method === "anchor" ? anchors : null,
      n: fresh.baseline.length, sum: fresh.baseline.reduce<number>((acc, b) => acc + (b ?? 0), 0),
    },
    status: `subtracted ${method} baseline`,
    output: (source) => ({ name: bgSubName(source.name), data: source.data }), // replaced by commitAsync
  } : null);

  // Last used is written by a successful subtract, never by Apply or an estimate (preset contract P4).
  const rememberRun = () => void import("./presetAdapter").then((m) => m.recordBaselineRun(method, params)).catch(() => undefined);

  /** Subtract into a new dataset (or the reopened result's output); true only when one was written. */
  async function subtractInto(): Promise<boolean> {
    if (!active || !fresh) return false;
    const { binding, baseline, full: fetchFull } = fresh;
    const outcome = await commit.commitAsync(async () => {
      const ds = await resolveActive(active.id);
      if (!ds) return null;
      let full = baseline;
      if (fetchFull) {
        try {
          full = await fetchFull();
        } catch (e) {
          setError(`couldn't fetch the baseline — ${e instanceof Error ? e.message : "error"}`);
          return null;
        }
      }
      if (binding.datasetId !== ds.id || full.length !== ds.data.values.length) {
        setError("the baseline no longer matches this dataset; recompute it before subtracting");
        return null;
      }
      return (source) => ({ name: bgSubName(source.name), data: subtractBaselineData(source.data, full, binding, method) });
    });
    const written = outcome?.kind === "created" || outcome?.kind === "replaced";
    if (written) rememberRun();
    return written;
  }

  async function subtract(): Promise<void> {
    await subtractInto();
  }

  async function applyToSelected(): Promise<void> {
    const ids = useApp.getState().selectedIds;
    if (ids.length < 2 || method === "anchor") return;
    setBusy(true);
    setError(null);
    setBatchIds([]);
    const outputs: BaselineBatchItem[] = [];
    const sources: Dataset[] = [];
    try {
      for (const id of ids) {
        const ds = await useApp.getState().resolveDataset(id);
        if (!ds) throw new Error("a selected dataset could not be loaded");
        const input = batchInput(ds, binding);
        if (typeof input === "string") throw new Error(input);
        const computedOn = analysisDataFingerprint(ds);
        const res = await callBaseline(method, input.x, input.y, params, anchors, baselineBy(ds.data, input.binding.xKey, input.binding.yKey)).catch((e: unknown) => {
          throw new Error(`${ds.name}: ${e instanceof Error ? e.message : "baseline failed"}`);
        });
        outputs.push({
          name: bgSubName(ds.name), data: subtractBaselineData(ds.data, res.baseline, input.binding, method),
          sourceId: ds.id, computedOn, settings: { method, params, binding: input.binding }, xKey: input.binding.xKey,
        });
        sources.push(ds);
      }
      if (outputs.length === 0) return;
      const written = commitBaselineBatch(outputs, sources, method, useApp.getState);
      setBatchIds(written.ids);
      if (written.refused.length) setError(`${written.refused.length} output(s) not written: ${written.refused.join("; ")}`);
      else setStatus(`subtracted ${method} baseline from ${outputs.length} datasets${written.ids.length < outputs.length ? ` (${outputs.length - written.ids.length} already added)` : ""}`);
      if (written.ids.length > 0) rememberRun();
    } catch (e) {
      setError(e instanceof Error ? e.message : "baseline failed"); // nothing was written: the batch is all-or-nothing
    } finally {
      setBusy(false);
    }
  }

  // Anchor apply (#2): merge bgAnchors into the dataset's corrections and run
  // them through the store's applyCorrections — the SAME chokepoint the
  // Corrections card, the pipeline step executor, and the recalc DAG use.
  async function applyAnchors(): Promise<void> {
    if (!active || anchors.length < 2) return;
    const ds = await resolveActive(active.id);
    if (!ds) return;
    // The established correction-DAG anchor step operates on time + values[0].
    // For any other plotted pair, subtract the exact plotted-channel preview
    // into a linked dataset instead of silently correcting the wrong channel.
    const plotted = fresh?.binding ?? binding;
    if (plotted && (plotted.xKey != null || plotted.yKey !== 0)) {
      if (!fresh) {
        setHint("wait for the selected-channel preview, then Apply again");
        return;
      }
      if (!(await subtractInto())) return;
      setAnchors([]);
      if (!commit.replacing) setStatus("subtracted selected-channel anchor baseline (new dataset)");
      return;
    }
    // Preview-consistency guard (review 2026-07-11): anchors are picked on
    // the DISPLAYED curve, but the correction replay runs at pipeline step 3
    // against RAW data - before smoothing/normalization/yOff, and silently
    // superseding an existing bgSlope/bgPoly. When any of those are active,
    // the replayed result would not match the preview; subtract the previewed
    // baseline from the displayed data into a new dataset instead (the same
    // path every data-derived method uses - preview-exact by construction).
    const c = ds.corrections ?? {};
    const displayTransformed =
      c.normMethod != null ||
      c.smoothEnabled === true ||
      (c.yOff != null && c.yOff !== 0) ||
      (c.bgSlope != null && c.bgSlope !== 0) ||
      (c.bgPoly != null && c.bgPoly.length > 0) ||
      // derivative + magnetometry unit conversion also run AFTER the anchor
      // step, so the displayed curve differs from what step 3 subtracts from
      // (review follow-up 2026-07-11).
      (c.derivativeMode != null && c.derivativeMode !== "none") ||
      c.isMag === true;
    if (displayTransformed) {
      if (fresh) {
        if (!(await subtractInto())) return;
        setAnchors([]);
        if (!commit.replacing) setStatus("subtracted anchor baseline (new dataset - prior corrections active)");
      } else {
        setHint("prior corrections active: wait for the preview, then Apply again");
      }
      return;
    }
    const params_: CorrectionParams = {
      ...(ds.corrections ?? {}),
      bgAnchors: anchors,
      bgAnchorMethod: params.anchorMethod,
    };
    const bg = ds.bgRef ? { datasetId: ds.bgRef.datasetId, interp: ds.bgRef.interp } : undefined;
    const ok = await useApp.getState().applyCorrections(ds.id, params_, bg);
    if (!ok) {
      // Store already posted the failure status; keep the anchors so the
      // user can adjust and retry instead of re-tracing (review 2026-07-11).
      return;
    }
    discard();
    setBaselineOverlay(null);
    setAnchors([]);
    setStatus("subtracted anchor baseline (correction step)");
    rememberRun();
  }

  function clear(): void {
    discard();
    setError(null);
    setHint(null);
    setBaselineOverlay(null);
  }

  const clearAnchors = (): void => setAnchors([]);

  return {
    active,
    method,
    params,
    baseline,
    busy,
    fromResult: seeded !== null,
    estimating: preview.running,
    error: error ?? (fresh ? null : hint) ?? (preview.error || null),
    anchors,
    binding,
    setMethod,
    setParams,
    compute,
    subtract,
    applyToSelected,
    estimateStale: preview.stale,
    subtractDisabledReason: !baseline ? null
      : preview.stale ? "The method, its settings or the input changed since this estimate. Estimate again to subtract."
        : commit.disabledReason,
    replacing: commit.replacing,
    selectedCount,
    batchOutputIds: liveIds ? liveIds.split("|") : [],
    clear,
    pickRegion,
    clearAnchors,
    applyAnchors,
  };
}
