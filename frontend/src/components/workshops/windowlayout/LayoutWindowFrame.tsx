// One DOCKED layout window (WORKSPACE_LAYOUT_PLAN P1, "Keyboard and
// accessibility"): a `role="region"` named by its title, with a title bar
// carrying the dock buttons and Close. A floating window uses the existing
// frames instead (PlotWindowFrame for a plot window, ToolWindow for Style), so
// move/resize keep one implementation each.
//
// Escape is never handled here: it does not close, dock or float a window.

import { useId } from "react";

import type { Slot, WindowRef } from "../../../lib/windowLayout/types";
import { useApp } from "../../../store/useApp";
import { closeRef, focusRef, plotIdOf } from "../../../store/windowLayoutActions";
import { DataTitle } from "./DataWindow";
import DockButtons from "./DockButtons";
import { dragFromPointerDown } from "./layoutDrag";
import LayoutWindowContent from "./LayoutWindowContent";

const WHERE: Record<Slot, string> = { left: "docked left", right: "docked right", bottom: "docked bottom", centre: "docked centre" };

export default function LayoutWindowFrame({ refId, slot, title }: { refId: WindowRef; slot: Slot; title: string }) {
  const titleId = useId();
  const id = plotIdOf(refId);
  const focused = useApp((s) => id !== null && s.focusedWindowId === id);
  return (
    <section
      className={`qzk-wl-frame${focused ? " focused" : ""}`}
      role="region"
      aria-labelledby={titleId}
      data-wl-window={refId}
      onPointerDownCapture={() => focusRef(refId)}
    >
      <div className="qzk-wl-title" title="Drag the title bar to dock or float the window." onPointerDown={(e) => dragFromPointerDown(e, { ref: refId, title, docked: true })}>
        <span className="qzk-wl-title-text" id={titleId}>
          {title}
        </span>
        {refId === "data" && <DataTitle />}
        <span className="qzk-wl-where">{WHERE[slot]}</span>
        <DockButtons refId={refId} slot={slot} title={title} />
        <button
          type="button"
          className="qzk-wl-close"
          aria-label={`Close ${title}`}
          title="Close this window."
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => closeRef(refId)}
        >
          ✕
        </button>
      </div>
      <div className="qzk-wl-body">
        <LayoutWindowContent refId={refId} />
      </div>
    </section>
  );
}
