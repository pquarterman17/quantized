// Hysteresis "By" (lane BY3): the loop analysis run once per level of a
// categorical column of ONE worksheet (e.g. several loops in a file, labelled
// by a "Sweep" or "Temperature step" column). A level means the rows of the
// worksheet's analysis view whose By value is that level, analysed as its own
// M(H) loop with the SAME plotted H and M the single run reads (H = the M's
// own X, which must be a declared magnetic field, else every level is an error
// row). Display-only until "Save By result". A Library row / range selection
// is not applied per level, so By is blocked while one is active (clear it or
// use the batch) rather than quietly analysing different rows from the panel.

import { useCallback, useMemo } from "react";

import { hysteresisAnalysis } from "../../../lib/api/magnetometry";
import { detectMagXKind, magXAxis } from "../../../lib/magDataKind";
import { plottedYKey } from "../../../lib/fitselectionActions";
import { ownXKey } from "../../../lib/perSeriesX";
import type { CalcResult } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useActiveDataset, useApp } from "../../../store/useApp";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import { byCandidates, levelPairs } from "../byrun/byLevelPairs";
import type { ByCell } from "../byrun/useByLevelRun";
import { useAnalysisView } from "../byrun/usePlottedPair";
import type { ByLevel } from "../useByPartition";

const num = (result: CalcResult, key: string): number | null => {
  const v = result[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/** The minimum finite field/moment pairs the single run's batch also requires. */
export const HYSTERESIS_BY_MIN_POINTS = 20;

export default function HysteresisByLevel() {
  const owner = useAnalysisSelection((s) => s.toolId);
  const selection = useAnalysisSelection((s) => s.selection);
  const datasets = useApp((s) => s.datasets);
  const fallback = useActiveDataset();
  const liveX = useApp((s) => s.xKey);
  const liveY = useApp((s) => s.yKeys);
  const seriesOrder = useApp((s) => s.seriesOrder);
  // The panel's own source: its reviewed selection when it has one.
  const selected = owner === "hysteresis" ? selection?.items[0] ?? null : null;
  const active = selected ? datasets.find((d) => d.id === selected.datasetId) ?? null : fallback;
  const xKey = selected?.xKey ?? liveX;
  const yKeys = selected?.yKeys ?? liveY;
  const yKey = active ? plottedYKey(active, xKey, yKeys, seriesOrder) : null;
  const data = useAnalysisView(active);
  const columns = useMemo(() => byCandidates(active, xKey, yKey), [active, xKey, yKey]);
  const axis = active && yKey != null ? magXAxis(active.data, ownXKey(active, xKey, yKey)) : null;
  const kind = axis ? detectMagXKind(axis.label, axis.unit) : null;
  const hUnit = axis?.unit ?? "";
  const mUnit = active && yKey != null ? active.data.units[yKey] ?? "" : "";

  const restricted = !!selected && (selected.rowIds != null || selected.range != null || selected.roi != null);
  const blockedReason = !active || yKey == null ? "select a plotted M channel first"
    : active.pending ? "wait for the full dataset to load"
      : kind && kind.kind !== "field" ? `the plotted X axis is not a declared magnetic field (${kind.reason})`
        : restricted ? "the Library selection restricts rows or an X range; By analyses every row of each level, so clear that restriction first"
          : null;

  const run = useCallback(async (level: ByLevel): Promise<ByCell[]> => {
    if (!active || yKey == null) throw new Error("select a plotted M channel first");
    const { x, y } = levelPairs(active, level.data, xKey, yKey);
    if (x.length < HYSTERESIS_BY_MIN_POINTS) {
      throw new Error(`only ${x.length} finite field/moment pairs; hysteresis analysis needs at least ${HYSTERESIS_BY_MIN_POINTS}`);
    }
    const r = await hysteresisAnalysis({ h: x, m: y });
    const sfd = r.SFD && typeof r.SFD === "object" ? r.SFD as Record<string, unknown> : {};
    const peak = typeof sfd.peakH === "number" && Number.isFinite(sfd.peakH) ? sfd.peakH : null;
    return [num(r, "HcMean"), num(r, "MrMean"), num(r, "MsMean"), num(r, "squareness"), num(r, "loopArea"), peak];
  }, [active, xKey, yKey]);

  const headers = useMemo(() => {
    const u = (unit: string) => (unit ? ` (${unit})` : "");
    return [
      `Mean |Hc|${u(hUnit)}`, `Mean |Mr|${u(mUnit)}`, `Mean |Ms|${u(mUnit)}`, "Squareness",
      `Loop area${hUnit && mUnit ? ` (${hUnit}·${mUnit})` : ""}`, `SFD peak H${u(hUnit)}`,
    ];
  }, [hUnit, mUnit]);

  return (
    <ByLevelRunSection
      tool="Hysteresis"
      active={active}
      data={data}
      columns={columns}
      headers={headers}
      run={run}
      runKey={`${xKey}|${yKey}|${hUnit}|${mUnit}`}
      blockedReason={blockedReason}
      save={{ toolId: "hysteresis", parameters: { hUnit, mUnit }, xKey, yKeys: yKey == null ? [] : [yKey] }}
    />
  );
}
