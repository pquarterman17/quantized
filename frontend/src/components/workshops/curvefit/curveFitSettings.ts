// Curve Fit preset settings: a fit template's settings in a FLAT, every-key
// form (an absent optional field becomes "" / true / null), which is what the
// shared strict parser and contract test expect. `toTemplateSettings` and
// `fromTemplateSettings` are the exact inverse pair to the stored shape
// (lib/fitTemplates.ts). Pure.

import type { FitParamRow } from "../../../lib/fitParams";
import { FIT_TEMPLATE_VERSION, type FitTemplateSettings } from "../../../lib/fitTemplates";
import type { WeightMode } from "../../../lib/types";

export interface CurveFitSettings {
  model: string;
  weight: WeightMode;
  /** The manual-error / direct-weight column's LABEL; "" = none. */
  manualLabel: string;
  /** false = "Scale errors with sqrt(reduced chi^2)" turned off. */
  scaleErrors: boolean;
  rows: FitParamRow[];
  /** A value-space X range the user chose; null = the full range. */
  range: { lo: number; hi: number } | null;
}

export function fromTemplateSettings(t: FitTemplateSettings): CurveFitSettings {
  return {
    model: t.model,
    weight: t.weight,
    manualLabel: t.manualLabel ?? "",
    scaleErrors: t.scaleErrors !== false,
    rows: t.rows.map((r) => ({ ...r })),
    range: t.range ? { ...t.range } : null,
  };
}

export function toTemplateSettings(s: CurveFitSettings): FitTemplateSettings {
  return {
    version: FIT_TEMPLATE_VERSION,
    model: s.model,
    weight: s.weight,
    ...(s.manualLabel !== "" ? { manualLabel: s.manualLabel } : {}),
    ...(!s.scaleErrors ? { scaleErrors: false as const } : {}),
    rows: s.rows.map((r) => ({ ...r })),
    ...(s.range ? { range: { ...s.range } } : {}),
  };
}

