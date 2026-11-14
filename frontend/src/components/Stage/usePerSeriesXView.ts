// What the plot draws, ahead of every plot surface's pipeline (usePlotPayload,
// the stacked panels): each Y against its OWN X (gap audit 2 #2) and a live
// graph's curve names as its legend (gap audit 2 #1). The planning lives in
// the lazy lib/perSeriesX.ts (`plotOverrides`, memoized per input identity):
// only a sheet with a designated X value column, or a graph, needs it -- and
// until it lands such a sheet draws nothing rather than a Y on the wrong X.
// Same lazy-seam shape as useWaterfallX.ts.

import { useEffect, useMemo, useState } from "react";

import { effectiveDesignations } from "../../lib/columnmeta";
import type { PlotParamsIn } from "../../lib/perSeriesX";

type Lib = typeof import("../../lib/perSeriesX");
let loaded: Lib | undefined;

/** `p` re-pointed at what the plot must draw. A per-series-X view repeats each
 *  source row once per X column, so view row `v` is source row `v % rows`
 *  (the brush maps back that way, Stage/usePlotStageActions.ts). */
export function usePerSeriesXView<P extends PlotParamsIn>(p: P): P {
  const data = p.active?.data;
  const on = !!data && (!!data.metadata.linked_curve_legends || effectiveDesignations(data, p.active!.columnDesignations).includes("X"));
  const [lib, setLib] = useState(loaded);
  useEffect(() => {
    if (on) import("../../lib/perSeriesX").then((m) => setLib((loaded = m)), () => {});
  }, [on]);
  const over = on && lib ? lib.plotOverrides(p) : null;
  return useMemo(() => (on ? { ...p, ...(over ?? { active: null }) } : p), [on, over, p]);
}
