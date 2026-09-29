// Reflectivity fit — RESIDUALS and the linked data/model/residual/SLD panels
// (P2.2). Pure: no React, no store.
//
// A residual is exactly what calc/refl_fit.py's `channel_residuals` minimised:
//   dR weighting   (R_model − R) / dR               — normalised, in units of σ
//   log weighting  log10(max(R_model, 1e-300)) − log10(R)   — in dex
// The fit response carries them per channel and a saved fit stores them with
// its curves. A record written before residuals were stored still has R and
// the model, so its LOG residuals are recomputed here by the same formula
// (exact: nothing but R and the model enters it). Its dR residuals cannot be:
// dR was never stored, so the view says so rather than guess.
//
// The panels are PlotPayloads for lib/uplotOpts' `buildOpts`: data + model
// (log R) and residuals share one Q column so the two plots line up point for
// point, and `linkX` keeps their Q zoom in step; the SLD profile has its own
// depth axis.

import type { PlotPayload, PlotSeriesSpec } from "../../../lib/plotdata";
import type { CurvesLike } from "./reflFitCurves";
import type { Weighting } from "./reflFitData";

/** numpy's `np.maximum(model, 1e-300)` floor in `channel_residuals`. */
const LOG_FLOOR = 1e-300;

export const RESIDUALS_NOT_STORED = "Residuals were not stored with this fit, so re-run it to plot them.";

interface ResidualSource {
  r: readonly number[];
  model: readonly (number | null)[];
  residual?: readonly (number | null)[];
}

/** A channel's residuals on its fitted points: the ones the fit reported
 *  when present, recomputed exactly for log weighting, else null. */
export function channelResiduals(c: ResidualSource, weighting: Weighting): (number | null)[] | null {
  if (c.residual && c.residual.length === c.r.length) return [...c.residual];
  if (weighting !== "log") return null;
  return c.r.map((r, k) => {
    const m = c.model[k];
    return m == null || !(r > 0) ? null : Math.log10(Math.max(m, LOG_FLOOR)) - Math.log10(r);
  });
}

/** The unit a residual is in: σ (dR-normalised) or dex (log10 R). */
export function residualUnit(weighting: Weighting): string {
  return weighting === "dr" ? "σ" : "dex";
}

/** What a residual of each weighting is, as a formula. */
export const RESIDUAL_MEANING: Record<Weighting, string> = {
  dr: "(R fit − R) / dR",
  log: "log10 R fit − log10 R",
};

export interface FitPlotPanels {
  /** Measured R (points) and the model (line) against Q, for a log-R axis. */
  reflectivity: PlotPayload | null;
  /** Residuals against the SAME Q column as `reflectivity`. */
  residual: PlotPayload | null;
  /** Why `residual` is null although there are curves, or null. */
  residualNote: string | null;
  /** SLD(z), one series per spin state. */
  sld: PlotPayload | null;
}

type Col = (number | null)[];

/** Sorted union of every x, and for each series its values on that union. */
function onUnion(xs: readonly (readonly number[])[]): { x: number[]; at: (i: number, ys: readonly (number | null)[]) => Col } {
  // levels-allowlist: the sorted union of measured Q (or z) points of the
  // channels, a continuous axis, never a column's category levels.
  const x = [...new Set(xs.flat())].sort((a, b) => a - b);
  const pos = new Map(x.map((v, i) => [v, i]));
  return {
    x,
    at: (i, ys) => {
      const out: Col = x.map(() => null);
      xs[i].forEach((v, k) => {
        const y = ys[k];
        out[pos.get(v) as number] = y == null || !Number.isFinite(y) ? null : y;
      });
      return out;
    },
  };
}

const positive = (col: Col): Col => col.map((v) => (v != null && v > 0 ? v : null));

export function fitPlotPanels(curves: CurvesLike, weighting: Weighting): FitPlotPanels {
  const chans = curves.channels;
  const many = chans.length > 1;
  const tag = (base: string, spin: string | null, i: number) => (many ? `${base} (${spin ?? `channel ${i + 1}`})` : base);
  const q = onUnion(chans.map((c) => c.q));
  const qPayload = (cols: Col[], series: PlotSeriesSpec[]): PlotPayload => ({
    data: [q.x, ...cols],
    series,
    xLabel: "Q",
    xUnit: "Å⁻¹",
  });

  let reflectivity: PlotPayload | null = null;
  let residual: PlotPayload | null = null;
  let residualNote: string | null = null;
  if (chans.length) {
    reflectivity = qPayload(
      chans.flatMap((c, i) => [positive(q.at(i, c.r)), positive(q.at(i, c.model))]),
      chans.flatMap((c, i): PlotSeriesSpec[] => [
        { label: tag("R", c.spin, i), unit: "", kind: "points" },
        { label: tag("model", c.spin, i), unit: "", kind: "line" },
      ]),
    );
    const res = chans.map((c) => channelResiduals(c, weighting));
    if (res.every((r) => r !== null)) {
      residual = qPayload(
        res.map((r, i) => q.at(i, r as Col)),
        chans.map((c, i) => ({ label: tag("residual", c.spin, i), unit: residualUnit(weighting), kind: "points" })),
      );
    } else {
      residualNote = RESIDUALS_NOT_STORED;
    }
  }

  let sld: PlotPayload | null = null;
  if (curves.sld.length) {
    const z = onUnion(curves.sld.map((p) => p.z));
    const manySld = curves.sld.length > 1;
    sld = {
      data: [z.x, ...curves.sld.map((p, i) => z.at(i, p.sld))],
      series: curves.sld.map((p, i) => ({ label: manySld ? `SLD (${p.spin ?? i + 1})` : "SLD", unit: "Å⁻²" })),
      xLabel: "z",
      xUnit: "Å",
    };
  }
  return { reflectivity, residual, residualNote, sld };
}

// ── the shared Q axis ────────────────────────────────────────────────────────

/** The part of a uPlot instance the link touches. */
export interface XScaled {
  scales: { x?: { min?: number | null; max?: number | null } };
  setScale: (key: string, limits: { min: number; max: number }) => void;
}

/** A uPlot `setScale` hook that copies one plot's x range to every other plot
 *  in `group`. A plot already on that range is left alone, so the echo from
 *  the plots it set stops at once. */
export function linkX<T extends XScaled>(group: Set<T>): (u: T, key: string) => void {
  return (u, key) => {
    if (key !== "x") return;
    const { min, max } = u.scales.x ?? {};
    if (min == null || max == null) return;
    for (const other of group) {
      if (other === u) continue;
      const o = other.scales.x;
      if (o && o.min === min && o.max === max) continue;
      other.setScale("x", { min, max });
    }
  };
}
