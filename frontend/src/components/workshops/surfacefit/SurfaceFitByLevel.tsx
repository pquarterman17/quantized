// Surface fit "By": the chosen model and bounds fitted once per level of a
// categorical column over the picked X / Y / Z (parameters, R², RMSE, points).
// Display-only: nothing is added to the library. Start values are auto-guessed
// per level (see ./surfaceFitRun).

import { useCallback, useMemo } from "react";

import type { ByLevel } from "../useByPartition";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import type { ByCell } from "../byrun/useByLevelRun";
import { usePickedBy } from "../byrun/usePlottedPair";
import { finiteColumns } from "../analysisextras/columnPicks";
import { fitSurfaceColumns, parseBounds, surfaceSummaryHeaders } from "./surfaceFitRun";
import type { SurfaceFitState } from "./useSurfaceFit";

export default function SurfaceFitByLevel({ f }: { f: Pick<SurfaceFitState, "model" | "lower" | "upper" | "xCol" | "yCol" | "zCol"> }) {
  const { model, lower, upper, xCol, yCol, zCol } = f;
  const { active, data, columns } = usePickedBy([xCol, yCol, zCol]);
  const bounds = useMemo(() => parseBounds(lower, upper), [lower, upper]);
  const run = useCallback(async (level: ByLevel): Promise<ByCell[]> => {
    if (!model || typeof bounds === "string") throw new Error("the surface model is not ready");
    const { values } = await fitSurfaceColumns(finiteColumns(level.data, [xCol, yCol, zCol]), model, bounds);
    return values;
  }, [model, bounds, xCol, yCol, zCol]);
  return (
    <ByLevelRunSection
      tool="Surface fit"
      active={active}
      data={data}
      columns={columns}
      headers={model ? surfaceSummaryHeaders(model) : []}
      run={run}
      runKey={`${xCol}|${yCol}|${zCol}|${model?.name}|${JSON.stringify(bounds)}`}
      blockedReason={active?.pending ? "wait for the full dataset to load" : !model ? "choose a surface model" : typeof bounds === "string" ? bounds : null}
      save={{ toolId: "surface-fit", parameters: { model: model?.name ?? null, lower, upper }, xKey: xCol >= 0 ? xCol : null, yKeys: [yCol, zCol] }}
    />
  );
}
