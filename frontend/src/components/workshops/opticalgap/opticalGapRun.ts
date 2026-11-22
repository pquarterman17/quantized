// One Tauc fit from plain columns, for Optical gap's worksheet batch and By
// levels: the panel's quantities, transition and window applied unchanged.

import { taucFit, type TaucBody } from "../../../lib/api/analysisExtras";
import { parseField } from "../analysisextras/columnPicks";
import type { OpticalGapState } from "./useOpticalGap";

export type TaucSettings = Pick<OpticalGapState, "xUnit" | "signal" | "percent" | "thickness" | "kind" | "eMin" | "eMax">;
export type TaucOptions = Omit<TaucBody, "x" | "y">;

export const TAUC_SUMMARY_HEADERS = ["Eg (eV)", "Eg SE (eV)", "Window min (eV)", "Window max (eV)", "R² of the line", "Points in fit"] as const;

/** The request settings, or why the panel's settings cannot run (the same checks as Fit gap). */
export function taucOptions(s: TaucSettings): TaucOptions | string {
  const lo = parseField(s.eMin);
  const hi = parseField(s.eMax);
  const t = parseField(s.thickness);
  if ((lo !== null && !Number.isFinite(lo)) || (hi !== null && !Number.isFinite(hi))) {
    return "The fit range is not a number (leave it empty to detect the edge automatically).";
  }
  if (s.signal === "transmittance" && !(t !== null && t > 0)) {
    return "Enter the film thickness (nm) to convert transmittance to absorption.";
  }
  return {
    x_unit: s.xUnit,
    signal: s.signal,
    percent: s.percent,
    thickness_nm: s.signal === "transmittance" ? (t as number) : s.signal === "absorbance" && t ? t : undefined,
    kind: s.kind,
    e_min: lo ?? undefined,
    e_max: hi ?? undefined,
  };
}

export async function runTauc(x: number[], y: number[], options: TaucOptions): Promise<{ values: (number | null)[]; warnings: string[] }> {
  if (x.length < 3) throw new Error(`not enough finite points (n=${x.length})`);
  const r = await taucFit({ x, y, ...options });
  const warnings = r.r2 !== null && r.r2 < 0.98 ? [`The line fits the window poorly (R² ${r.r2.toFixed(3)}).`] : [];
  return { values: [r.eg, r.eg_se, r.e_min, r.e_max, r.r2, r.n_fit], warnings };
}
