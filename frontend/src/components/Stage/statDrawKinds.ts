// Which Stat Stage draws are NOT categorical: they carry no per-group marks,
// selection link, comparisons or nested axis, so every categorical decoration
// (`statStageMarks`, `statErrorNote`, `statExportDomain`, `useStatGroupSelection`)
// passes them through. One guard instead of a mode list at each site.

import type { StatDrawData } from "./statRender";

export type PlainDraw = Extract<StatDrawData, { mode: "qq" | "histogram" | "cdf" | "marginal" | "ridgeline" }>;

export function isPlainDraw(d: StatDrawData): d is PlainDraw {
  const m = d.mode;
  return m === "qq" || m === "histogram" || m === "cdf" || m === "marginal" || m === "ridgeline";
}
