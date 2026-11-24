// Curve Fit -- robust / quantile fit state hook (GAP_AUDIT_9 G11). Three
// opt-in estimators beside the ordinary fit (which stays plain least squares):
//   loss      the selected registry model with a robust loss (soft-L1, Huber,
//             Cauchy; scipy least_squares) and an f_scale (blank = automatic);
//   bisquare  Tukey-bisquare IRLS of a polynomial (degree 1 = line);
//   quantile  polynomial quantile regression at a user-set tau.
// Same shell as useOdrFit: manual run, a result fitted under changed inputs or
// settings is `stale`, an answer for inputs that changed in flight is dropped,
// validation failures are refusals. The fitted curve becomes the fit overlay.

import { useEffect, useRef, useState } from "react";

import { dropGapRows, restoreGapRows } from "../../../lib/api/finitePairs";
import { quantileFit, robustFit, type QuantileFitResult, type RobustFitResult } from "../../../lib/api/fitRobust";
import { fitSelectionRefusal, selectedFitData } from "../../../lib/fitselection";
import { activeRowIndices, droppedRows, expandToFull } from "../../../lib/rowstate";
import type { FitModel, FitOverlay } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { afterCommit } from "../workbench/afterCommit";
import { datasetInputsToken } from "../workbench/inputsKey";
import { Refusal } from "../workbench/refusal";
import { useWorkbenchPreview } from "../workbench/useWorkbenchPreview";
import { takeBackOverlay } from "./fitOverlayOwnership";

export type RobustMode = "loss" | "bisquare" | "quantile";
export type RobustLoss = "soft_l1" | "huber" | "cauchy";

export interface RobustSettings {
  mode: RobustMode;
  loss: RobustLoss;
  /** Blank = automatic (normal-consistent MAD of the least-squares residuals). */
  fScale: string;
  degree: string;
  tau: string;
}

const DEFAULTS: RobustSettings = { mode: "loss", loss: "soft_l1", fScale: "", degree: "1", tau: "0.5" };

export type RobustRun =
  | { kind: "robust"; result: RobustFitResult; pairs: { x: number[]; y: number[] } }
  | { kind: "quantile"; result: QuantileFitResult; pairs: { x: number[]; y: number[] } };

export interface RobustFitState {
  settings: RobustSettings;
  set: (patch: Partial<RobustSettings>) => void;
  busy: boolean;
  error: string | null;
  refusal: boolean;
  run: RobustRun | null;
  stale: boolean;
  go: () => Promise<void>;
}

function positive(text: string, what: string): number | undefined {
  if (text.trim() === "") return undefined;
  const v = Number(text);
  if (!Number.isFinite(v) || v <= 0) throw new Refusal(`${what} must be a positive number`);
  return v;
}

function parseDegree(text: string): number {
  const d = Number(text);
  if (!Number.isInteger(d) || d < 1 || d > 8) throw new Refusal("polynomial degree must be a whole number from 1 to 8");
  return d;
}

export function useRobustFit(modelName: string, model: FitModel | undefined): RobustFitState {
  const active = useActiveDataset();
  const resolveDataset = useApp((s) => s.resolveDataset);
  const setFitOverlay = useApp((s) => s.setFitOverlay);
  const xKey = useApp((s) => s.xKey);
  const yKeys = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  const [settings, setSettings] = useState<RobustSettings>(DEFAULTS);
  const ownOverlay = useRef<FitOverlay | null>(null);
  const key = active ? JSON.stringify([datasetInputsToken(active), xKey, yKeys, seriesOrder, settings, modelName]) : "";

  const preview = useWorkbenchPreview<RobustRun | null>({
    key,
    auto: false,
    delayMs: 0,
    fallbackError: "Robust fit failed",
    run: async (signal) => {
      if (!active) return null;
      const ds = await resolveDataset(active.id);
      const d = ds ? selectedFitData(ds, xKey, yKeys, seriesOrder) : null;
      const refused = ds && !d ? fitSelectionRefusal(ds, xKey, yKeys, seriesOrder) : null;
      if (refused) throw new Refusal(refused);
      if (!ds || !d) throw new Refusal("no data to fit");
      const pairs = dropGapRows(d.x, d.y);
      let yFit: (number | null)[];
      let out: RobustRun;
      if (settings.mode === "quantile") {
        const tau = Number(settings.tau);
        if (!(tau > 0 && tau < 1)) throw new Refusal("tau must be strictly between 0 and 1");
        const result = await quantileFit({ x: pairs.x, y: pairs.y, tau, degree: parseDegree(settings.degree) }, signal);
        yFit = result.yFit;
        out = { kind: "quantile", result, pairs: { x: pairs.x, y: pairs.y } };
      } else {
        const base = { x: pairs.x, y: pairs.y };
        const req = settings.mode === "bisquare"
          ? { ...base, method: "bisquare" as const, degree: parseDegree(settings.degree) }
          : {
              ...base, method: "nonlinear" as const, model: modelName, loss: settings.loss,
              ...(positive(settings.fScale, "scale") !== undefined ? { f_scale: positive(settings.fScale, "scale") } : {}),
              ...(model ? { lower: model.lb, upper: model.ub } : {}),
            };
        const result = await robustFit(req, signal);
        yFit = result.yFit;
        out = { kind: "robust", result, pairs: { x: pairs.x, y: pairs.y } };
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
