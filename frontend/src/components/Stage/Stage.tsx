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

import { useEffect } from "react";

import MapStage from "./MapStage";
import { canRenderMap } from "../../lib/mapdata";
import Worksheet from "./Worksheet";
import { useActiveDataset, useApp } from "../../store/useApp";
import { useHistoryCommands } from "../history/useHistoryCommands";
import { useWindowCommands } from "../windows/useWindowCommands";
import WindowCanvas from "../windows/WindowCanvas";

const TABS = [
  { id: "plot", label: "Plot" },
  { id: "map", label: "Map" },
  { id: "worksheet", label: "Worksheet" },
] as const;

export default function Stage() {
  const stageTab = useApp((s) => s.stageTab);
  const setStageTab = useApp((s) => s.setStageTab);
  const active = useActiveDataset();
  useWindowCommands();
  useHistoryCommands();

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

  return (
    <section className="qzk-stage-cell">
      <div className="qzk-tabs">
        {tabs.map((t) => (
          <span
            key={t.id}
            className={`qzk-tab${stageTab === t.id ? " active" : ""}`}
            onClick={() => setStageTab(t.id)}
          >
            {t.label}
          </span>
        ))}
      </div>
      {stageTab === "plot" ? (
        <WindowCanvas />
      ) : stageTab === "map" && mappable ? (
        <MapStage />
      ) : stageTab === "worksheet" ? (
        <Worksheet />
      ) : (
        <WindowCanvas />
      )}
    </section>
  );
}
