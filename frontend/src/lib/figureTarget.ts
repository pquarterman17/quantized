// Which figure Export figure…, Quick export, Export PDF/SVG/PNG, Copy figure
// and Send figure to report act on: the window the user is working in.
//
// `focusedWindowId` only ever names a plot window (a map, worksheet, snapshot
// or panel window raises its z-order and leaves the focus where it was), and
// the figure commands read the live plot view that focus owns. So with a map
// window beside a line plot, "Export figure…" wrote the line plot and its
// dialog named it (acceptance pass 3, plan item 47). The window the user is
// working in is the FRONT one: the highest z among the windows on screen, or
// the Map tab when the classic layout shows it. Every figure entry point asks
// `routeFigureTarget` first; it answers "not mine, carry on with the plot"
// (false) or has already handled the request (true): routed to the map's own
// export, or refused with a reason. It never guesses.
//
// Pure store reading, no components: the map window registers its exporter in
// lib/mapExportBridge.ts (the same way the stat stage registers in
// lib/statStageBridge.ts).

import { toast } from "../store/toasts";
import type { StoreGet } from "./exportActive";
import { canRenderMap } from "./mapdata";
import { mapExporterFor, STAGE_MAP_KEY } from "./mapExportBridge";
import type { PlotWindow } from "./plotview";
import type { StageTab } from "./stagetab";
import type { Dataset } from "./types";

/** The slice of the store the resolver reads (a fixture can build one). */
export interface FigureTargetState {
  stageTab: StageTab;
  layoutMode: string;
  windowLayout: { placements: Partial<Record<string, { open: boolean }>> } | null;
  plotWindows: readonly PlotWindow[];
  activeId: string | null;
  datasets: readonly Pick<Dataset, "id" | "data">[];
}

export type FigureTarget =
  /** The focused plot window's live view: line, stat, polar, stack, composition and the rest. */
  | { kind: "plot" }
  /** A map: a map window (`windowId`) or the classic Map tab (`windowId` null). */
  | { kind: "map"; datasetId: string; windowId: string | null }
  /** Nothing to export, with the reason to show. */
  | { kind: "none"; reason: string };

export const NO_FIGURE_WINDOW = "No figure window is active: click a plot or map window first.";
const WORKSHEET_FRONT = "A worksheet is the active window, not a figure: click a plot or map window first.";
const SNAPSHOT_FRONT = "A frozen snapshot window can't be exported from here: click a plot or map window instead.";
const PANEL_FRONT = "A panel window exports through Plot > Multi-panel export…: click a plot or map window to export a single figure.";
const UNBOUND_MAP = "The active map window has no dataset: drag one onto it, or click a plot window.";
const TAB_NOT_FIGURE = "The Worksheet and Workflow views are not figures: switch to the Plot or Map view first.";

/** Windows on screen: not minimized, and in windows mode not closed in the layout. */
export function onScreen(st: FigureTargetState): PlotWindow[] {
  const layout = st.layoutMode === "windows" ? st.windowLayout : null;
  return st.plotWindows.filter((w) => w.winState !== "minimized" && (layout === null || layout.placements[`plot:${w.id}`]?.open === true));
}

/** The front window: highest z, and the later one on a tie (the one painted on top). */
export function frontWindow(windows: readonly PlotWindow[]): PlotWindow | null {
  return windows.reduce<PlotWindow | null>((front, w) => (front === null || w.z >= front.z ? w : front), null);
}

export function resolveFigureTarget(st: FigureTargetState): FigureTarget {
  const active = st.datasets.find((d) => d.id === st.activeId);
  if (st.layoutMode !== "windows") {
    // The classic stage shows one view at a time; only Plot shows the windows.
    if (st.stageTab === "map" && active && canRenderMap(active.data)) return { kind: "map", datasetId: active.id, windowId: null };
    if (st.stageTab === "worksheet" || st.stageTab === "technique" || st.stageTab === "analysis") return { kind: "none", reason: TAB_NOT_FIGURE };
  }
  // No window records at all (a bare store): the plain active plot, as before windows existed.
  if (!st.plotWindows?.length) return { kind: "plot" };
  const front = frontWindow(onScreen(st));
  if (front === null) return { kind: "none", reason: NO_FIGURE_WINDOW };
  switch (front.kind) {
    case "plot": return { kind: "plot" };
    case "map": return front.datasetId ? { kind: "map", datasetId: front.datasetId, windowId: front.id } : { kind: "none", reason: UNBOUND_MAP };
    case "worksheet": return { kind: "none", reason: WORKSHEET_FRONT };
    case "snapshot": return { kind: "none", reason: SNAPSHOT_FRONT };
    case "panel": return { kind: "none", reason: PANEL_FRONT };
  }
}

/** The id of the front window when it is a plot window (null otherwise): which plot "the plot" means once
 *  `resolveFigureTarget` says plot, for a command (Publication preview) that must name it. */
export function frontPlotWindowId(st: FigureTargetState): string | null {
  const front = frontWindow(onScreen(st));
  return front?.kind === "plot" ? front.id : null;
}

export type FigureVerb = "export" | "copy" | "send";

function refuse(s: StoreGet, message: string): void {
  s().setStatus(message, "warn");
  toast(message, "info");
}

/** Run before any figure command acts on the live plot. True = handled here (a map was
 *  exported, or the request was refused with a reason): the caller stops. False = the
 *  front window is a plot, so the caller continues with its usual flow. */
export function routeFigureTarget(s: StoreGet, verb: FigureVerb): boolean {
  const target = resolveFigureTarget(s());
  if (target.kind === "plot") return false;
  if (target.kind === "none") {
    refuse(s, target.reason);
    return true;
  }
  if (verb !== "export") {
    refuse(s, `${verb === "copy" ? "Copy figure" : "Send figure to report"} isn't available for a map: use Export figure… (or the map's Export map button).`);
    return true;
  }
  const run = mapExporterFor(target.windowId ?? STAGE_MAP_KEY);
  if (!run) refuse(s, "The map isn't ready to export yet: wait for it to finish drawing, then try again.");
  else run();
  return true;
}
