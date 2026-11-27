// Variability's preset bar: the shared bar over the Variability adapter.
// Mounted by VariabilityChartPanel through a lazy seam, so none of it is
// eager. The analysis re-runs on its own as the picks change, so there is no
// run that ends a draft: `running` stays false and Revert lasts until close.

import PresetBar from "../presets/PresetBar";
import { createVariabilityAdapter } from "./presetAdapter";
import type { VariabilityState } from "./useVariability";

export default function VariabilityPresetBar({ v, fromResult }: { v: Pick<VariabilityState, "columns" | "responseCol" | "factorACol" | "factorBCol" | "setResponseCol" | "setFactorACol" | "setFactorBCol">; fromResult: boolean }) {
  const adapter = createVariabilityAdapter({
    columns: () => v.columns,
    getPicks: () => ({ responseCol: v.responseCol, factorACol: v.factorACol, factorBCol: v.factorBCol }),
    setPicks: (p) => { v.setResponseCol(p.responseCol); v.setFactorACol(p.factorACol); v.setFactorBCol(p.factorBCol); },
  });
  return <PresetBar adapter={adapter} fromResult={fromResult} running={false} />;
}
