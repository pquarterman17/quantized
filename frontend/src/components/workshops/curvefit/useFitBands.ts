// Curve Fit — "Bands" state hook. While the toggle is on it asks
// POST /api/fitting/bands (calc.fit_stats.fit_bands) for the confidence and
// prediction limits of the CURRENT fit, and "Plot with band" lands them as a
// library dataset opened in its own plot with the band filled (fitBandData.ts
// says why a dataset: it is what reaches the vector export).
//
// Degrees of freedom: fit_bands takes its Student-t dof directly, and the
// band is a statement about THIS fit's residual scatter, so it is sent as
// nPoints - nFree (the fit's residual dof), not the free-parameter count.

import { useEffect, useMemo, useState } from "react";

import { fitBands, type BandsResult } from "../../../lib/api/fitStats";
import { defaultPlotView } from "../../../lib/plotview";
import type { CalcResult, Dataset } from "../../../lib/types";
import { nextDatasetId, useApp } from "../../../store/useApp";
import { bandDataStruct, bandIsEmpty, bandRows, bandSourceFor, bandStyles, levelLabel } from "./fitBandData";
import type { FittedData } from "./useCurveFit";

/** A completed registry-model fit: the dataset, the model name, the fit
 *  result (params/covar/nPoints/nFree) and the pairs it ran on. */
export interface FitBandsTarget {
  dataset: Dataset;
  model: string;
  result: CalcResult;
  fitData: FittedData;
}

export interface FitBandsState {
  on: boolean;
  setOn: (on: boolean) => void;
  level: number;
  setLevel: (level: number) => void;
  prediction: boolean;
  setPrediction: (on: boolean) => void;
  busy: boolean;
  error: string | null;
  /** Median CI half-width over the band rows; null until a band arrives. */
  halfWidth: number | null;
  /** The fit carried no usable covariance, so there is no band to draw. */
  empty: boolean;
  plot: () => void;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function useFitBands(target: FitBandsTarget): FitBandsState {
  const addDataset = useApp((s) => s.addDataset);
  const createWindow = useApp((s) => s.createWindow);
  const setStatus = useApp((s) => s.setStatus);
  const [on, setOn] = useState(false);
  const [level, setLevel] = useState(0.95);
  const [prediction, setPrediction] = useState(false);
  const [band, setBand] = useState<BandsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { result, fitData, model } = target;
  const rows = useMemo(() => bandRows(fitData.x, fitData.y), [fitData]);

  useEffect(() => {
    setBand(null);
    setError(null);
    setBusy(false);
    if (!on) return;
    const params = (result.params as number[] | undefined) ?? [];
    const nPoints = Number(result.nPoints ?? fitData.x.length);
    const nFree = Number(result.nFree ?? params.length);
    const ctrl = new AbortController();
    setBusy(true);
    fitBands(
      {
        model,
        params,
        covar: (result.covar as number[][] | null | undefined) ?? null,
        x: rows.x,
        n_points: nPoints,
        dof: Math.max(nPoints - nFree, 1),
        level,
      },
      ctrl.signal,
    )
      .then((b) => setBand(b))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "band failed");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setBusy(false);
      });
    return () => ctrl.abort();
  }, [on, level, model, result, rows, fitData.x.length]);

  const empty = band != null && bandIsEmpty(band);
  const halfWidth = useMemo(() => {
    if (!band || empty) return null;
    const hw: number[] = [];
    band.ciHi.forEach((hi, i) => {
      const lo = band.ciLo[i];
      if (hi != null && lo != null && Number.isFinite(hi - lo)) hw.push((hi - lo) / 2);
    });
    return median(hw);
  }, [band, empty]);

  function plot(): void {
    if (!band || empty) return;
    const id = nextDatasetId();
    const src = bandSourceFor(target.dataset, model, fitData.xKey, fitData.yKey);
    const name = `${target.dataset.name} — ${model} fit, ${levelLabel(band.level)} band`;
    addDataset({ id, name, data: bandDataStruct(rows, band, prediction, src) });
    createWindow(id, { ...defaultPlotView(), seriesStyles: bandStyles(prediction) }, `${model} fit band`);
    setStatus(`added ${name}`);
  }

  return { on, setOn, level, setLevel, prediction, setPrediction, busy, error, halfWidth, empty, plot };
}
