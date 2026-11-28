// The item 20 variants (half / split violin, lollipop, paired, a histogram split by a group)
// under "facet by": one panel per level of the facet column, each drawn exactly as the plot
// is drawn alone from that level's rows (`computeGroupedDraw`, `computePairedDraw`,
// `computeGroupHistogramDraw` on the slice). The options that never refetch (inner marks,
// direction, horizontal, stack) are stamped on afterwards (`statDist3Stamp`), so toggling one
// redraws every panel at once. A panel that cannot draw (a split violin whose level has one
// "then by" value, fewer than two paired rows ...) is left out and named in `skipped`; the
// stage says so, it never draws a panel from other rows.

import type { FacetSlice } from "../../lib/facet";
import { resolveGroups, type StatMode } from "../../lib/statstage";
import { computeGroupedDraw, computePairedDraw, type GroupedOpts } from "./statDist3Draw";
import { computeGroupHistogramDraw } from "./statHistMulti";
import type { StatDrawData } from "./statRender";
import type { FacetDraw } from "./useStatStageCompute";

export type FacetVariant = "sideviolin" | "lollipop" | "paired" | "histogram";

/** The variant `mode` draws as under a facet column, or null (a plain histogram, Q-Q ... are not faceted). */
export function facetVariant(mode: StatMode, splitHist: boolean): FacetVariant | null {
  if (mode === "sideviolin" || mode === "lollipop" || mode === "paired") return mode;
  return mode === "histogram" && splitHist ? "histogram" : null;
}

export interface FacetVariantOpts extends GroupedOpts {
  groupCol: number | null;
  group2Col: number | null;
  valueCol: number;
  plotted: readonly number[];
  histCols: readonly number[];
  pairedCi: boolean;
  bins: string;
}

async function sliceDraw(s: FacetSlice, v: FacetVariant, o: FacetVariantOpts): Promise<StatDrawData> {
  if (v === "paired") return computePairedDraw(s.data, { yCol: o.valueCol, histCols: o.histCols, ci: o.pairedCi });
  const groups = resolveGroups(s.data, o.groupCol, o.valueCol, o.plotted, o.group2Col).filter((g) => g.values.length > 0);
  if (!groups.length) throw new Error("no finite values to group");
  return v === "histogram" ? computeGroupHistogramDraw(groups, o.bins, o.valueLabel) : computeGroupedDraw(v, groups, o);
}

/** One draw per facet level; a level that cannot draw is named in `skipped` ("level: reason"). */
export async function computeFacetVariantDraws(
  slices: readonly FacetSlice[],
  v: FacetVariant,
  o: FacetVariantOpts,
): Promise<{ facets: FacetDraw[]; skipped: string[] }> {
  const rs = await Promise.all(
    slices.map(async (s): Promise<FacetDraw | string> => {
      try {
        return { label: s.label, draw: await sliceDraw(s, v, o) };
      } catch (e) {
        return `${s.label}: ${e instanceof Error ? e.message : "cannot be drawn"}`;
      }
    }),
  );
  return {
    facets: rs.filter((r): r is FacetDraw => typeof r !== "string"),
    skipped: rs.filter((r): r is string => typeof r === "string"),
  };
}
