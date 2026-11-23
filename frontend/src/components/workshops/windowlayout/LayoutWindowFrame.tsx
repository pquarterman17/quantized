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
import { focusRef, isLastPlotWindow, LAST_PLOT_REASON, plotIdOf } from "../../../store/windowLayoutActions";
import { closeFromChrome } from "./chromeActions";
import { AnalysisTitle } from "./AnalysisTitle";
import { DataTitle } from "./DataWindow";
import DockButtons from "./DockButtons";
import { dragFromPointerDown } from "./layoutDrag";
import LayoutWindowContent from "./LayoutWindowContent";
import ToolTitle from "./ToolTitle";


const WHERE: Record<Slot, string> = { left: "docked left", right: "docked right", bottom: "docked bottom", centre: "docked centre" };

export default function LayoutWindowFrame({ refId, slot, title }: { refId: WindowRef; slot: Slot; title: string }) {
  const titleId = useId();
  const id = plotIdOf(refId);
  const focused = useApp((s) => id !== null && s.focusedWindowId === id);
  // The store keeps one plot window: say so on the button instead of a silent no-op.
  const lastPlot = useApp((s) => isLastPlotWindow(refId, s.plotWindows));
  return (
    <section
      className={`qzk-wl-frame${focused ? " focused" : ""}`}
      role="region"
      aria-labelledby={titleId}
      data-wl-window={refId}
      onPointerDownCapture={() => focusRef(refId)}
    >
      <div
        className="qzk-wl-title"
        role="group"
        aria-label={`${title} title bar`}
        tabIndex={-1}
        data-wl-focus={refId}
        title="Drag the title bar to dock or float the window."
        onPointerDown={(e) => dragFromPointerDown(e, { ref: refId, title, docked: true })}
      >
        <span className="qzk-wl-title-text" id={titleId}>
          {title}
        </span>
        {refId === "data" && <DataTitle />}
        {refId === "analysis" && <AnalysisTitle />}
        {refId.startsWith("tool:") && <ToolTitle id={refId.slice(5)} />}
        {refId !== "data" && refId !== "analysis" && <span className="qzk-wl-where">{WHERE[slot]}</span>}
        <DockButtons refId={refId} slot={slot} title={title} marker={false} />
        <button
          type="button"
          className="qzk-wl-close"
          aria-label={`Close ${title}`}
          aria-disabled={lastPlot || undefined}
          title={lastPlot ? LAST_PLOT_REASON : "Close this window."}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => closeFromChrome(refId)}
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
