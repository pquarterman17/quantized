// The Graph Builder preview's VIOLINS (JMP_GAP J5 leftover, closed
// 2026-09-30). `./previewMarks` builds a violin render's box draws with the
// violin's marks and its groups; this fetches each draw's KDE through the Stat
// Stage's own `computeViolinDraw` (the backend's `/api/statplots/violin`, the
// numbers the stage and the export draw) and swaps the box for the violin,
// keeping its marks and points. A draw whose KDE is unavailable stays the box
// stand-in — never a fabricated KDE, the stage's rule — and `boxed` says so,
// so the preview keeps its note.

import { useEffect, useState } from "react";

import type { GroupSpec } from "../../../lib/statschooser";
import type { StatDrawData } from "../../Stage/statRender";
import { computeViolinDraw } from "../../Stage/useStatStageCompute";
import type { PreviewStatDraws } from "./previewMarks";

/** One box stand-in as a violin, or the box itself when no KDE came back. */
async function toViolin(box: StatDrawData | null, groups: GroupSpec[]): Promise<StatDrawData | null> {
  if (!box || box.mode !== "box" || groups.length === 0) return box;
  const v = await computeViolinDraw(groups, box.valueLabel, box.groupLabel);
  if (v.mode !== "violin" || v.violins.length !== box.boxes.length) return box;
  return { ...v, points: box.points ?? null, ...(box.marks ? { marks: box.marks } : {}) };
}

/** `stat` with its violins drawn, and whether any draw is still a box. */
export function usePreviewViolins(stat: PreviewStatDraws): { draws: PreviewStatDraws; boxed: boolean } {
  const [done, setDone] = useState<{ from: PreviewStatDraws; to: PreviewStatDraws } | null>(null);
  useEffect(() => {
    const groups = stat.violin;
    if (!groups) return;
    let live = true;
    const faceted = (stat.facets?.length ?? 0) > 0; // the flat draw is not shown then
    void Promise.all([
      faceted ? stat.flat : toViolin(stat.flat, groups.flat),
      Promise.all((stat.facets ?? []).map(async (f, i) => ({ ...f, draw: (await toViolin(f.draw, groups.facets[i] ?? []))! }))),
    ]).then(([flat, facets]) => {
      if (live) setDone({ from: stat, to: { ...stat, flat, facets: stat.facets ? facets : null } });
    });
    return () => {
      live = false;
    };
  }, [stat]);
  if (!stat.violin) return { draws: stat, boxed: false };
  const draws = done?.from === stat ? done.to : stat;
  const shown = draws.facets && draws.facets.length > 0 ? draws.facets.map((f) => f.draw) : [draws.flat];
  return { draws, boxed: shown.some((d) => d?.mode === "box") };
}
