// Preferences persistence + live-apply, extracted from store/useApp.ts
// (store-size ratchet, ORIGIN_FILE_DECODE_PLAN #54): the `qz.prefs`
// localStorage blob's load / snapshot / apply-to-DOM. Everything the
// Preferences dialog (and the Appearance menu) persists lives here; defaults
// reproduce the app's prior behaviour so nothing changes until a user opts in.
//
// Typed against AppState (type-only import — erased at runtime, so no cycle
// with useApp.ts, which imports `loadPrefs`/`syncPrefs` at runtime from here).

import { setFormatOpts, type Notation } from "../lib/format";
import { applyPalette, normalizePalette } from "../lib/palettes";
import type { PanelFit } from "../lib/panelLayout";
import type {
  Accent,
  AppState,
  Density,
  ExcludedDisplay,
  OriginBookClickOpens,
  Theme,
} from "./useApp";

export const PREFS_KEY = "qz.prefs";

const THEMES = ["dark", "light"];
const ACCENTS = ["violet", "teal", "ocean", "amber", "rose"];
const DENSITIES = ["compact", "regular", "comfy"];
const NOTATIONS = ["auto", "scientific", "fixed"];
const TRACES = ["Line", "Line + markers", "Scatter", "Step"];
const ORIGIN_BOOK_CLICK_OPENS = ["worksheet", "plot"];
// The app-wide multi-panel fit DEFAULT is aspect-preserving vs fill only —
// "page" is a per-window choice (needs a page model), never a global default.
const PANEL_FIT_DEFAULTS: PanelFit[] = ["frames", "window"];

export interface Prefs {
  theme: Theme;
  accent: Accent;
  density: Density;
  palette: string;
  reduceMotion: boolean;
  wheelZoom: boolean;
  defaultTrace: string;
  defaultLineWidth: number;
  defaultGrid: boolean;
  antialias: boolean;
  sigFigs: number;
  notation: Notation;
  confirmRemove: boolean;
  excludedDisplay: ExcludedDisplay;
  originBookClickOpens: OriginBookClickOpens;
  // #54: the fit a FRESH Origin multi-panel apply starts from (frames/window).
  defaultPanelFit: PanelFit;
}

export const PREF_DEFAULTS: Prefs = {
  theme: "dark",
  accent: "violet",
  density: "regular",
  palette: "default",
  reduceMotion: false,
  wheelZoom: true,
  defaultTrace: "Line",
  defaultLineWidth: 1.5,
  defaultGrid: true,
  antialias: true,
  sigFigs: 6,
  notation: "auto",
  confirmRemove: false,
  excludedDisplay: "hide",
  originBookClickOpens: "worksheet",
  defaultPanelFit: "frames",
};

export function loadPrefs(): Prefs {
  const fb = PREF_DEFAULTS;
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    const num = (v: unknown, d: number, lo: number, hi: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
    return {
      theme: THEMES.includes(p.theme as string) ? (p.theme as Theme) : fb.theme,
      accent: ACCENTS.includes(p.accent as string) ? (p.accent as Accent) : fb.accent,
      density: DENSITIES.includes(p.density as string) ? (p.density as Density) : fb.density,
      palette: normalizePalette(p.palette),
      reduceMotion: bool(p.reduceMotion, fb.reduceMotion),
      wheelZoom: bool(p.wheelZoom, fb.wheelZoom),
      defaultTrace: TRACES.includes(p.defaultTrace as string) ? (p.defaultTrace as string) : fb.defaultTrace,
      defaultLineWidth: num(p.defaultLineWidth, fb.defaultLineWidth, 0.5, 4),
      defaultGrid: bool(p.defaultGrid, fb.defaultGrid),
      antialias: bool(p.antialias, fb.antialias),
      sigFigs: num(p.sigFigs, fb.sigFigs, 1, 12),
      notation: NOTATIONS.includes(p.notation as string) ? (p.notation as Notation) : fb.notation,
      confirmRemove: bool(p.confirmRemove, fb.confirmRemove),
      excludedDisplay: p.excludedDisplay === "grey" ? "grey" : fb.excludedDisplay,
      originBookClickOpens: ORIGIN_BOOK_CLICK_OPENS.includes(p.originBookClickOpens as string)
        ? (p.originBookClickOpens as OriginBookClickOpens)
        : fb.originBookClickOpens,
      defaultPanelFit: PANEL_FIT_DEFAULTS.includes(p.defaultPanelFit as PanelFit)
        ? (p.defaultPanelFit as PanelFit)
        : fb.defaultPanelFit,
    };
  } catch {
    return fb;
  }
}

