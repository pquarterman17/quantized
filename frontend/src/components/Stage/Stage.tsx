// Stage cell: tab strip (Plot · Map · Worksheet) over the active view. The
// Plot tab renders `WindowCanvas` (MULTI_PLOT_PLAN item 3) — the MDI plot-
// window host; it collapses to today's single-window full-bleed `PlotStage`
// with no chrome whenever there's exactly one maximized window (the item-3/4
// migration guarantee). `useWindowCommands` (item 5) is mounted here rather
// than in `WindowCanvas` (which only exists while the Plot tab is showing) or
// `App.tsx` (its curated-actions list is line-pinned) — Stage stays mounted
// for the app's whole lifetime regardless of which tab is active, so the
// Window menu/⌘K entries and their keyboard shortcuts always work.
// `useHistoryCommands` (MAIN_PLAN #9, undo/redo) is mounted here for the
// identical reason — Ctrl+Z must work no matter which stage tab is showing.
// `useRecentProjectsCommands` (P1.1 C4, Recent Projects) is mounted here for
// the same reason again — its ⌘K entries must exist regardless of tab.
//
// CODE SPLITTING: the Map and Worksheet tabs are dynamic imports — only one
// tab is ever visible at a time, and "plot" is every fresh workspace's
// default (item 6), so a first-paint user pays only for `WindowCanvas`. Map
// additionally pulls in `d3-contour` (mapRender.ts -> lib/contour.ts), a real
// external dependency with no business in the eager bundle for a plot-only
// session. `DocumentWindow.tsx` lazy-imports the SAME two chunks for its
// worksheet/map MDI document windows (MULTI_PLOT_PLAN item 17); Vite dedups
// the two dynamic-import sites into one chunk each, so opening a document
// window after already visiting the matching tab (or vice versa) is a cache
// hit, not a second fetch.

import { useEffect } from "react";

import { canRenderMap } from "../../lib/mapdata";
import { lazyRegion } from "../../lib/lazyRegion";
import { plotIntentStageTab } from "../../lib/stagetab";
import { onTabListKeyDown } from "../../lib/tabListKeys";
import { useActiveDataset, useApp } from "../../store/useApp";
import { useRecentProjectsCommands } from "../../commands/recentProjectsCommands";
import { useRelinkCommands } from "../../commands/relinkCommands";
import { useProjectLockCommands } from "../../commands/projectLockCommands";
import { useWorkbookTransferCommands } from "../../commands/workbookTransferCommands";
import { useHistoryCommands } from "../history/useHistoryCommands";
import { useWindowCommands } from "../windows/useWindowCommands";
import WindowCanvas from "../windows/WindowCanvas";
import { PendingWorkspace } from "../Shell/workspaceSeams";

const EmptyProjectStage = lazyRegion(() => import("./EmptyProjectStage"), "Empty workspace");
const MapStage = lazyRegion(() => import("./MapStage"), "Map");
const Worksheet = lazyRegion(() => import("./Worksheet"), "Worksheet");
const WindowWorkspaceControls = lazyRegion(
  () => import("../windows/WindowWorkspaceControls"),
  "Window controls",
  () => null,
);
const TechniqueWorkspace = lazyRegion(
  () => import("../workshops/techniqueworkspace/TechniqueWorkspace"),
  "Workflow",
  ({ onClose }) => <PendingWorkspace className="qzk-technique-workspace" label="Workflow" onClose={onClose} />,
);

const TABS = [
  { id: "plot", label: "Plot" },
  { id: "map", label: "Map" },
  { id: "worksheet", label: "Worksheet" },
  { id: "technique", label: "Workflow" },
] as const;

export default function Stage() {
  const stageTab = useApp((s) => s.stageTab);
  const setStageTab = useApp((s) => s.setStageTab);
  // A snapshot window always carries its frozen bundle (sanitizePlotWindows
  // drops one without), so its kind alone says it can render.
  const hasRenderableContent = useApp((s) =>
    s.datasets.length > 0 ||
    s.plotWindows.some((w) => w.kind === "snapshot") ||
    s.pages.length > 0 ||
    s.reports.length > 0 ||
    s.originFigures.length > 0 ||
    s.editableFigures.length > 0 ||
    s.figureDocs.length > 0,
  );
  const active = useActiveDataset();
  useWindowCommands();
  useHistoryCommands();
  useRecentProjectsCommands();
  useRelinkCommands();
  useWorkbookTransferCommands();
  useProjectLockCommands();

  // Owner request 2026-07-25: the Map tab is CONTEXTUAL. A 1-D dataset can
  // never produce a map, so the tab was a permanent invitation to a screen that
  // only apologises. Same capability rule MapStage itself uses (lib/mapdata),
  // not a second copy of it.
  const mappable = canRenderMap(active?.data);
  const tabs = TABS.filter((t) => t.id !== "map" || mappable);

  // Falling back matters as much as hiding: switching to a 1-D dataset while
  // the Map tab is open would otherwise strand the user on a tab that no longer
  // has a strip entry, with no visible way back.
  useEffect(() => {
    if (stageTab === "map" && !mappable) setStageTab("plot");
  }, [stageTab, mappable, setStageTab]);

  // A fresh/cleared project keeps the command-registration hooks above
  // mounted. Do not key this on `active`: focusing a frozen snapshot clears
  // activeId, and a snapshot-only workspace remains fully renderable.
  if (!hasRenderableContent) return <EmptyProjectStage />;
  // The view actually on screen: a stranded Map (pre-fallback) shows the plot.
  const shown = stageTab === "map" && !mappable ? "plot" : stageTab;

  return (
    <section className="qzk-stage-cell">
      {/* WAI-ARIA tablist, MANUAL activation (lib/tabListKeys): showing a view
          mounts a lazy chunk and tears down the plot windows, so arrowing
          across the strip moves focus only and Enter/Space selects. */}
      <div className="qzk-stagebar">
        <div className="qzk-tabs" role="tablist" aria-label="Stage view" onKeyDown={(e) => onTabListKeyDown(e, false)}>
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`qz-stage-${t.id}`}
              aria-selected={shown === t.id}
              aria-controls="qz-stage-panel"
              tabIndex={shown === t.id ? 0 : -1}
              className={`qzk-tab${shown === t.id ? " active" : ""}`}
              onClick={() => setStageTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <WindowWorkspaceControls />
      </div>
      <div className="qzk-stage-panel" role="tabpanel" id="qz-stage-panel" aria-labelledby={`qz-stage-${shown}`}>
        {shown === "map" ? (
          <MapStage />
        ) : shown === "worksheet" ? (
          <Worksheet />
        ) : shown === "technique" ? (
          <TechniqueWorkspace onClose={() => setStageTab(active ? plotIntentStageTab(active) : "plot")} />
        ) : (
          <WindowCanvas />
        )}
      </div>
    </section>
  );
}
