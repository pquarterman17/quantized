// Composing the Curve Fit's initial-guess preview (lib/fitPreviewSlot.ts) onto a
// drawn payload. Pure: no React, no store.
//
// The model is evaluated with the SAME formula evaluator and the SAME
// expressions as `fitval()` (lib/derivedFitModels.ts, each checked against
// calc.fit_models by derivedFitModels.test.ts), so there is no second model
// implementation: a model with no entry there has no preview, and the panel says so.

import type uPlot from "uplot";

import { compileFormula } from "./formula";
import { logOffsetDecades } from "./logOffset";
import { waterfallApplies } from "./waterfallOffset";
import type { FitPreviewCurve } from "./fitPreviewSlot";
import type { PlotPayload } from "./plotdata";

/** The legend / series name of the preview curve. */
export const FIT_PREVIEW_LABEL = "initial guess";

type Compiled = (ctx: Record<string, number>) => number;
const compiled = new Map<string, Compiled | null>();

function compile(expr: string): Compiled | null {
  if (!compiled.has(expr)) {
    try {
      compiled.set(expr, compileFormula(expr) as Compiled);
    } catch {
      compiled.set(expr, null);
    }
  }
  return compiled.get(expr) ?? null;
}

/** `expr` at each `x` for `params`: null where x is missing or the model has no
 *  finite value there. Null overall when the expression cannot be compiled or
 *  reads a parameter that was not given. */
export function evaluatePreview(expr: string, params: readonly number[], x: readonly (number | null)[]): (number | null)[] | null {
  const fn = compile(expr);
  if (!fn) return null;
  const ctx: Record<string, number> = { x: 0 };
  params.forEach((v, i) => (ctx[`p${i}`] = v));
  try {
    return Array.from(x, (xi) => {
      if (xi == null || !Number.isFinite(xi)) return null;
      ctx.x = xi;
      const y = fn(ctx);
      return Number.isFinite(y) ? y : null;
    });
  } catch {
    return null; // never a partial curve
  }
}

/** A waterfall or a decade offset moves the DRAWN data away from the values the
 *  model describes (the real fit overlay is shifted with it; this one is not),
 *  so the preview is not drawn while either is on, and the panel says why. */
export const previewShifted = (waterfall: number, styles: Readonly<Record<number, { logOffset?: unknown } | undefined>>): boolean =>
  waterfallApplies(waterfall) || Object.values(styles).some((s) => logOffsetDecades(s?.logOffset) !== 0);

/** `payload` plus the preview as one extra, dotted series, when it is for the
 *  plotted dataset and X channel; the payload untouched otherwise. */
export function withFitPreview(
  payload: PlotPayload | null,
  curve: FitPreviewCurve | null,
  plotted: { datasetId: string | null; xKey: number | null; shifted?: boolean },
): PlotPayload | null {
  if (!payload || !curve || curve.datasetId !== plotted.datasetId || curve.xKey !== plotted.xKey || plotted.shifted) return payload;
  if (payload.xCategories) return payload; // a category axis has no numeric x to evaluate at
  const y = evaluatePreview(curve.expr, curve.params, payload.data[0] as readonly (number | null)[]);
  if (!y) return payload;
  return {
    ...payload,
    data: [...payload.data, y] as uPlot.AlignedData,
    series: [...payload.series, { label: FIT_PREVIEW_LABEL, unit: "", overlay: true, preview: true }],
  };
}