/** Snapshot the pref fields out of the store state. */
export function prefsOf(s: AppState): Prefs {
  return {
    theme: s.theme,
    accent: s.accent,
    density: s.density,
    palette: s.palette,
    reduceMotion: s.reduceMotion,
    wheelZoom: s.wheelZoom,
    defaultTrace: s.defaultTrace,
    defaultLineWidth: s.defaultLineWidth,
    defaultGrid: s.defaultGrid,
    antialias: s.antialias,
    sigFigs: s.sigFigs,
    notation: s.notation,
    confirmRemove: s.confirmRemove,
    excludedDisplay: s.excludedDisplay,
    originBookClickOpens: s.originBookClickOpens,
    defaultPanelFit: s.defaultPanelFit,
  };
}

/** Apply appearance prefs to <html> + the number formatter, then persist all
 *  prefs. Called on load and after every pref change (token system keys off the
 *  data-* attributes; data-reduce-motion drives the motion-killing rule). */
export function syncPrefs(s: AppState): void {
  applyPalette(s.palette);
  const el = document.documentElement;
  el.dataset.theme = s.theme;
  el.dataset.accent = s.accent;
  el.dataset.density = s.density;
  if (s.reduceMotion) el.dataset.reduceMotion = "";
  else delete el.dataset.reduceMotion;
  setFormatOpts(s.sigFigs, s.notation);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefsOf(s)));
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

// ── Plot toolbar display prefs (GUI_INTERACTION_PLAN #7) ───────────────────
// A tiny, store-INDEPENDENT localStorage blob for toolbar-only UI state
// (currently: whether the named-group captions are shown). Deliberately NOT
// folded into the Prefs/AppState above: useApp.ts sits at its store-size
// ratchet ceiling (3240/3240, zero headroom — see architecture.test.ts), so
// PlotToolbar reads/writes this directly via useState + these two functions
// instead of routing through a new store field. Same guarded-parse/try-catch
// discipline as loadPrefs/syncPrefs, own localStorage key.
const TOOLBAR_PREFS_KEY = "qz.toolbarPrefs";

export interface ToolbarPrefs {
  /** Show the small uppercase group captions (Navigate/Inspect/Analyze/...)
   *  above the plot toolbar's button clusters. Default true — visible out of
   *  the box, since default legibility is the point of #7; toggle off from
   *  the toolbar's own "..." flyout once the icon layout is familiar. */
  showGroupLabels: boolean;
}

export const TOOLBAR_PREF_DEFAULTS: ToolbarPrefs = { showGroupLabels: true };

export function loadToolbarPrefs(): ToolbarPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(TOOLBAR_PREFS_KEY) ?? "{}") as Record<string, unknown>;
    return {
      showGroupLabels:
        typeof p.showGroupLabels === "boolean" ? p.showGroupLabels : TOOLBAR_PREF_DEFAULTS.showGroupLabels,
    };
  } catch {
    return TOOLBAR_PREF_DEFAULTS;
  }
}

export function saveToolbarPrefs(p: ToolbarPrefs): void {
  try {
    localStorage.setItem(TOOLBAR_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}

// ── Plot interaction prefs (GUI_INTERACTION_PLAN #9, active-tool feedback +
// universal Esc-cancel) ─────────────────────────────────────────────────
// Same store-INDEPENDENT localStorage pattern as ToolbarPrefs above and for
// the same reason: useApp.ts is at its store-size ratchet ceiling. Read
// directly (no store round-trip needed) from useGlobalShortcuts' Escape
// handler.
const INTERACTION_PREFS_KEY = "qz.interactionPrefs";

export interface InteractionPrefs {
  /** Default OFF (today's behaviour): Esc with no gesture in progress
   *  reverts the active plot tool to Pointer. When ON, Esc still cancels an
   *  in-progress drag but never reverts the tool — it stays armed until the
   *  user picks a different one (toolbar / shortcut). */
  persistentTool: boolean;
}

export const INTERACTION_PREF_DEFAULTS: InteractionPrefs = { persistentTool: false };

export function loadInteractionPrefs(): InteractionPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(INTERACTION_PREFS_KEY) ?? "{}") as Record<string, unknown>;
    return {
      persistentTool:
        typeof p.persistentTool === "boolean" ? p.persistentTool : INTERACTION_PREF_DEFAULTS.persistentTool,
    };
  } catch {
    return INTERACTION_PREF_DEFAULTS;
  }
}

export function saveInteractionPrefs(p: InteractionPrefs): void {
  try {
    localStorage.setItem(INTERACTION_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
}
