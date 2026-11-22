// Optical gap "By": the panel's quantities, transition and window applied once
// per level of a categorical column over the picked X / Y (Eg, SE, window, R²,
// points). Display-only: nothing is added to the library.

import { useCallback, useMemo } from "react";

import type { ByLevel } from "../useByPartition";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import type { ByCell } from "../byrun/useByLevelRun";
import { usePickedBy } from "../byrun/usePlottedPair";
import { finiteColumns } from "../analysisextras/columnPicks";
import { TAUC_SUMMARY_HEADERS, runTauc, taucOptions, type TaucSettings } from "./opticalGapRun";
import type { OpticalGapState } from "./useOpticalGap";

export default function OpticalGapByLevel({ g }: { g: TaucSettings & Pick<OpticalGapState, "xCol" | "yCol"> }) {
  const { xUnit, signal, percent, thickness, kind, eMin, eMax, xCol, yCol } = g;
  const { active, data, columns } = usePickedBy([xCol, yCol]);
  const options = useMemo(
    () => taucOptions({ xUnit, signal, percent, thickness, kind, eMin, eMax }),
    [xUnit, signal, percent, thickness, kind, eMin, eMax],
  );
  const run = useCallback(async (level: ByLevel): Promise<ByCell[]> => {
    if (typeof options === "string") throw new Error(options);
    const [x, y] = finiteColumns(level.data, [xCol, yCol]);
    return (await runTauc(x!, y!, options)).values;
  }, [options, xCol, yCol]);
  return (
    <ByLevelRunSection
      tool="Optical gap"
      active={active}
      data={data}
      columns={columns}
      headers={TAUC_SUMMARY_HEADERS}
      run={run}
      runKey={`${xCol}|${yCol}|${JSON.stringify(options)}`}
      blockedReason={active?.pending ? "wait for the full dataset to load" : typeof options === "string" ? options : null}
    />
  );
}
