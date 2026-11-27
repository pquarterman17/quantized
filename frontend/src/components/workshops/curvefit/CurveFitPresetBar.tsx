// Curve Fit's preset bar: the shared bar over the Curve Fit adapter, which
// reads and writes fit templates. Mounted by CurveFitPanel through a lazy
// seam, so none of it is eager. Replaces the old "Templates" section.

import PresetBar from "../presets/PresetBar";
import { createCurveFitAdapter } from "./presetAdapter";
import type { FitTemplateBinding } from "./useFitTemplateBinding";

export default function CurveFitPresetBar({ template, fromResult, running }: { template: FitTemplateBinding; fromResult: boolean; running: boolean }) {
  return <PresetBar adapter={createCurveFitAdapter(template)} fromResult={fromResult} running={running} />;
}
