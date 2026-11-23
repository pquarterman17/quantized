// The window-layout host (WORKSPACE_LAYOUT_PLAN P1, "option D"). In windows
// mode it takes the place of the classic Stage and Inspector: a toolbar, then
// the desk, with the left and right edge regions full height, the centre and
// the bottom edge between them (the mockup's arrangement), splitters between
// regions, and the floating windows above them all.
//
// Lazy (App.tsx's one `layoutMode === "windows"` mount): nothing in this
// subtree is in the eager bundle. It mounts the same command hooks the classic
// Stage does (undo/redo, the Window menu, recent projects, ...), because Stage
// is not mounted in windows mode.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { stackOf } from "../../../lib/windowLayout/ops";
import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { lazyRegion } from "../../../lib/lazyRegion";
import { useApp } from "../../../store/useApp";
import { applyLayout, isShown } from "../../../store/windowLayoutActions";
import { useProjectLockCommands } from "../../../commands/projectLockCommands";
import { useRecentProjectsCommands } from "../../../commands/recentProjectsCommands";
import { useRelinkCommands } from "../../../commands/relinkCommands";
import { useWorkbookTransferCommands } from "../../../commands/workbookTransferCommands";
import { useHistoryCommands } from "../../history/useHistoryCommands";
import { useWindowCommands } from "../../windows/useWindowCommands";
import DockRegion from "./DockRegion";
import FloatLayer from "./FloatLayer";
import { edgeSize, withEdge, type Edge } from "./layoutGeometry";
import { windowTitle } from "./LayoutWindowContent";
import LayoutToolbar from "./LayoutToolbar";
import Splitter from "./Splitter";
import { useLayoutCommands } from "./useLayoutCommands";
import { useLayoutKeyboard } from "./useLayoutKeyboard";
import { useLayoutSync } from "./useLayoutSync";
import "./windowlayout.css";

const EmptyProjectStage = lazyRegion(() => import("../../Stage/EmptyProjectStage"), "Empty workspace");

type Box = { width: number; height: number };

/** Watch the desk's size: edge clamping, and the float layer's bounds (the
 *  classic `plotCanvasBounds` WindowCanvas publishes, which new windows are
 *  fitted to). */
function useDeskBox(): [React.RefObject<HTMLDivElement | null>, Box | undefined] {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | undefined>(undefined);
  const setPlotCanvasBounds = useApp((s) => s.setPlotCanvasBounds);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (!r) return;
      const next = { width: Math.round(r.width), height: Math.round(r.height) };
      setBox((prev) => (prev?.width === next.width && prev.height === next.height ? prev : next));
      setPlotCanvasBounds(next);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      setPlotCanvasBounds(null);
    };
  }, [setPlotCanvasBounds]);
  return [ref, box];
}

function Desk({ layout }: { layout: WindowLayoutV1 }) {
  const plotWindows = useApp((s) => s.plotWindows);
  const datasets = useApp((s) => s.datasets);
  const hasContent = useApp(
    (s) =>
      s.datasets.length > 0 ||
      s.plotWindows.some((w) => w.kind === "snapshot") ||
      s.pages.length > 0 ||
      s.reports.length > 0 ||
      s.analysisResults.length > 0 ||
      s.originFigures.length > 0 ||
      s.editableFigures.length > 0 ||
      s.figureDocs.length > 0,
  );
  const [deskRef, box] = useDeskBox();
  const titleOf = useCallback((ref: WindowRef) => windowTitle(ref, plotWindows, datasets), [plotWindows, datasets]);
  // isShown reads the plot windows; this component subscribes to them above,
  // so a minimize or restore re-renders the stacks.
  const shown = (slot: "left" | "right" | "bottom" | "centre") => stackOf(layout, slot).filter((r) => isShown(layout, r));
  const left = shown("left");
  const right = shown("right");
  const bottom = shown("bottom");
  const centre = shown("centre");
  const size = (edge: Edge) => edgeSize(layout, edge, box ?? null);
  const resizeEdge = (edge: Edge, sign: 1 | -1) => (delta: number) => applyLayout((l) => withEdge(l, edge, edgeSize(l, edge, box ?? null) + sign * delta));
  const style = { "--wl-left": `${size("left")}px`, "--wl-right": `${size("right")}px`, "--wl-bottom": `${size("bottom")}px` } as CSSProperties;

  return (
    <div className="qzk-wl-desk" ref={deskRef} style={style}>
      {left.length > 0 && (
        <>
          <DockRegion slot="left" refs={left} layout={layout} titleOf={titleOf} />
          <Splitter axis="x" label="Resize the left edge" value={size("left")} onCommit={resizeEdge("left", 1)} />
        </>
      )}
      <div className="qzk-wl-middle">
        {!hasContent ? (
          <EmptyProjectStage />
        ) : centre.length > 0 ? (
          <DockRegion slot="centre" refs={centre} layout={layout} titleOf={titleOf} />
        ) : (
          <div className="qzk-wl-empty">Nothing is docked in the centre; press ▣ on a window title bar to dock it here.</div>
        )}
        {bottom.length > 0 && (
          <>
            <Splitter axis="y" label="Resize the bottom edge" value={size("bottom")} onCommit={resizeEdge("bottom", -1)} />
            <DockRegion slot="bottom" refs={bottom} layout={layout} titleOf={titleOf} />
          </>
        )}
      </div>
      {right.length > 0 && (
        <>
          <Splitter axis="x" label="Resize the right edge" value={size("right")} onCommit={resizeEdge("right", -1)} />
          <DockRegion slot="right" refs={right} layout={layout} titleOf={titleOf} />
        </>
      )}
      <FloatLayer layout={layout} bounds={box} titleOf={titleOf} />
    </div>
  );
}

export default function LayoutHost() {
  useWindowCommands();
  useHistoryCommands();
  useRecentProjectsCommands();
  useRelinkCommands();
  useWorkbookTransferCommands();
  useProjectLockCommands();
  useLayoutCommands();
  useLayoutSync();
  const layout = useApp((s) => s.windowLayout);
  const libraryShown = useApp((s) => !s.leftCollapsed);
  useLayoutKeyboard(layout, libraryShown);

  return (
    <section className="qzk-wl" aria-label="Window layout (preview)" aria-busy={layout ? undefined : true}>
      {layout && (
        <>
          <LayoutToolbar layout={layout} />
          <Desk layout={layout} />
        </>
      )}
    </section>
  );
}
