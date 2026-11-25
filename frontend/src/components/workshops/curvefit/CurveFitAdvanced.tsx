// Curve Fit -- the Advanced tab (UX-F): the tools a routine single fit never
// needs, moved out of the one long column they used to end: batch across
// worksheets, saved templates, model comparison, ODR, robust / quantile fits, the AICc model scan and
// the optional bumps engine. Each is unchanged; only where it lives moved.

import type { ComponentProps } from "react";

import { lazyRegion } from "../../../lib/lazyRegion";
import type { CustomFitModel } from "../../../lib/fitmodels";
import type { FitParamRow } from "../../../lib/fitParams";
import type { Dataset, FitModel, WeightMode } from "../../../lib/types";
import BumpsSection from "./BumpsSection";
import CurveFitBatchSection from "./CurveFitBatchSection";
import ModelScanSection from "./ModelScanSection";
import type { ModelScanState } from "./useModelScan";
import { xErrorChannel } from "./xErrorChannel";

// Each its own chunk, fetched only when shown.
const FitTemplatesSection = lazyRegion(() => import("./FitTemplatesSection"), "Templates");
const CompareModelsSection = lazyRegion(() => import("./CompareModelsSection"), "Compare models");
const OdrSection = lazyRegion(() => import("./OdrSection"), "ODR");
const RobustSection = lazyRegion(() => import("./RobustSection"), "Robust fit");
const ModelsSection = lazyRegion(() => import("./ModelsSection"), "Model fits");

type TemplateProps = ComponentProps<typeof FitTemplatesSection>;

export interface CurveFitAdvancedProps {
  active: Dataset | null;
  modelName: string;
  registryModel: FitModel | undefined;
  paramRows: FitParamRow[];
  weightMode: WeightMode;
  manualKey: number | null;
  scaleErrors: boolean;
  template: { current: TemplateProps["current"]; apply: TemplateProps["apply"] };
  modelOptions: { value: string; label: string }[];
  customModels: CustomFitModel[];
  modelScan: ModelScanState;
  onApplyScanned: (kind: "registry" | "equation", name: string) => void;
  /** Bumped by the header's "Fit N worksheets": opens the batch section. */
  batchOpenSignal?: number;
}

export default function CurveFitAdvanced(p: CurveFitAdvancedProps) {
  return (
    <>
      {/* Batch across worksheets. */}
      <CurveFitBatchSection
        modelName={p.modelName} model={p.registryModel} paramRows={p.paramRows}
        weightMode={p.weightMode} manualKey={p.manualKey} scaleErrors={p.scaleErrors}
        expandSignal={p.batchOpenSignal}
      />

      {/* Save / apply named fit settings. */}
      <FitTemplatesSection current={p.template.current} apply={p.template.apply} />

      {/* Fit 2+ models to this selection and compare them. */}
      <CompareModelsSection options={p.modelOptions} current={p.modelName} customModels={p.customModels} />

      {/* Errors in x and y: offered only with an X-error column. */}
      {xErrorChannel(p.active) != null && <OdrSection />}

      {/* Robust loss / bisquare / quantile fits (opt-in; the main Fit stays least squares). */}
      <RobustSection modelName={p.modelName} model={p.registryModel} />

      {/* Piecewise / convolution / ODE model fits (opt-in). */}
      <ModelsSection modelName={p.modelName} model={p.registryModel} />

      {/* AICc quick-scan (GOTO #6) -- rank all plausible models; click applies. */}
      <ModelScanSection state={p.modelScan} onApply={p.onApplyScanned} />

      {/* Optional bumps engine (GOTO #10) -- self-contained; parity stays default. */}
      <BumpsSection modelName={p.modelName} />
    </>
  );
}
