// The window-layout model (WORKSPACE_LAYOUT_PLAN, "option D"): every panel is
// a window that floats or docks to an edge or the centre. Types only, so the
// eager store slice can name them without pulling the operations into the
// eager bundle (the ops, sanitizer, seed and template are lazy-loaded).
//
// What the model does NOT hold: a floating window's rectangle. That stays
// where it lives today, one source of truth each: `PlotWindow.geometry` for a
// `plot:*` window, `toolWindowLayout[id]` for every other one (`tool:*` plus
// the `data` / `analysis` / `style` singletons, by their bare ref).

/** A dock slot. `null` in a placement means floating. */
export type Slot = "left" | "right" | "bottom" | "centre";

/** Every slot, in the layout's reading order (focus order, D-plan "Keyboard"). */
export const SLOTS: readonly Slot[] = ["left", "centre", "right", "bottom"];

/** The one-of-a-kind windows. */
export type SingletonRef = "data" | "analysis" | "style";

/** A window's identity: a singleton, a plot-family document window by its
 *  `PlotWindow.id`, or an analysis tool by its `ToolWindow` `id` prop (one
 *  window per tool, D7). */
export type WindowRef = SingletonRef | `plot:${string}` | `tool:${string}`;

export type WindowKind = "plot" | "tool" | SingletonRef;

export interface Placement {
  /** Docked slot, or null = floating. */
  slot: Slot | null;
  /** Position in its slot's stack (0 = first). Contiguous among the slot's
   *  OPEN windows; a closed window keeps the index it had, for reopen. */
  order: number;
  /** Fraction of the slot's length. The open windows of a slot sum to 1. */
  share: number;
  /** Where "Dock" (or reopen) sends it after it was floated. */
  lastSlot: Slot | null;
  /** A closed window keeps its placement so reopening restores it. */
  open: boolean;
}

/** Remembered px size of each edge region; 0 = never sized (host default). */
export interface WindowEdges {
  left: number;
  right: number;
  bottom: number;
}

/** How centre windows share the centre: side by side, or a grid ("Tile all"). */
export type CentreMode = "row" | "grid";

/** The Data window's source: the focused plot (default) or the Library
 *  selection, unless pinned to one dataset id. */
export interface DataFollow {
  pinned: string | null;
  follow: "plot" | "library";
}

export const WINDOW_LAYOUT_VERSION = 1;

export interface WindowLayoutV1 {
  v: 1;
  placements: Partial<Record<WindowRef, Placement>>;
  /** Floating stack, back to front. Only open floating windows appear. */
  z: WindowRef[];
  edges: WindowEdges;
  centre: CentreMode;
  data: DataFollow;
  /** Pins of the other follow windows (plan P4, D8): the Analysis window and
   *  each tool window, by ref, to a dataset id. Absent = every one follows the
   *  focused plot. Optional so a layout saved before P4 reads unchanged. */
  pins?: Partial<Record<WindowRef, string>>;
  /** SESSION ONLY, never saved (plan P5, D6 "tile below width"): while the
   *  viewport is narrower than the user's tile width, the layout on screen is
   *  a tile of `from`, the user's own layout, which is what a save writes and
   *  what comes back after widening (lib/windowLayout/narrowTile.ts). `refs`
   *  are the windows the tile has placed so far. A layout read from a file or
   *  storage never has it (the sanitizer builds a fresh object). */
  tiled?: { from: WindowLayoutV1; refs: WindowRef[] };
}

/** The persisted layout mode (`qz.prefs`): classic stays the default until the
 *  owner flips it (plan Pn-1). */
export type LayoutMode = "classic" | "windows";
