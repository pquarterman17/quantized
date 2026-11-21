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

import { fullPlottedX, plottedYKey } from "../../../lib/fitselectionActions";
import { ownXKey } from "../../../lib/perSeriesX";
import { magXAxis } from "../../../lib/magDataKind";
import { armRegionPick, regionPickOwner, regionPickTaken, releaseRegionPick } from "../../../lib/regionPickOwner";
import type { BaselineOverlay, CorrectionParams, Dataset, DataStruct } from "../../../lib/types";
import { rememberBaselineFull } from "../../../store/fitOverlayUpgrade";
import { nextDatasetId, useActiveDataset, useApp } from "../../../store/useApp";
import { callBaseline, callBaselinePreview } from "./baselineCall";
import { bgSubName, commitBaselineBatch, subtractBaselineData } from "./baselineBatch";

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

export interface BaselineBinding {
  datasetId: string;
  xKey: number | null;
  yKey: number;
  xLabel: string;
  yLabel: string;
}

interface BaselineInput {
  binding: BaselineBinding;
  x: number[];
  y: number[];
}

function baselineInput(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): BaselineInput | null {
  const yKey = plottedYKey(ds, xKey, yKeys, seriesOrder);
  if (yKey == null) return null;
  // A secondary-X Y (R2 in T1,R1,T2,R2) is estimated against its OWN X.
  const ownX = ownXKey(ds, xKey, yKey);
  const x = fullPlottedX(ds.data, ownX);
  const y = ds.data.values.map((row) => row[yKey]);
  if (x.length === 0 || x.length !== y.length) return null;
  return {
    binding: {
      datasetId: ds.id,
      xKey: ownX,
      yKey,
      xLabel: ownX == null ? magXAxis(ds.data, null).label || "Time" : (ds.data.labels[ownX] ?? `Channel ${ownX + 1}`),
      yLabel: ds.data.labels[yKey] ?? `Channel ${yKey + 1}`,
    },
    x,
    y,
  };
}

/** Batch target: the SAME channels (by column label) as the active binding; the
 *  plot's index-based selection means something else in another column layout. */
function batchInput(ds: Dataset, ref: BaselineBinding | null): BaselineInput | string {
  if (!ref) return "select a plotted Y channel first";
  const yKey = ds.data.labels.indexOf(ref.yLabel);
  const xKey = ref.xKey == null ? null : ds.data.labels.indexOf(ref.xLabel);
  if (yKey < 0 || xKey === -1) return `${ds.name}: no "${yKey < 0 ? ref.yLabel : ref.xLabel}" column`;
  return baselineInput(ds, xKey, [yKey], null) ?? `${ds.name}: no usable Y channel`;
}

