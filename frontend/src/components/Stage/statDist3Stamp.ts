// The item 20 options that never need a refetch: stamped onto the settled draw, so
// toggling one redraws at once and the export reads the same draw. Identity is kept
// when nothing changes (the draw is a memo dependency downstream).

import { useMemo } from "react";

import type { RugPick } from "../../lib/statCdf";
import type { DataStruct } from "../../lib/types";
import type { StatStagePicks } from "./useStatStagePicks";
import type { StatDrawData } from "./statRender";
import { withRug, withStack } from "./statSampleDraw";

type Stamped = Pick<StatStagePicks["dist2"], "histStack" | "violinMarks" | "pairedDirection" | "lollipopHoriz">;

export function withDist3(draw: StatDrawData | null, o: Stamped): StatDrawData | null {
  if (!draw) return draw;
  if (draw.mode === "histogram") return withStack(draw, o.histStack);
  if (draw.mode === "sideviolin") return (draw.innerMarks ?? "none") === o.violinMarks ? draw : { ...draw, innerMarks: o.violinMarks };
  if (draw.mode === "paired") return !!draw.direction === o.pairedDirection ? draw : { ...draw, direction: o.pairedDirection };
  if (draw.mode === "lollipop") return !!draw.horizontal === o.lollipopHoriz ? draw : { ...draw, horizontal: o.lollipopHoriz };
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
  const { histStack, violinMarks, pairedDirection, lollipopHoriz } = o;
  return useMemo(
    () => withDist3(withRug(draw, data, histCols, valueCol, rug), { histStack, violinMarks, pairedDirection, lollipopHoriz }),
    [draw, data, histCols, valueCol, rug, histStack, violinMarks, pairedDirection, lollipopHoriz],
  );
}
