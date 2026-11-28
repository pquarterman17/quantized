// The Select rows box on the panels of a multi-panel layout: what each leg of `useMultiPanelStage` needs to hand a
// drag to `usePanelBoxSelect`. A panel's own `hooks` are replaced by its leg (the x-zoom sync), which used to drop
// `buildOpts`'s drag-end hook too, so a box drawn there did nothing; these keep it, and name the panel it was drawn in.

import type uPlot from "uplot";

import type { PanelBoxPick } from "../../lib/panelBoxRows";

/** The layouts a box can be drawn in. */
export type PanelKind = "facet" | "break" | "stack" | "spatial";

/** A box drawn in panel `index` of a `kind` layout (an x band when `pick.y` is absent). */
export type PanelBoxHandler = (kind: PanelKind, index: number, pick: PanelBoxPick) => void;

/** `buildOpts`'s `onRangeSelect` for panel `index`: the drag's data-coordinate band or box, to `onBox`. */
export const panelRangeSelect =
  (onBox: PanelBoxHandler | undefined, kind: PanelKind, index: number) =>
  (onBox ? (x0: number, x1: number, y?: [number, number]) => onBox(kind, index, { x0, x1, ...(y ? { y } : {}) }) : undefined);

/** `opts.hooks` with `setScale` added, keeping the box tool's drag-end and live-box hooks `buildOpts` made. */
export function withBoxHooks(opts: uPlot.Options, setScale: NonNullable<uPlot.Hooks.Arrays["setScale"]>): uPlot.Hooks.Arrays {
  const { setSelect, setCursor } = opts.hooks ?? {};
  return { setScale, ...(setSelect ? { setSelect } : {}), ...(setCursor ? { setCursor } : {}) };
}

/** Under the Select rows tool a box belongs to the panel it is drawn in: no other panel mirrors the drag (uPlot's
 *  cursor sync would paint the band across every panel) and the cursor does not follow either. */
export function boxCursor(opts: uPlot.Options, tool: string, sync: uPlot.Cursor.Sync): uPlot.Cursor {
  return { ...opts.cursor, sync: tool === "select" ? { ...sync, filters: { pub: () => false, sub: () => false } } : sync };
}

/** Keep a Select-rows drag following the pointer after it leaves its panel, clamped to the panel's edge
 *  (acceptance pass 13, U1). uPlot only updates a drag from mousemoves over the panel itself, so the box
 *  froze at the exit point and a diagonal drag out of a panel selected too few rows. While the left button
 *  is down, the pointer's position on the document drives `setCursor`, clamped to the plot area, and uPlot's
 *  own mouseleave (which parks the cursor at -10) is held back. Everything is attached at mousedown and
 *  removed at mouseup, so nothing outlives the drag or the panel. */
export function clampBoxDragToPanel(u: uPlot, tool: string): void {
  if (tool !== "select") return;
  const over = u.over;
  over.addEventListener("mousedown", (down) => {
    if (down.button !== 0) return;
    const onLeave = (e: Event) => e.stopImmediatePropagation();
    const onMove = (e: MouseEvent) => {
      if ((e.buttons & 1) === 0) return end(); // the button was released outside the window
      if (over.contains(e.target as Node)) return; // uPlot follows the pointer over the panel itself
      const r = over.getBoundingClientRect();
      const at = (v: number, size: number) => Math.min(Math.max(v, 0), size);
      u.setCursor({ left: at(e.clientX - r.left, r.width), top: at(e.clientY - r.top, r.height) });
    };
    const end = () => {
      u.root.removeEventListener("mouseleave", onLeave, true);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", end, true);
    };
    u.root.addEventListener("mouseleave", onLeave, true); // an ancestor in the capture phase runs before uPlot's own listener
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", end, true);
  });
}
