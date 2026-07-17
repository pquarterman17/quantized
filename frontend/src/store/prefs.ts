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
// Exported for the folder-Properties colour picker (plan #13 sub-item 4) —
// the SAME 5 design-token accent names the Appearance/Preferences accent
// swatches use, so a folder's colour is drawn from one canonical palette.
export const ACCENTS = ["violet", "teal", "ocean", "amber", "rose"];
// The paint value per accent name — a FIXED colour per option (not the
// currently-active --accent custom property, which only ever holds ONE of
// these), so a swatch/glyph can show what an option looks like regardless of
// the app's current accent choice. The single source both the Preferences
// accent swatches AND the folder-Properties colour picker read (moved here
// from a PreferencesDialog.tsx-local copy — one palette, not two).
export const ACCENT_SWATCHES: { id: string; c: string }[] = [
  { id: "violet", c: "oklch(0.7 0.17 295)" },
  { id: "teal", c: "oklch(0.74 0.13 185)" },
  { id: "ocean", c: "oklch(0.68 0.15 250)" },
  { id: "amber", c: "oklch(0.78 0.14 75)" },
  { id: "rose", c: "oklch(0.72 0.16 12)" },
];
const DENSITIES = ["compact", "regular", "comfy"];
const NOTATIONS = ["auto", "scientific", "fixed"];
const TRACES = ["Line", "Line + markers", "Scatter", "Step"];
const ORIGIN_BOOK_CLICK_OPENS = ["worksheet", "plot"];
// The app-wide multi-panel fit DEFAULT is aspect-preserving vs fill only —
// "page" is a per-window choice (needs a page model), never a global default.
const PANEL_FIT_DEFAULTS: PanelFit[] = ["frames", "window"];
// Library panel resize clamp (plan #13 sub-item 5) — matches shell.css's
// var(--lw, 210px) default; the lower bound keeps the grip handle + a couple
// characters of a folder name usable, the upper bound leaves the Stage room.
export const LIBRARY_PANEL_WIDTH_MIN = 160;
export const LIBRARY_PANEL_WIDTH_MAX = 420;
export const LIBRARY_PANEL_WIDTH_DEFAULT = 210;

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
  // GUI_INTERACTION_PLAN #13 sub-item 5: the Library panel's drag-resized
  // width in CSS px, applied to the --lw custom property (see shell.css's
  // .qzk-main grid). Width, not expand/collapse — the folder tree's
  // expand/collapse set lives in the WORKSPACE (`expandedFolders`, already
  // part of the .dwk v2 shape), since it's per-project organization, not a
  // cross-project appearance preference.
  libraryPanelWidth: number;
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
  libraryPanelWidth: LIBRARY_PANEL_WIDTH_DEFAULT,
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
      libraryPanelWidth: num(
        p.libraryPanelWidth,
        fb.libraryPanelWidth,
        LIBRARY_PANEL_WIDTH_MIN,
        LIBRARY_PANEL_WIDTH_MAX,
      ),
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
    libraryPanelWidth: s.libraryPanelWidth,
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
  el.style.setProperty("--lw", `${s.libraryPanelWidth}px`);
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
