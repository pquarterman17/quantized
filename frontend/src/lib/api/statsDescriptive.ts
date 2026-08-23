// `/api/stats/descriptive` — split out of api/stats.ts (R8 bundle-diet pass,
// 2026-08-23; see that file's header for why). This is the ONE stats
// function useApp.ts needs eagerly (a plot-cursor gadget readout); keeping
// it in its own file means api/stats.ts's other ~22 functions (all
// statschooser/distribution/multivar/variability workshop-lazy) carry no
// eager reachability. NOT re-exported by lib/api.ts; useApp.ts and the
// other direct consumers (Inspector/StatsCard.tsx, Stage/worksheet/
// useWorksheetView.ts) import from this path.

import { postJSON } from "./http";
import type { CalcResult } from "../types";

export function statsDescriptive(x: number[]): Promise<CalcResult> {
  return postJSON("/api/stats/descriptive", { x });
}
