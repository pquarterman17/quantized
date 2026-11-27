// The box a Select rows drag ended on, kept in DATA coordinates for the data slicer's
// menu. The drag's own row selection rebuilds the uPlot, which wipes the painted
// .u-select, so the menu cannot read the box back from the DOM. Session-only, never
// persisted. It is forgotten as soon as the selection, the sheet, the axes or the
// curves change by any other route, so a stale box is never offered.

import { useApp } from "../store/useApp";
import type { SliceBox } from "./plotSlice";

let kept: SliceBox | null = null;
let stop: (() => void) | null = null;

/** Forget the remembered box. */
export function forgetSliceBox(): void {
  kept = null;
  stop?.();
  stop = null;
}

/** Remember `box` until the state it was dragged on changes. Call after the drag's selection is written. */
export function rememberSliceBox(box: SliceBox): void {
  forgetSliceBox();
  kept = box;
  const key = (s: ReturnType<typeof useApp.getState>) => [s.selection, s.activeId, s.xKey, s.yKeys, s.y2Keys, s.plotTool];
  let before = key(useApp.getState());
  stop = useApp.subscribe((s) => {
    const now = key(s);
    if (now.some((v, i) => v !== before[i])) forgetSliceBox();
    else before = now;
  });
}

/** The remembered box, or null. */
export function rememberedSliceBox(): SliceBox | null {
  return kept;
}
