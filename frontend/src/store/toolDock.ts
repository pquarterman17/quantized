// The side-panel dock for analysis tool windows (UX-F, audit 7 finding 4).
//
// A dock-capable ToolWindow (Curve Fit, Peak analyzer) opens DOCKED: it takes
// the Inspector's grid column and replaces the Inspector while it is there, the
// way a Figma plugin docks into the right panel rather than floating over it.
// The stage keeps its own column, so the plot reflows instead of running under
// the window. Undocking floats the window; docking it again (title-bar button)
// hands the column back to it.
//
// One window owns the column at a time. Every mounted dock-capable window that
// has not been floated by the user is a CLAIMANT; the most recent claimant owns
// the column and the others float until it closes or floats, when the column
// passes back to the previous one.
//
// Persistence: only the user's "float this window" choice, per window id, in
// its own localStorage slot (a cross-project UI preference, like the toolbar
// prefs -- never part of the .dwk workspace). Which window owns the column is
// session state.

import { useSyncExternalStore } from "react";

export const TOOL_DOCK_KEY = "qz.toolDock";

/** Narrowest docked column (px): a tool window's own minimum (lib/toolwindow
 *  MIN_WIDTH). The stage minimum below yields to it only on a viewport too
 *  narrow for both (under ~1050 px beside a default Library). */
export const DOCK_MIN_WIDTH = 200;
/** Plot room the dock leaves the stage, beside the Library at its live width
 *  (--lw), for EVERY docked window (Curve Fit 340, Peak analyzer 420, …). */
export const DOCK_STAGE_MIN = 640;

export interface DockState {
  /** The window that owns the side column, or null (the Inspector shows). */
  owner: string | null;
  /** The owner's requested width (px); 0 with no owner. */
  width: number;
}

function loadFloating(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TOOL_DOCK_KEY) ?? "null");
    const ids = typeof raw === "object" && raw !== null ? (raw as { floating?: unknown }).floating : null;
    return new Set(Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

let floating = loadFloating();
const claimants: string[] = [];
const widths = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshot: DockState = { owner: null, width: 0 };

function publish(): void {
  const owner = claimants.length ? claimants[claimants.length - 1] : null;
  const width = owner === null ? 0 : (widths.get(owner) ?? 0);
  if (owner === snapshot.owner && width === snapshot.width) return;
  snapshot = { owner, width };
  for (const fn of listeners) fn();
}

function saveFloating(): void {
  try {
    localStorage.setItem(TOOL_DOCK_KEY, JSON.stringify({ floating: [...floating].sort() }));
  } catch {
    // Private mode / quota: the choice still holds for this session.
  }
}

function dropClaim(id: string): void {
  const at = claimants.indexOf(id);
  if (at >= 0) claimants.splice(at, 1);
}

/** A dock-capable window mounted (`width` px wide). It claims the column
 *  unless the user floated it. Returns the unmount cleanup. */
export function registerDockable(id: string, width: number): () => void {
  widths.set(id, width);
  dropClaim(id);
  if (!floating.has(id)) claimants.push(id);
  publish();
  return () => {
    dropClaim(id);
    widths.delete(id);
    publish();
  };
}

/** Keep a mounted window's docked width in step with its layout. */
export function setDockWidth(id: string, width: number): void {
  if (!widths.has(id) || widths.get(id) === width) return;
  widths.set(id, width);
  publish();
}

/** Float `id` (remembered across sessions); the column passes to the previous
 *  claimant, or back to the Inspector. */
export function undockToolWindow(id: string): void {
  floating.add(id);
  saveFloating();
  dropClaim(id);
  publish();
}

/** Dock `id` into the side column, displacing (floating) the current owner
 *  for as long as `id` holds it. */
export function dockToolWindow(id: string): void {
  floating.delete(id);
  saveFloating();
  dropClaim(id);
  if (widths.has(id)) claimants.push(id);
  publish();
}

/** View ▸ "Reset window positions": forget every float choice, so every
 *  dock-capable window docks again (open ones claim the column now). */
export function resetToolDockFloats(): void {
  floating.clear();
  saveFloating();
  for (const id of widths.keys()) if (!claimants.includes(id)) claimants.push(id);
  publish();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The current dock state, outside React. */
export function toolDockSnapshot(): DockState {
  return snapshot;
}

/** The width the column's owner requests once window `self` is out of it
 *  (the claimant it would pass to), or null when the Inspector comes back. */
export function dockWidthWithout(self: string | undefined): number | null {
  for (let i = claimants.length - 1; i >= 0; i--) {
    if (claimants[i] !== self) return widths.get(claimants[i]) ?? null;
  }
  return null;
}

export function useToolDock(): DockState {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Tests only: forget every claim and the stored float choices. */
export function resetToolDockForTests(): void {
  claimants.length = 0;
  widths.clear();
  floating = loadFloating();
  publish();
}

/** The CSS width of the docked column: the owner's width, but never so wide
 *  that the stage drops below DOCK_STAGE_MIN beside the Library (its live --lw),
 *  and never narrower than DOCK_MIN_WIDTH. */
export function dockColumnWidth(width: number): string {
  return `min(${width}px, max(${DOCK_MIN_WIDTH}px, calc(100vw - var(--lw, 210px) - ${DOCK_STAGE_MIN}px)))`;
}
