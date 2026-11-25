// Curve Fit -- piecewise / convolution / ODE fit state hook (GAP_AUDIT_9 G11).
// Three opt-in model families beside the ordinary fit (which is unchanged):
//   piecewise    continuous linear segments, 1-3 breakpoints (fixed or fitted);
//   convolution  the selected registry model convolved with a Gaussian
//                instrument (width held or fitted) or a measured resolution column;
//   ode          a built-in rate-equation model (nothing the user types is run).
// Same shell as useRobustFit: manual run, a result fitted under changed inputs
// or settings is `stale`, validation failures are refusals, and the fitted
// curve becomes the fit overlay (the existing fit result path).

import { useEffect, useRef, useState } from "react";

import { restoreGapRows } from "../../../lib/api/finitePairs";
import {
  convolutionFit, odeFit, piecewiseFit,
  type ConvolutionFitResult, type OdeFitResult, type PiecewiseFitResult,
} from "../../../lib/api/fitModels";
import { fitSelectionRefusal, selectedFitData } from "../../../lib/fitselection";
import { activeRowIndices, analysisData, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { FitModel, FitOverlay } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { afterCommit } from "../workbench/afterCommit";
import { datasetInputsToken } from "../workbench/inputsKey";
import { Refusal } from "../workbench/refusal";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";
import { takeBackOverlay } from "./fitOverlayOwnership";

export type ModelsMode = "piecewise" | "convolution" | "ode";
export type OdeModelName = "first_order" | "sequential" | "logistic";

export interface ModelsSettings {
  mode: ModelsMode;
  nBreak: string;
  /** Comma-separated fixed breakpoints (blank = all estimated). */
  fixedBreaks: string;
  sigma: string;
  fitSigma: boolean;
  /** "" = Gaussian instrument; otherwise the index of the resolution column. */
  resCol: string;
  odeModel: OdeModelName;
  observe: "A" | "B" | "C";
}

const DEFAULTS: ModelsSettings = {
  mode: "piecewise", nBreak: "1", fixedBreaks: "", sigma: "", fitSigma: false, resCol: "",
  odeModel: "first_order", observe: "A",
};

export type ModelsRun =
  | { kind: "piecewise"; result: PiecewiseFitResult }
  | { kind: "convolution"; result: ConvolutionFitResult }
  | { kind: "ode"; result: OdeFitResult };

export interface ModelsFitState {
  settings: ModelsSettings;
  set: (patch: Partial<ModelsSettings>) => void;
  busy: boolean;
  error: string | null;
  refusal: boolean;
  run: ModelsRun | null;
  stale: boolean;
  go: () => Promise<void>;
}

function breakCount(text: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > 3) throw new Refusal("breakpoints must be a whole number from 1 to 3");
  return n;
}

function fixedList(text: string): number[] {
  if (text.trim() === "") return [];
  const v = text.split(",").map((t) => Number(t.trim()));
  if (v.some((n) => !Number.isFinite(n))) throw new Refusal("fixed breakpoints must be numbers separated by commas");
  return v;
}

function positiveSigma(text: string, required: boolean): number | undefined {
  if (text.trim() === "") {
    if (required) throw new Refusal("enter the instrument width (Gaussian sigma)");
    return undefined;
  }
  const v = Number(text);
  if (!Number.isFinite(v) || v <= 0) throw new Refusal("instrument sigma must be a positive number");
  return v;
}

