// Small screens (owner decision D6, plan P5). The default keeps the windows
// floating on a narrow screen (the seed and a tool's first placement do that)
// and this hook does nothing. With Preferences ▸ "Small screens: tile below"
// set, while the viewport is narrower than that width the windows on screen are
// tiled in the centre grid, and widening past it gives back the user's own
// layout, which the width rule never overwrites (lib/windowLayout/narrowTile).
// Turning the setting off, or switching it to "keep floating", gives it back too.

import { useEffect, useRef, useState } from "react";

import { isNarrow, tileNarrow, untile } from "../../../lib/windowLayout/narrowTile";
import { stackOf } from "../../../lib/windowLayout/ops";
import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import type { PlotWindow } from "../../../lib/plotview";
import { useApp } from "../../../store/useApp";
import { applyLayout, isShown, restoreLayout } from "../../../store/windowLayoutActions";
import { holdAnnouncement } from "./layoutAnnounce";

const viewportWidth = (): number => (typeof window === "undefined" ? Infinity : window.innerWidth);

/** The windows on screen, in reading order (docked left, centre, right, bottom, then floating back to front). */
export function shownInReadingOrder(l: WindowLayoutV1, plotWindows: readonly PlotWindow[]): WindowRef[] {
  const docked = (["left", "centre", "right", "bottom"] as const).flatMap((s) => stackOf(l, s));
  return [...docked, ...l.z].filter((r) => isShown(l, r, plotWindows));
}

/** Track the viewport width (resize events). */
function useViewportWidth(): number {
  const [width, setWidth] = useState(viewportWidth);
  useEffect(() => {
    const on = () => setWidth(viewportWidth());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return width;
}

export function useNarrowTile(layout: WindowLayoutV1 | null, tools: ReadonlyMap<string, unknown>): void {
  const below = useApp((s) => s.layoutTileBelow);
  const plotWindows = useApp((s) => s.plotWindows);
  const width = useViewportWidth();
  const narrow = isNarrow(below, width);

  // Said when the width rule starts or stops holding (not when a project loads under it, nor per window
  // that joins the grid), INSTEAD of the layout diff's own sentence ("3 windows tiled in the centre").
  const was = useRef(false);

  useEffect(() => {
    if (!layout) return;
    const turned = was.current !== narrow;
    was.current = narrow;
    const say = narrow ? `The window is narrower than ${below} px, so the windows are tiled. Widen it to get your layout back.` : "Your window layout is back. Windows you opened or closed while it was narrow stay as they are; moves made while tiled are not kept.";
    if (!narrow) {
      if (!layout.tiled) return;
      if (turned) holdAnnouncement(say);
      restoreLayout(untile); // exactly the saved desk: no plot window is re-stacked or un-maximized
      return;
    }
    // `tools` is a dependency: a tool window is shown only while its tool is mounted.
    void tools;
    const op = (l: WindowLayoutV1) => tileNarrow(l, shownInReadingOrder(l, plotWindows));
    if (turned && op(layout) !== layout) holdAnnouncement(say);
    applyLayout(op, false); // the tile is the width rule's, not the user's desk
  }, [narrow, below, layout, plotWindows, tools]);
}
