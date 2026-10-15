import { useCallback } from "react";

import { dropGapRows } from "../../../lib/api/finitePairs";
import { hysteresisAnalysis } from "../../../lib/api/magnetometry";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import { detectMagXKind, magXAxis } from "../../../lib/magDataKind";
import type { CalcResult, Dataset } from "../../../lib/types";
import AnalysisBatchControls, { type AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import { hysteresisInputs } from "./useHysteresis";

const metric = (result: CalcResult, key: string): number | null => {
  const value = result[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** Run the reviewed worksheet selection as independent M(H) loops. Values
 * keep their units beside every row, so mixed Oe/T or emu/A·m² batches are
 * explicit rather than silently compared as if they shared a scale. */
export default function HysteresisBatchSection() {
  const runItem = useCallback(async (
    dataset: Dataset,
    selection: AnalysisSelectionItem,
  ): Promise<AnalysisBatchOutcome> => {
    const input = hysteresisInputs(dataset, selection.xKey, selection.yKeys, null, selection);
    if (!input) throw new Error("No response column is available to analyze.");
    const axis = magXAxis(dataset.data, selection.xKey);
    const xKind = detectMagXKind(axis.label, axis.unit);
    if (xKind.kind !== "field") {
      throw new Error(`The selected X axis is not a declared magnetic field (${xKind.reason}).`);
    }
    const pairs = dropGapRows(input.h, input.m);
    if (pairs.x.length < 20) {
      throw new Error(`Only ${pairs.x.length} finite field/moment pairs remain; hysteresis analysis needs at least 20.`);
    }
    const result = await hysteresisAnalysis({ h: pairs.x, m: pairs.y });
    const hUnit = axis.unit;
    const mUnit = dataset.data.units[input.yKey] ?? "";
    const sfd = result.SFD && typeof result.SFD === "object"
      ? result.SFD as Record<string, unknown>
      : {};
    const peakH = typeof sfd.peakH === "number" && Number.isFinite(sfd.peakH) ? sfd.peakH : null;
    const warnings = Array.isArray(result.warnings)
      ? result.warnings.filter((warning): warning is string => typeof warning === "string")
      : [];
    if (!pairs.complete) warnings.unshift(`${pairs.n - pairs.keep.length} gap rows were omitted.`);
    return {
      values: [
        metric(result, "HcMean"), hUnit || null,
        metric(result, "MrMean"), metric(result, "MsMean"), mUnit || null,
        metric(result, "squareness"), metric(result, "loopArea"),
        hUnit && mUnit ? `${hUnit}·${mUnit}` : null,
        peakH,
      ],
      warnings,
    };
  }, []);

  return <AnalysisBatchControls
    toolId="hysteresis"
    label="Hysteresis comparison"
    summaryColumns={[
      "Mean |Hc|", "H unit", "Mean |Mr|", "Mean |Ms|", "M unit",
      "Squareness", "Loop area", "Area unit", "SFD peak H",
    ]}
    runItem={runItem}
  />;
}