export function useModelsFit(modelName: string, model: FitModel | undefined): ModelsFitState {
  const active = useActiveDataset();
  const resolveDataset = useApp((s) => s.resolveDataset);
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const [settings, setSettings] = useState<ModelsSettings>(DEFAULTS);
  const ownOverlay = useRef<FitOverlay | null>(null);
  const key = active ? JSON.stringify([datasetInputsToken(active), xKey, yKeys, seriesOrder, settings, modelName]) : "";

  const preview = useWorkbenchPreview<ModelsRun | null>({
    key,
    auto: false,
    delayMs: 0,
    fallbackError: "Fit failed",
    run: async (signal) => {
      if (!active) return null;
      const ds = await resolveDataset(active.id);
      const d = ds ? selectedFitData(ds, xKey, yKeys, seriesOrder) : null;
      const refused = ds && !d ? fitSelectionRefusal(ds, xKey, yKeys, seriesOrder) : null;
      if (refused) throw new Refusal(refused);
      if (!ds || !d) throw new Refusal("no data to fit");
      let res: number[] | null = null;
      if (settings.mode === "convolution" && settings.resCol !== "") {
        const col = Number(settings.resCol);
        const data = analysisData(ds);
        const rows = d.analysisRows ?? d.x.map((_, i) => i);
        if (!data || !Number.isInteger(col) || col < 0 || col >= data.labels.length) throw new Refusal("choose a resolution column");
        res = rows.map((r) => data.values[r]?.[col] ?? Number.NaN);
        if (res.length !== d.x.length) throw new Refusal("the resolution column does not line up with the fitted rows");
      }
      // Rows with a non-finite x, y (or resolution) are dropped and put back as gaps afterwards.
      const keep: number[] = [];
      d.x.forEach((v, i) => {
        if (Number.isFinite(v) && Number.isFinite(d.y[i]) && (res === null || Number.isFinite(res[i]))) keep.push(i);
      });
      const pairs = { x: keep.map((i) => d.x[i]), y: keep.map((i) => d.y[i]), keep, n: d.x.length };
      if (res) res = keep.map((i) => (res as number[])[i]);
      let out: ModelsRun;
      let yFit: (number | null)[];
      if (settings.mode === "piecewise") {
        const fixed = fixedList(settings.fixedBreaks);
        const result = await piecewiseFit(
          { x: pairs.x, y: pairs.y, n_breakpoints: breakCount(settings.nBreak), ...(fixed.length ? { fixed_breakpoints: fixed } : {}) },
          signal,
        );
        yFit = result.yFit;
        out = { kind: "piecewise", result };
      } else if (settings.mode === "convolution") {
        const sigma = positiveSigma(settings.sigma, res === null || settings.fitSigma);
        if (res !== null && settings.fitSigma) throw new Refusal("a measured resolution is held; turn off 'fit width'");
        const result = await convolutionFit(
          {
            x: pairs.x, y: pairs.y, model: modelName, fit_sigma: res === null && settings.fitSigma,
            ...(model ? { lower: model.lb, upper: model.ub } : {}),
            ...(res !== null ? { resolution: res } : sigma !== undefined ? { sigma } : {}),
          },
          signal,
        );
        yFit = result.yFit;
        out = { kind: "convolution", result };
      } else {
        const result = await odeFit(
          {
            x: pairs.x, y: pairs.y, model: settings.odeModel,
            ...(settings.odeModel === "sequential" ? { observe: settings.observe } : {}),
          },
          signal,
        );
        yFit = result.yFit;
        out = { kind: "ode", result };
      }
      // The inputs changed (or the panel closed) while the request ran: its answer is not theirs.
      if (signal.aborted) return null;
      const n = ds.data.time.length;
      const kept = activeRowIndices(n, droppedRows(ds));
      const aligned = restoreGapRows(yFit.map((v) => v ?? Number.NaN), pairs);
      const overlay: FitOverlay = {
        datasetId: ds.id, binding: { yKey: d.yKey, xKey: d.xKey },
        y: kept.length === n ? aligned : expandToFull(aligned, kept, n), curveFit: true,
      };
      ownOverlay.current = overlay;
      setFitOverlay(overlay);
      return out;
    },
  });

  const error = preview.error || null;
  const outOfDate = preview.stale;
  useEffect(() => {
    if (outOfDate) takeBackOverlay(ownOverlay.current);
  }, [outOfDate]);
  const latest = error ? null : preview.latest?.value ?? null;
  return {
    settings,
    set: (patch) => setSettings((s) => ({ ...s, ...patch })),
    busy: preview.running,
    error,
    refusal: error !== null && preview.refusal,
    run: latest,
    stale: latest !== null && preview.stale,
    go: async () => {
      if (active?.pending) {
        await resolveDataset(active.id);
        await afterCommit();
      }
      return preview.refresh();
    },
  };
}
