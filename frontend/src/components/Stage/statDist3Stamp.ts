// The item 20 options that never need a refetch: stamped onto the settled draw, so
// toggling one redraws at once and the export reads the same draw. Identity is kept
// when nothing changes (the draw is a memo dependency downstream).

import { useMemo } from "react";

import type { RugPick } from "../../lib/statCdf";
import { lollipopSeries } from "../../lib/statDist3";
import type { DataStruct } from "../../lib/types";
import type { StatStagePicks } from "./useStatStagePicks";
import type { FacetDraw } from "./useStatStageCompute";
import type { StatDrawData } from "./statRender";
import type { RidgelineDraw } from "./statRenderRidgeline";
import { withRug, withStack } from "./statSampleDraw";

type Stamped = Pick<
  StatStagePicks["dist2"],
  "histStack" | "violinMarks" | "pairedDirection" | "lollipopHoriz" | "violinMean" | "violinRain" | "pairedTol" | "histPercent" | "lollipopWhisker" | "lollipopCaps" | "ridgeShared"
>;

/** The 100 % stack: only a stacked draw of two or more series has one. */
function withPercent(draw: StatDrawData, percent: boolean): StatDrawData {
  if (draw.mode !== "histogram") return draw;
  const on = percent && !!draw.stack && (draw.series?.length ?? 0) > 1;
  return !!draw.percent === on ? draw : { ...draw, percent: on };
}

export function withDist3(draw: StatDrawData | null, o: Stamped): StatDrawData | null {
  if (!draw) return draw;
  if (draw.mode === "histogram") {
    const stacked = withStack(draw, o.histStack);
    return stacked && withPercent(stacked, o.histPercent);
  }
  if (draw.mode === "sideviolin") {
    const same = (draw.innerMarks ?? "none") === o.violinMarks && !!draw.meanMarker === o.violinMean && !!draw.rain === o.violinRain;
    return same ? draw : { ...draw, innerMarks: o.violinMarks, meanMarker: o.violinMean, rain: o.violinRain };
  }
  if (draw.mode === "paired") {
    return !!draw.direction === o.pairedDirection && (draw.tol ?? 0) === o.pairedTol ? draw : { ...draw, direction: o.pairedDirection, tol: o.pairedTol };
  }
  if (draw.mode === "lollipop") {
    // Whiskers are the mean's: a median lollipop keeps none (the controls say so).
    const whisker = draw.series.stat === "mean" ? o.lollipopWhisker : "none";
    const caps = o.lollipopCaps && whisker !== "none";
    if (!!draw.horizontal === o.lollipopHoriz && (draw.series.whisker ?? "none") === whisker && !!draw.caps === caps) return draw;
    const series = (draw.series.whisker ?? "none") === whisker ? draw.series : lollipopSeries(draw.groups, draw.series.stat, draw.series.sort, whisker);
    return { ...draw, series, horizontal: o.lollipopHoriz, caps };
  }
  return draw;
}

/** The settled draw with the rug and the item 20 options stamped on (memoised on the picks,
 *  not on the `dist2` object, which is rebuilt every render). */
export function useStampedDraw(
  draw: StatDrawData | null,
  data: DataStruct | null,
  histCols: readonly number[],
  valueCol: number,
  rug: RugPick | undefined,
  o: Stamped,
): StatDrawData | null {
  const { histStack, violinMarks, pairedDirection, lollipopHoriz, violinMean, violinRain, pairedTol, histPercent, lollipopWhisker, lollipopCaps, ridgeShared } = o;
  return useMemo(
    () => withDist3(withRug(draw, data, histCols, valueCol, rug), { histStack, violinMarks, pairedDirection, lollipopHoriz, violinMean, violinRain, pairedTol, histPercent, lollipopWhisker, lollipopCaps, ridgeShared }),
    [draw, data, histCols, valueCol, rug, histStack, violinMarks, pairedDirection, lollipopHoriz, violinMean, violinRain, pairedTol, histPercent, lollipopWhisker, lollipopCaps, ridgeShared],
  );
}

/** A ridgeline grid on one density scale (opt-in): every panel takes the tallest density of all of
 *  them. Off, or a single panel, clears it; the panels' own wire is never touched. */
function withSharedRidgeScale(facets: FacetDraw[], shared: boolean): FacetDraw[] {
  const ridges = facets.filter((f) => f.draw.mode === "ridgeline");
  if (!ridges.length) return facets;
  const top = shared && ridges.length > 1 ? Math.max(...ridges.map((f) => (f.draw as RidgelineDraw).wire.d_max)) : undefined;
  return facets.map((f) => {
    if (f.draw.mode !== "ridgeline") return f;
    const { sharedMax, ...rest } = f.draw as RidgelineDraw;
    if (sharedMax === top) return f;
    return { ...f, draw: top == null ? rest : { ...rest, sharedMax: top } };
  });
}

/** The facet panels with the same options stamped on (identity kept when no panel changes). */
export function useStampedFacets(facets: FacetDraw[] | null, o: Stamped): FacetDraw[] | null {
  const { histStack, violinMarks, pairedDirection, lollipopHoriz, violinMean, violinRain, pairedTol, histPercent, lollipopWhisker, lollipopCaps, ridgeShared } = o;
  return useMemo(() => {
    if (!facets) return facets;
    const out = facets.map((f) => {
      const draw = withDist3(f.draw, { histStack, violinMarks, pairedDirection, lollipopHoriz, violinMean, violinRain, pairedTol, histPercent, lollipopWhisker, lollipopCaps, ridgeShared });
      return draw === f.draw || !draw ? f : { ...f, draw };
    });
    const scaled = withSharedRidgeScale(out, ridgeShared);
    return scaled.some((f, i) => f !== facets[i]) ? scaled : facets;
  }, [facets, histStack, violinMarks, pairedDirection, lollipopHoriz, violinMean, violinRain, pairedTol, histPercent, lollipopWhisker, lollipopCaps, ridgeShared]);
}
