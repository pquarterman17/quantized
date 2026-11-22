// Ellipse fit "By": the chosen fit kind applied once per level of a categorical
// column over the picked X / Y (centre, semi-axes, tilt, RMS, arc coverage).
// Display-only: no ellipse dataset is added.

import { useCallback } from "react";

import type { ByLevel } from "../useByPartition";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import type { ByCell } from "../byrun/useByLevelRun";
import { usePickedBy } from "../byrun/usePlottedPair";
import { finiteColumns } from "../analysisextras/columnPicks";
import { ELLIPSE_SUMMARY_HEADERS, runEllipse } from "./ellipseRun";
import type { EllipseFitState } from "./useEllipseFit";

export default function EllipseFitByLevel({ e }: { e: Pick<EllipseFitState, "geometric" | "xCol" | "yCol"> }) {
  const { geometric, xCol, yCol } = e;
  const { active, data, columns } = usePickedBy([xCol, yCol]);
  const run = useCallback(async (level: ByLevel): Promise<ByCell[]> => {
    const [x, y] = finiteColumns(level.data, [xCol, yCol]);
    return (await runEllipse(x!, y!, geometric)).values;
  }, [geometric, xCol, yCol]);
  return (
    <ByLevelRunSection
      tool="Ellipse fit"
      active={active}
      data={data}
      columns={columns}
      headers={ELLIPSE_SUMMARY_HEADERS}
      run={run}
      runKey={`${xCol}|${yCol}|${geometric}`}
      blockedReason={active?.pending ? "wait for the full dataset to load" : null}
    />
  );
}
