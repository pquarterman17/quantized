// Which worksheet window a command that acts on "the worksheet in front" (Show formulas) means. It reuses the
// front-window rule of lib/figureTarget.ts (the highest z among the windows on screen; the classic stage shows one
// view at a time), so a worksheet command and a figure command never disagree about the window in front. A
// per-window view such as Show formulas lives in that window's React state, so each mounted worksheet registers
// its toggle here under its window id, or STAGE_SHEET_KEY for the classic Worksheet tab (the way maps register
// their export in lib/mapExportBridge.ts). Pure store reading, no components.

import { frontWindow, onScreen, type FigureTargetState } from "./figureTarget";

/** Key of the classic stage's Worksheet tab, which has no window id. */
export const STAGE_SHEET_KEY = "stage";

export const NO_FRONT_WORKSHEET = "No worksheet is in front: click a worksheet window (or open the Worksheet view) first.";

export type WorksheetTarget = { kind: "worksheet"; key: string } | { kind: "none"; reason: string };

export function resolveWorksheetTarget(st: FigureTargetState): WorksheetTarget {
  if (st.layoutMode !== "windows" && st.stageTab === "worksheet") return { kind: "worksheet", key: STAGE_SHEET_KEY };
  const front = st.layoutMode !== "windows" && st.stageTab !== "plot" ? null : frontWindow(onScreen(st));
  return front?.kind === "worksheet" ? { kind: "worksheet", key: front.id } : { kind: "none", reason: NO_FRONT_WORKSHEET };
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
export const formulaToggleFor = (key: string): (() => string | null) | null => toggles.get(key)?.at(-1) ?? null;
