// Find Peaks "By": the detector run once per level of a categorical column,
// one summary row per level (peaks found, strongest peak). Display-only: the
// peak overlay, table and any fit still follow the whole worksheet.

import { useCallback } from "react";

import { findPeaks } from "../../../lib/api/peaks";
import type { ByLevel } from "../useByPartition";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import { levelPairs } from "../byrun/byLevelPairs";
import type { ByCell } from "../byrun/useByLevelRun";
import { usePlottedPair } from "../byrun/usePlottedPair";
import { findOverrides, type PeakFindParams } from "./peakFindParams";

export default function PeakByLevelSection({ params }: { params: PeakFindParams }) {
  const { active, data, xKey, yKey, columns } = usePlottedPair();
  const run = useCallback(async (level: ByLevel): Promise<ByCell[]> => {
    if (!active || yKey == null) throw new Error("select a plotted Y channel first");
    const { x, y } = levelPairs(active, level.data, xKey, yKey);
    if (x.length < 3) throw new Error(`not enough data (n=${x.length})`);
    const xrdDefaults = active.data.metadata.technique === "xrd.powder" ? { strict_prominence: true } : {};
    const res = await findPeaks({ x, y, ...xrdDefaults, ...findOverrides(params) });
    const top = res.peaks.reduce<(typeof res.peaks)[number] | null>((b, p) => (!b || p.prominence > b.prominence ? p : b), null);
    return [res.peaks.length, top?.center ?? null, top?.localSNR ?? null];
  }, [active, xKey, yKey, params]);
  return (
    <ByLevelRunSection
      tool="Find peaks"
      active={active}
      data={data}
      columns={columns}
      headers={["Peaks", "Strongest center", "Strongest SNR"]}
      run={run}
      runKey={`${xKey}|${yKey}|${JSON.stringify(params)}`}
      blockedReason={active?.pending ? "wait for the full dataset to load" : null}
    />
  );
}