export function useBaseline(): BaselineState {
  const active = useActiveDataset();
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const setBaselineOverlay = useApp((s) => s.setBaselineOverlay);
  const setPlotTool = useApp((s) => s.setPlotTool);
  const regionPicked = useApp((s) => s.regionPicked);
  const setRegionPicked = useApp((s) => s.setRegionPicked);
  const setBaselineAnchorEdit = useApp((s) => s.setBaselineAnchorEdit);
  const [method, setMethod] = useState<BaselineMethod>("als");
  const [params, setParamsState] = useState<BaselineParams>(DEFAULTS);
  const [baseline, setBaseline] = useState<(number | null)[] | null>(null);
  // A lean (large SNIP / ModPoly) preview holds only display rows in `baseline`;
  // the full array, which Subtract needs, comes from here (by result id).
  const fullRef = useRef<(() => Promise<(number | null)[]>) | null>(null);
  useEffect(() => {
    if (!baseline) fullRef.current = null;
  }, [baseline]);
  const [estimateBinding, setEstimateBinding] = useState<BaselineBinding | null>(null);
  const [anchors, setAnchors] = useState<[number, number][]>([]);
  const [busy, setBusy] = useState(false);
  const selectedCount = useApp((s) => s.selectedIds.length);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const liveIds = useApp((s) => s.datasets.filter((d) => batchIds.includes(d.id)).map((d) => d.id).join("|"));
  const [error, setError] = useState<string | null>(null);
  const binding = active ? baselineInput(active, xKey, yKeys, seriesOrder)?.binding ?? null : null;
  // The debounced anchor-preview effect must re-estimate with the LATEST
  // anchors without holding compute() in its dependency list (a fresh closure
  // every render would defeat the debounce) — the shared plugin-bridge idiom.
  const computeRef = useRef<() => Promise<void>>(async () => {});
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
    setBaseline(null);
    setEstimateBinding(null);
    setError(null);
    setAnchors([]);
    setBaselineOverlay(null);
  }, [active, xKey, yKeys, seriesOrder, setBaselineOverlay]);

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
      setError("place at least 2 anchors on the plot");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // #38 deferred edge: never estimate a baseline against the small
      // preview — resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const state = useApp.getState();
      const input = baselineInput(ds, state.xKey, state.yKeys, state.seriesOrder);
      if (!input) throw new Error("the plotted X/Y selection has no usable primary Y channel");
      const { x, y } = input;
      const res = await callBaselinePreview(method, x, y, params, anchors);
      fullRef.current = res.full ?? null;
      setBaseline(res.baseline);
      setEstimateBinding(input.binding);
      const overlay: BaselineOverlay = {
        datasetId: ds.id, binding: { yKey: input.binding.yKey, xKey: input.binding.xKey }, y: res.baseline,
        ...(res.full ? { lean: true as const } : {}),
      };
      if (res.full) rememberBaselineFull(overlay, res.full); // exports fetch it (store/fitOverlayUpgrade)
      setBaselineOverlay(overlay);
    } catch (e) {
      setError(e instanceof Error ? e.message : "baseline failed");
    } finally {
      setBusy(false);
    }
  }
  computeRef.current = compute;

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

  // Anchor mode (#2): live preview — re-estimate (debounced) as anchors are
  // placed/dragged; drop the overlay when there aren't enough anchors yet.
  useEffect(() => {
    if (method !== "anchor") return;
    if (!active || anchors.length < 2) {
      setBaseline(null);
      setBaselineOverlay(null);
      return;
    }
    const t = setTimeout(() => void computeRef.current(), 150);
    return () => clearTimeout(t);
  }, [method, anchors, params.anchorMethod, active, setBaselineOverlay]);

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

  /** Subtract into a new dataset; false when nothing was written. */
  async function subtractInto(): Promise<boolean> {
    if (!active || !baseline || !estimateBinding) return false;
    const ds = await resolveActive(active.id);
    if (!ds) return false;
    let full = baseline;
    if (fullRef.current) {
      try {
        full = await fullRef.current();
      } catch (e) {
        setError(`couldn't fetch the baseline — ${e instanceof Error ? e.message : "error"}`);
        return false;
      }
    }
    if (estimateBinding.datasetId !== ds.id || full.length !== ds.data.values.length) {
      setError("the baseline no longer matches this dataset; recompute it before subtracting");
      return false;
    }
    const data = subtractBaselineData(ds.data, full, estimateBinding, method);
    addDataset({ id: nextDatasetId(), name: bgSubName(ds.name), data });
    setStatus(`subtracted ${method} baseline`);
    return true;
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
    const outputs: { name: string; data: DataStruct }[] = [];
    const sources: Dataset[] = [];
    try {
      for (const id of ids) {
        const ds = await useApp.getState().resolveDataset(id);
        if (!ds) throw new Error("a selected dataset could not be loaded");
        const input = batchInput(ds, binding);
        if (typeof input === "string") throw new Error(input);
        const res = await callBaseline(method, input.x, input.y, params, anchors).catch((e: unknown) => {
          throw new Error(`${ds.name}: ${e instanceof Error ? e.message : "baseline failed"}`);
        });
        outputs.push({ name: bgSubName(ds.name), data: subtractBaselineData(ds.data, res.baseline, input.binding, method) });
        sources.push(ds);
      }
      if (outputs.length === 0) return;
      setBatchIds(commitBaselineBatch(outputs, sources, method, useApp.getState).ids);
      setStatus(`subtracted ${method} baseline from ${outputs.length} datasets`);
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
    if (estimateBinding && (estimateBinding.xKey != null || estimateBinding.yKey !== 0)) {
      if (!baseline) {
        setError("wait for the selected-channel preview, then Apply again");
        return;
      }
      if (!(await subtractInto())) return;
      setAnchors([]);
      setStatus("subtracted selected-channel anchor baseline (new dataset)");
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
      if (baseline) {
        if (!(await subtractInto())) return;
        setAnchors([]);
        setStatus("subtracted anchor baseline (new dataset - prior corrections active)");
      } else {
        setError("prior corrections active: wait for the preview, then Apply again");
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
    setBaselineOverlay(null);
    setBaseline(null);
    setAnchors([]);
    setStatus("subtracted anchor baseline (correction step)");
  }

  function clear(): void {
    setBaseline(null);
    setEstimateBinding(null);
    setError(null);
    setBaselineOverlay(null);
  }

  const clearAnchors = (): void => setAnchors([]);

  return {
    active,
    method,
    params,
    baseline,
    busy,
    error,
    anchors,
    binding,
    setMethod,
    setParams,
    compute,
    subtract,
    applyToSelected,
    selectedCount,
    batchOutputIds: liveIds ? liveIds.split("|") : [],
    clear,
    pickRegion,
    clearAnchors,
    applyAnchors,
  };
}
