// The ROI-gadget chip's text: the mode picker's labels and the compact fit
// readout. Split out of `lib/quickfit.ts` (bundle diet slice 20,
// plans/BUNDLE_HEADROOM.md): only the lazy `Stage/PlotResultChips.tsx`
// renders them, while the eager store and gadget hook need the rest of
// quickfit.ts. Import from this path, never re-exported through quickfit.ts
// (slice 18).

import { fmtNum } from "./format";
import type { GadgetMode } from "./quickfit";
import type { CalcResult } from "./types";

/** Human label for the mode picker. */
export const GADGET_MODE_LABELS: Record<GadgetMode, string> = {
  fit: "Fit",
  integrate: "Integrate",
  stats: "Stats",
  differentiate: "Differentiate",
  fft: "FFT",
  cursors: "Cursors",
};

/** Compact "p0=1.23±0.04  p1=0.01±0.00" text for the chip — the gadget skips
 *  the /api/fitting/models round-trip the Curve Fit workshop uses for real
 *  parameter names, so params are indexed (matches the report's own p0/p1/…
 *  fallback naming, lib/api.reportEmit param_names). Empty string when there
 *  are no params to show. */
export function formatQfitParams(result: CalcResult | null): string {
  if (!result) return "";
  const params = Array.isArray(result.params) ? (result.params as number[]) : [];
  const errors = Array.isArray(result.errors) ? (result.errors as (number | null)[]) : [];
  return params
    .map((p, i) => {
      const e = errors[i];
      const ev = typeof e === "number" && Number.isFinite(e) ? `±${fmtNum(e)}` : "";
      return `p${i}=${fmtNum(p)}${ev}`;
    })
    .join("  ");
}
