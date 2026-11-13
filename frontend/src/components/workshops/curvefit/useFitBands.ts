// Curve Fit — "Bands" state hook. While the toggle is on it asks
// POST /api/fitting/bands (calc.fit_stats.fit_bands) for the confidence and
// prediction limits of the CURRENT fit, SHADES them around the fit curve on
// the main graph (FitOverlay.band, on the Curve Fit's own overlay only), and
// "Plot with band" lands them as a library dataset opened in its own plot with
// the band filled (fitBandData.ts says why a dataset: it is what reaches the
// vector export). The toggle survives a close/reopen, like the band it drew.
//
// The band is a statement about THIS fit: the route takes the fit's point and
// free-parameter counts (its Student-t quantile uses the residual dof
// nPoints - nFree) and the fit's observation variance `MSE`, which the
// prediction band adds to the curve's own variance (fitting audit finding 1:
// the band used to be ~7x too narrow). A WEIGHTED fit's observations do not
// share a variance, so its per-point `obsVar` is sent with the fitted x and
// the route gives every grid point its own (interpolated between data
// points, held outside them) — the band then follows the error bars instead
// of having one constant width. A result without either (an older saved
// snapshot) gets no prediction limits rather than a wrong band.

import { useEffect, useMemo, useState } from "react";

import { fitBands, type BandsResult } from "../../../lib/api/fitStats";
import type { CalcResult, Dataset } from "../../../lib/types";
import { nextDatasetId, useApp } from "../../../store/useApp";
import { ownCurveFitOverlay, setCurveFitOverlayBand } from "../../../store/curveFitOverlay";
import { bandPrefs, type FittedData } from "../../../store/curveFitSession";
import {
  bandDataStruct,
  bandFitStats,
  bandIsEmpty,
  bandRows,
  bandSourceFor,
  bandStyles,
  levelLabel,
  overlayBand,
  overlayRows,
} from "./fitBandData";

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
  const focusWindow = useApp((s) => s.focusWindow);
  const setStatus = useApp((s) => s.setStatus);
  const [on, setOnState] = useState(bandPrefs.on);
  const [level, setLevelState] = useState(bandPrefs.level);
  const [prediction, setPredictionState] = useState(bandPrefs.prediction);
  const setOn = (v: boolean) => setOnState((bandPrefs.on = v));
  const setLevel = (v: number) => setLevelState((bandPrefs.level = v));
  const setPrediction = (v: boolean) => setPredictionState((bandPrefs.prediction = v));
  const [band, setBand] = useState<BandsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { result, fitData, model } = target;
  const rows = useMemo(() => bandRows(fitData.x, fitData.y), [fitData]);

  useEffect(() => {
    setBand(null);
    setError(null);
    setBusy(false);
    const mine = ownCurveFitOverlay(target.dataset.id);
    if (!on) {
      if (mine?.band) setCurveFitOverlayBand(mine, undefined);
      return;
    }
    // The main-graph rows: every row the curve has a value on, at its plotted x.
    const d = target.dataset.data;
    const xs = fitData.xKey == null ? d.time : d.values.map((r) => r[fitData.xKey!]!);
    const plotRows = mine ? overlayRows(mine, xs) : { idx: [], x: [] };
    const params = (result.params as number[] | undefined) ?? [];
    const ctrl = new AbortController();
    setBusy(true);
    fitBands(
      {
        model,
        params,
        covar: (result.covar as number[][] | null | undefined) ?? null,
        x: [...rows.x, ...plotRows.x],
        ...bandFitStats(result, fitData.x),
        level,
      },
      ctrl.signal,
    )
      .then((b) => {
        const n = rows.x.length;
        setBand({ ...b, yFit: b.yFit.slice(0, n), ciLo: b.ciLo.slice(0, n), ciHi: b.ciHi.slice(0, n), piLo: b.piLo.slice(0, n), piHi: b.piHi.slice(0, n) });
        if (mine && !bandIsEmpty(b)) setCurveFitOverlayBand(mine, overlayBand(mine, plotRows.idx, b, n, prediction));
      })
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : "band failed");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setBusy(false);
      });
    return () => ctrl.abort();
  }, [on, level, prediction, model, result, rows, fitData.x, fitData.xKey, target.dataset]);

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
    // Its OWN plot: an empty window first, focused, so the import-style
    // rebind addDataset does lands THERE and the source plot is left alone
    // (it used to rebind the focused source window too, drawing the band as
    // six unstyled lines beside the styled copy). The styles go on after the
    // rebind, which resets them to the dataset defaults.
    focusWindow(createWindow(null, undefined, `${model} fit band`));
    addDataset({ id, name, data: bandDataStruct(rows, band, prediction, src) });
    useApp.setState({ seriesStyles: bandStyles(prediction) });
    setStatus(`added ${name}`);
  }

  return { on, setOn, level, setLevel, prediction, setPrediction, busy, error, halfWidth, empty, plot };
}
