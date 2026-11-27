import { useCallback, useMemo } from "react";

import { dropGapRows } from "../../../lib/api/finitePairs";
import { hysteresisAnalysis } from "../../../lib/api/magnetometry";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import {
  hysteresisTrendCandidates,
} from "../../../lib/hysteresisTrend";
import { detectMagXKind, magXAxis } from "../../../lib/magDataKind";
import { ownXKey } from "../../../lib/perSeriesX";
import type { CalcResult, Dataset } from "../../../lib/types";
import { lazyRegion } from "../../../lib/lazyRegion";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import AnalysisBatchControls, { type AnalysisBatchOutcome } from "../analysisselection/AnalysisBatchControls";
import { hysteresisInputs } from "./useHysteresis";
import { TREND_MANUAL, TREND_NONE, useTrendAxis } from "./useTrendAxis";

// Named settings: the shared preset bar, lazy.
const HysteresisPresetBar = lazyRegion(() => import("./HysteresisPresetBar"), "Presets");

const metric = (result: CalcResult, key: string): number | null => {
  const value = result[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** Run the reviewed worksheet selection as independent M(H) loops. Values
 * keep their units beside every row, so mixed Oe/T or emu/A·m² batches are
 * explicit rather than silently compared as if they shared a scale. */
export default function HysteresisBatchSection() {
  const owner = useAnalysisSelection((state) => state.toolId);
  const selection = useAnalysisSelection((state) => state.selection);
  const datasets = useApp((state) => state.datasets);
  const selectedDatasets = useMemo(() => {
    if (owner !== "hysteresis" || !selection) return [];
    const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
    return selection.items.map((item) => byId.get(item.datasetId)).filter((dataset) => dataset !== undefined);
  }, [datasets, owner, selection]);
  const candidates = useMemo(() => hysteresisTrendCandidates(selectedDatasets), [selectedDatasets]);
  const axis = useTrendAxis(candidates);
  const { axisSource, axisLabel, axisUnit, overrides, setOverrides, setAxisLabel, setAxisUnit } = axis;
  const axisEnabled = axisSource !== "";
  const selectedCandidate = candidates.find((candidate) => candidate.key === axisSource);
  const rawValue = useCallback((dataset: Dataset): string => {
    if (Object.hasOwn(overrides, dataset.id)) return overrides[dataset.id];
    if (!axisEnabled || axisSource === TREND_MANUAL) return "";
    const value = selectedCandidate?.values[dataset.id];
    return value === undefined ? "" : String(value);
  }, [axisEnabled, axisSource, overrides, selectedCandidate]);
  const trendValueById = useMemo(() => Object.fromEntries(selectedDatasets.map((dataset) => {
    const value = Number(rawValue(dataset));
    return [dataset.id, rawValue(dataset).trim() !== "" && Number.isFinite(value) ? value : null];
  })), [rawValue, selectedDatasets]);
  const finiteTrendValues = Object.values(trendValueById).filter((value) => value !== null).length;
  const declaredAxisUnits = selectedCandidate?.units ?? [];
  const seriesColumn = "Series value";
  const trendBlockedReason = axisEnabled
    ? declaredAxisUnits.length > 1
      ? `Selected series source mixes units (${declaredAxisUnits.join(", ")}); choose manual values and convert them to one unit.`
      : !axisLabel.trim() ? "Name the series variable before running."
      : finiteTrendValues < 2 ? "Enter finite series values for at least two selected worksheets."
        : null
    : null;

  const runItem = useCallback(async (
    dataset: Dataset,
    selection: AnalysisSelectionItem,
  ): Promise<AnalysisBatchOutcome> => {
    const input = hysteresisInputs(dataset, selection.xKey, selection.yKeys, null, selection);
    if (!input.ok) throw new Error(input.reason);
    const axis = magXAxis(dataset.data, ownXKey(dataset, selection.xKey, input.yKey)); // h is the Y's own X
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
    // Last used: a worksheet that ran, never Apply (preset contract P4).
    void import("./presetAdapter").then((m) => m.recordHysteresisRun({ axisSource, axisLabel, axisUnit })).catch(() => undefined);
    return {
      values: [
        ...(axisEnabled ? [trendValueById[dataset.id]] : []),
        metric(result, "HcMean"), hUnit || null,
        metric(result, "MrMean"), metric(result, "MsMean"), mUnit || null,
        metric(result, "squareness"), metric(result, "loopArea"),
        hUnit && mUnit ? `${hUnit}·${mUnit}` : null,
        peakH,
      ],
      warnings,
    };
  }, [axisEnabled, axisSource, axisLabel, axisUnit, trendValueById]);

  return <>
    <HysteresisPresetBar
      axis={{ axisSource, axisLabel, axisUnit, candidateKeys: candidates.map((c) => c.key), applyAxis: axis.applyAxis }}
    />
    <section className="qzk-analysis-input-review" aria-label="Comparison trend axis">
      <div className="qzk-analysis-input-review-body qzk-analysis-trend-axis">
        <p className="qzk-ds-meta"><strong>Trend figures</strong> · Optional. Choose an explicit sweep variable; worksheet names are never interpreted as values.</p>
        <div className="qzk-analysis-input-fields">
          <label>Series source
            <select className="qz-select" aria-label="Trend axis source" value={axisSource} onChange={(event) => axis.choose(event.target.value)}>
              <option value={TREND_NONE}>Table only</option>
              <option value={TREND_MANUAL}>Enter values manually</option>
              {candidates.map((candidate) => <option key={candidate.key} value={candidate.key}>
                {candidate.label} ({candidate.coverage}/{selectedDatasets.length})
              </option>)}
            </select>
          </label>
          {axisEnabled && <>
            <label>Axis label<input aria-label="Trend axis label" value={axisLabel} onChange={(event) => setAxisLabel(event.target.value)} /></label>
            <label>Axis unit<input aria-label="Trend axis unit" value={axisUnit} placeholder="optional" onChange={(event) => setAxisUnit(event.target.value)} /></label>
          </>}
        </div>
        {axisEnabled && <div className="qzk-analysis-trend-values">
          {selectedDatasets.map((dataset) => <label key={dataset.id}>
            <span title={dataset.name}>{dataset.name}</span>
            <input type="number" step="any" aria-label={`${dataset.name} series value`} value={rawValue(dataset)}
              onChange={(event) => setOverrides((current) => ({ ...current, [dataset.id]: event.target.value }))} />
          </label>)}
        </div>}
        {axisEnabled && <p className={`qzk-analysis-input-issue${trendBlockedReason ? " error" : ""}`}>
          {trendBlockedReason ?? `${finiteTrendValues} values will be saved; figures split automatically when result units differ.`}
        </p>}
      </div>
    </section>
    <AnalysisBatchControls
      toolId="hysteresis"
      label="Hysteresis comparison"
      // h is the Y's own X, which is not always the selection's X.
      xKeyOf={(dataset, selection) => {
        const input = hysteresisInputs(dataset, selection.xKey, selection.yKeys, null, selection);
        return input.ok ? ownXKey(dataset, selection.xKey, input.yKey) : undefined;
      }}
      summaryColumns={[
        ...(axisEnabled ? [seriesColumn] : []),
        "Mean |Hc|", "H unit", "Mean |Mr|", "Mean |Ms|", "M unit",
        "Squareness", "Loop area", "Area unit", "SFD peak H",
      ]}
      resultParameters={axisEnabled ? {
        hysteresisTrend: {
          label: axisLabel.trim(), unit: axisUnit.trim(), column: seriesColumn,
          source: axisSource === TREND_MANUAL ? "manual" : axisSource,
          values: trendValueById,
        },
      } : undefined}
      blockedReason={trendBlockedReason}
      runItem={runItem}
    />
  </>;
}
