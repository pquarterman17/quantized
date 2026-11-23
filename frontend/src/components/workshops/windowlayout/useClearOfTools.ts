// A floating plot window that opens under a floating tool window is moved beside
// it (lib/windowLayout/clearance; UX pass 4 M5). Runs for a window that has just
// started floating: opened, reopened, or floated by a button. Not for the
// windows already there when the host mounts (a restore keeps the user's own
// placements), and not for a window the user has just dropped somewhere with
// the pointer (that is their placement).

import { useLayoutEffect, useRef, type RefObject } from "react";

import { clearOfBoxes, type Box } from "../../../lib/windowLayout/clearance";
import { useApp } from "../../../store/useApp";
import { plotWindowOf } from "../../../store/windowLayoutActions";
import { userPlacedJustNow } from "./layoutDrag";

/** The floating tool-band windows' boxes, relative to the desk layer. */
function toolBoxes(layer: HTMLElement): Box[] {
  const at = layer.getBoundingClientRect();
  return [...document.querySelectorAll<HTMLElement>("[data-tool-window]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - at.left, y: r.top - at.top, w: r.width, h: r.height };
  });
}

export function useClearOfTools(layerRef: RefObject<HTMLElement | null>, floatingPlotIds: readonly string[]): void {
  const seen = useRef<ReadonlySet<string> | null>(null);
  const geometry = useApp((s) => s.setWindowGeometry);
  const setGeometry = useRef(geometry);
  setGeometry.current = geometry;
  const key = floatingPlotIds.join(",");
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = new Set(floatingPlotIds);
    const layer = layerRef.current;
    if (!before || !layer || userPlacedJustNow()) return; // the first pass is a restore
    const fresh = floatingPlotIds.filter((id) => !before.has(id));
    if (!fresh.length) return;
    const boxes = toolBoxes(layer);
    if (!boxes.some((b) => b.w > 0)) return;
    const desk = { w: layer.getBoundingClientRect().width };
    for (const id of fresh) {
      const win = plotWindowOf(id);
      if (!win || win.winState !== "normal") continue;
      const next = clearOfBoxes(win.geometry, boxes, desk);
      if (next !== win.geometry) setGeometry.current(id, { x: next.x, w: next.w });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the id list
  }, [key, layerRef]);
}
