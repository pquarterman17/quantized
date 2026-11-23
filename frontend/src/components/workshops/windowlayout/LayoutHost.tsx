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
import { kindOf } from "../../../lib/windowLayout/refs";
import type { WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";
import { lazyRegion } from "../../../lib/lazyRegion";
import { useApp } from "../../../store/useApp";
import { hasLayoutReturn, takeLayoutReturn } from "../../../store/layoutReturn";
import { setLayoutHostMounted, useLayoutTools } from "../../../store/layoutTools";
import { applyLayout, installStyleToggle, isShown } from "../../../store/windowLayoutActions";
import { useProjectLockCommands } from "../../../commands/projectLockCommands";
import { useRecentProjectsCommands } from "../../../commands/recentProjectsCommands";
import { useRelinkCommands } from "../../../commands/relinkCommands";
import { useWorkbookTransferCommands } from "../../../commands/workbookTransferCommands";
import { useHistoryCommands } from "../../history/useHistoryCommands";
import { useWindowCommands } from "../../windows/useWindowCommands";
import DockRegion from "./DockRegion";
import DropZones from "./DropZones";
import FloatLayer from "./FloatLayer";
import { edgeMin, edgeSizes, withEdge, type Edge } from "./layoutGeometry";
import { announce } from "./layoutAnnounce";
import { windowTitle } from "./LayoutWindowContent";
import LayoutAnnouncer from "./LayoutAnnouncer";
import LayoutToolbar from "./LayoutToolbar";
import Splitter from "./Splitter";
import { useLayoutCommands } from "./useLayoutCommands";
import { focusTitleBar, useLayoutKeyboard } from "./useLayoutKeyboard";
import { useLayoutSync } from "./useLayoutSync";
import ToolWindowsSync from "./ToolWindowsSync";
import { useMoveMode } from "./useMoveMode";
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
    let last: Box | null = null;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (!r) return;
      const next = { width: Math.round(r.width), height: Math.round(r.height) };
      // A repeated unchanged box must not broadcast to every window subscriber.
      if (last?.width === next.width && last.height === next.height) return;
      last = next;
      setBox(next);
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

function Desk({ layout, titleOf }: { layout: WindowLayoutV1; titleOf: (ref: WindowRef) => string }) {
  const plotWindows = useApp((s) => s.plotWindows);
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
  const shown = (slot: "left" | "right" | "bottom" | "centre") => stackOf(layout, slot).filter((r) => isShown(layout, r, plotWindows));
  const left = shown("left");
  const right = shown("right");
  const bottom = shown("bottom");
  const centre = shown("centre");
  const floatingShown = layout.z.some((r) => layout.placements[r]?.slot === null && isShown(layout, r, plotWindows));
  const hasPlot = (refs: readonly WindowRef[]) => refs.some((r) => kindOf(r) === "plot");
  const sizes = edgeSizes(
    layout,
    box ?? null,
    { left: left.length > 0, right: right.length > 0, bottom: bottom.length > 0 },
    { left: hasPlot(left), right: hasPlot(right), bottom: hasPlot(bottom) },
  );
  const size = (edge: Edge) => sizes[edge];
  // "Resize the right dock (Style, Data)": the edge by the windows it holds, its size read in px.
  const edgeLabel = (edge: Edge, refs: readonly WindowRef[]) => `Resize the ${edge} dock (${refs.map(titleOf).join(", ")})`;
  // The range the splitter can really reach: the edge's minimum (larger when it holds a plot) up to 60% of the desk.
  const px = (edge: Edge, refs: readonly WindowRef[]) => {
    const min = edgeMin(edge, hasPlot(refs));
    const span = box ? (edge === "bottom" ? box.height : box.width) : 0;
    return { value: size(edge), valueText: `${size(edge)} px`, range: [min, Math.max(min, size(edge), Math.floor(span * 0.6))] as [number, number] };
  };
  const resizeEdge = (edge: Edge, sign: 1 | -1) => (delta: number) => applyLayout((l) => withEdge(l, edge, sizes[edge] + sign * delta));
  const style = { "--wl-left": `${sizes.left}px`, "--wl-right": `${sizes.right}px`, "--wl-bottom": `${sizes.bottom}px` } as CSSProperties;

  return (
    <div className="qzk-wl-desk" ref={deskRef} style={style}>
      {left.length > 0 && (
        <>
          <DockRegion slot="left" refs={left} layout={layout} titleOf={titleOf} />
          <Splitter axis="x" label={edgeLabel("left", left)} {...px("left", left)} onCommit={resizeEdge("left", 1)} />
        </>
      )}
      <div className="qzk-wl-middle">
        {!hasContent ? (
          <EmptyProjectStage />
        ) : centre.length > 0 ? (
          <DockRegion slot="centre" refs={centre} layout={layout} titleOf={titleOf} />
        ) : (
          // Under a floating window the hint would peek out around it: say nothing then.
          <div className="qzk-wl-empty">{floatingShown ? null : "Nothing is docked in the centre; press ▣ on a window title bar to dock it here."}</div>
        )}
        {bottom.length > 0 && (
          <>
            <Splitter axis="y" label={edgeLabel("bottom", bottom)} {...px("bottom", bottom)} onCommit={resizeEdge("bottom", -1)} />
            <DockRegion slot="bottom" refs={bottom} layout={layout} titleOf={titleOf} />
          </>
        )}
      </div>
      {right.length > 0 && (
        <>
          <Splitter axis="x" label={edgeLabel("right", right)} {...px("right", right)} onCommit={resizeEdge("right", -1)} />
          <DockRegion slot="right" refs={right} layout={layout} titleOf={titleOf} />
        </>
      )}
      <FloatLayer layout={layout} bounds={box} titleOf={titleOf} />
      <DropZones />
      <LayoutAnnouncer layout={layout} titleOf={titleOf} />
    </div>
  );
}

// An analysis tool's layout window, loaded by overlays/ToolWindow.tsx from THIS module so it shares the
// host's chunk (and its tool registry) instead of splitting a chunk the entry bundle would have to name.
export { default as LayoutToolWindow } from "./LayoutToolWindow";

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
  const plotWindows = useApp((s) => s.plotWindows);
  const datasets = useApp((s) => s.datasets);
  // The mounted tool windows (their titles; a tool's window shows only while it is open).
  const tools = useLayoutTools();
  const titleOf = useCallback((ref: WindowRef) => windowTitle(ref, plotWindows, datasets, tools), [plotWindows, datasets, tools]);
  // Move mode's banner lives in the toolbar row, never over a window.
  const moving = useMoveMode(layout, titleOf);
  const libraryShown = useApp((s) => !s.leftCollapsed);
  useLayoutKeyboard(layout, libraryShown);
  // ⌘] and View ▸ Toggle inspector act on the Style window while this is mounted.
  useEffect(installStyleToggle, []);
  // Tools open as layout windows only while this host is on screen (store/layoutTools).
  useEffect(() => {
    setLayoutHostMounted(true);
    return () => setLayoutHostMounted(false);
  }, []);

  // Back from a full-workspace view that a layout window started: focus its title bar (or the toolbar).
  useEffect(() => {
    if (!hasLayoutReturn()) return;
    // Taken when the frame fires, not here: StrictMode runs this effect twice, cancelling the first frame.
    const frame = requestAnimationFrame(() => {
      const ref = takeLayoutReturn();
      if (!ref) return;
      focusTitleBar(ref);
      if (!document.activeElement?.closest("[data-wl-window], [data-tool-window]")) document.querySelector<HTMLElement>(".qzk-wl-toolbar button")?.focus();
      announce("Back in the window layout; your windows are as you left them.");
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section className="qzk-wl" aria-label="Window layout (preview)" aria-busy={layout ? undefined : true}>
      {layout && (
        <>
          <LayoutToolbar layout={layout} moving={moving} />
          <Desk layout={layout} titleOf={titleOf} />
          <ToolWindowsSync />
        </>
      )}
    </section>
  );
}
