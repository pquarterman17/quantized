// Which worksheet window a command that acts on "the worksheet in front" (Show formulas) means. It reuses the
// front-window rule of lib/figureTarget.ts (the highest z among the windows on screen; the classic stage shows one
// view at a time), so a worksheet command and a figure command never disagree about the window in front. A
// per-window view such as Show formulas lives in that window's React state, so each mounted worksheet registers
// its toggle here under its window id, or STAGE_SHEET_KEY for the classic Worksheet tab (the way maps register
// their export in lib/mapExportBridge.ts). Pure store reading, no components.

import { frontWindow, onScreen, type FigureTargetState } from "./figureTarget";

/** Key of the classic stage's Worksheet tab, which has no window id. */
export const STAGE_SHEET_KEY = "stage";

/** Key of the window layout's Data window (the worksheet pane beside the plot), when it has its own selection. A Data
 *  window that follows the plot mounts without a window id, so it registers under STAGE_SHEET_KEY instead: the classic
 *  Worksheet tab is not mounted in the window layout, so the stage key can only be this pane then. */
export const DATA_PANE_KEY = "layout-data";

export const NO_FRONT_WORKSHEET = "No worksheet is in front: click a worksheet window (or open the Worksheet view) first.";

export type WorksheetTarget = { kind: "worksheet"; key: string } | { kind: "none"; reason: string };

export function resolveWorksheetTarget(st: FigureTargetState): WorksheetTarget {
  if (st.layoutMode !== "windows" && st.stageTab === "worksheet") return { kind: "worksheet", key: STAGE_SHEET_KEY };
  const front = st.layoutMode !== "windows" && st.stageTab !== "plot" ? null : frontWindow(onScreen(st));
  if (front?.kind === "worksheet") return { kind: "worksheet", key: front.id };
  // "Plot | Data side by side": the Data window is a worksheet pane in view, though it is no plot window.
  if (st.layoutMode === "windows" && st.windowLayout?.placements.data?.open === true) return { kind: "worksheet", key: DATA_PANE_KEY };
  return { kind: "none", reason: NO_FRONT_WORKSHEET };
}

/** A toggle returns the reason it did nothing, or null once it has toggled. */
const toggles = new Map<string, Array<() => string | null>>();

/** Register a worksheet's Show formulas toggle under `key`; the returned function unregisters it. */
export function registerFormulaToggle(key: string, run: () => string | null): () => void {
  toggles.set(key, [...(toggles.get(key) ?? []), run]);
  return () => {
    const left = (toggles.get(key) ?? []).filter((fn) => fn !== run);
    if (left.length) toggles.set(key, left);
    else toggles.delete(key);
  };
}

/** The mounted worksheet's toggle for `key`, or null. */
export const formulaToggleFor = (key: string): (() => string | null) | null =>
  toggles.get(key)?.at(-1) ?? (key === DATA_PANE_KEY ? (toggles.get(STAGE_SHEET_KEY)?.at(-1) ?? null) : null);
