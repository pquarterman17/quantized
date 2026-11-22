// Outlier screening "By" (lane BY): the panel's method and settings screen the
// picked channel once per level of a categorical column. A level means the
// rows of the analysis view whose By value is that level, so each level is
// screened against ITS OWN distribution (not the pooled one). Display-only
// until "Save By result"; it never selects or excludes rows.

import { useCallback, useMemo } from "react";

import type { DataStruct } from "../../../lib/types";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import type { ByCell } from "../byrun/useByLevelRun";
import type { ByLevel } from "../useByPartition";
import { OUTLIER_SUMMARY_HEADERS, outlierParameters, screenSummary } from "./outlierRun";
import type { OutlierScreeningState } from "./useOutlierScreening";
import { useActiveDataset } from "../../../store/useApp";

const values = (data: DataStruct, col: number): number[] => (col < 0 ? data.time : data.values.map((row) => row[col]!));

export default function OutlierByLevel({ o }: { o: OutlierScreeningState }) {
  const active = useActiveDataset();
  const { col, method, alpha, k, threshold } = o;
  const data = o.inputs.ok ? o.inputs.data : null;
  const columns = useMemo(() => o.columns.filter((c) => c.index !== col), [o.columns, col]);
  const settings = useMemo(() => ({ method, alpha, k, threshold }), [method, alpha, k, threshold]);
  const run = useCallback(async (level: ByLevel): Promise<ByCell[]> => {
    const finite = values(level.data, col).filter((v) => Number.isFinite(v));
    if (finite.length < 3) throw new Error(`not enough data (n=${finite.length})`);
    return screenSummary(values(level.data, col), settings);
  }, [col, settings]);
  const channel = o.columns.find((c) => c.index === col)?.label ?? `column ${col}`;
  return (
    <ByLevelRunSection
      tool="Outlier screening"
      active={active}
      data={data}
      columns={columns}
      headers={OUTLIER_SUMMARY_HEADERS}
      run={run}
      runKey={`${col}|${JSON.stringify(outlierParameters(settings))}`}
      blockedReason={o.inputs.ok ? null : o.inputs.reason}
      save={{ toolId: "outlier-screening", parameters: { channel, ...outlierParameters(settings) }, xKey: null, yKeys: col >= 0 ? [col] : [] }}
    />
  );
}
