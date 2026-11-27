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
import { definePrefSlot, writePrefSlot } from "../lib/prefSlots";
import type { DefaultTrace } from "../lib/types";
import type { LayoutMode } from "../lib/windowLayout/types";
import type {
  Accent,
  AppState,
  Density,
  ExcludedDisplay,
  OriginBookClickOpens,
  Theme,
  ThemeMode,
} from "./useApp";

export const PREFS_KEY = "qz.prefs";

const THEMES = ["dark", "light"];
const THEME_MODES = ["system", "dark", "light"];

/** The OS colour scheme, as a concrete theme. No matchMedia (jsdom, very old
 *  webviews) or a throwing one falls back to dark, the app's historical look. */
export function systemTheme(): Theme {
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** The theme the UI actually renders for a user's choice: "system" follows the
 *  OS, an explicit "dark"/"light" is kept as-is. */
export function resolveTheme(mode: ThemeMode): Theme {
  return mode === "system" ? systemTheme() : mode;
}
// Exported for the folder-Properties colour picker (plan #13 sub-item 4) —
// the SAME 5 design-token accent names the Appearance/Preferences accent
// swatches use, so a folder's colour is drawn from one canonical palette.
export const ACCENTS = ["violet", "teal", "ocean", "amber", "rose"];
const DENSITIES = ["compact", "regular", "comfy"];
const NOTATIONS = ["auto", "scientific", "fixed"];
const TRACES: readonly DefaultTrace[] = ["Line", "Line + markers", "Scatter", "Step"];
const ORIGIN_BOOK_CLICK_OPENS = ["worksheet", "plot"];
// The app-wide multi-panel fit DEFAULT is aspect-preserving vs fill only —
// "page" is a per-window choice (needs a page model), never a global default.
const PANEL_FIT_DEFAULTS: PanelFit[] = ["frames", "window"];
// Library panel resize clamp (plan #13 sub-item 5) — shell.css's
// var(--lw, 210px) is only the pre-boot fallback (the pref below always sets
// --lw); the lower bound keeps the grip handle + a couple characters of a
// folder name usable, the upper bound leaves the Stage room.
export const LIBRARY_PANEL_WIDTH_MIN = 160;
export const LIBRARY_PANEL_WIDTH_MAX = 420;
/** The first-run Library width for a viewport `vw` px wide: 210 up to 1360
 *  px, growing a quarter of every extra pixel to 264 (reached at 1576 px).
 *  At 210 an Origin project's book rows truncated their names beside the
 *  kind chip and count, so a wide screen gives the Library the room; a
 *  narrow one keeps it for the plot (at 264 an 800 px window's broken-axis
 *  panels and a 1360 px plot's legend lost the room they need). A width the
 *  user dragged is a saved pref and always wins. */
export function defaultLibraryPanelWidth(vw: number): number {
  return Math.round(Math.min(264, Math.max(210, 210 + (vw - 1360) / 4)));
}
export const LIBRARY_PANEL_WIDTH_DEFAULT = defaultLibraryPanelWidth(
  typeof window === "undefined" ? 1360 : window.innerWidth,
);
// Inspector (right panel) resize clamp. 296 is the long-standing fixed --rw
// token (styles/spacing.css), now only the pre-boot fallback: the pref below
// always sets --rw. The lower bound keeps the cards' two-column field rows
// usable, the upper bound leaves the Stage room.
export const INSPECTOR_PANEL_WIDTH_MIN = 240;
export const INSPECTOR_PANEL_WIDTH_MAX = 560;
export const INSPECTOR_PANEL_WIDTH_DEFAULT = 296;

export interface Prefs {
  /** The EFFECTIVE theme (what <html data-theme> shows). Derived from
   *  `themeMode`; every renderer reads this one. */
  theme: Theme;
  /** The user's CHOICE: follow the OS ("system", the first-run default) or pin
   *  dark/light. A legacy blob with only `theme` loads as that explicit pick. */
  themeMode: ThemeMode;
  accent: Accent;
  density: Density;
  palette: string;
  /** PRIMARY_SOFTWARE_AUDIT_PLAN P3.3 — the NON-colour half of the series
   *  cycle. On, a series with no explicit dash/marker glyph gets one by
   *  display position, so two series differ by more than hue on screen, in
   *  print and in the publication export (`lib/seriesStyleCycle.ts`).
   *  OFF by default: opt-in, and off reproduces the previous rendering
   *  exactly. Lives beside `palette` because it varies the same thing by
   *  another channel — but UNLIKE `palette` it is not pushed into a lib
   *  singleton by `syncPrefs`: only the render paths that have a matching
   *  export read it, as an explicit argument. See that function and
   *  `lib/seriesStyleCycle.ts`'s header for why. */
  autoSeriesStyles: boolean | number;
  reduceMotion: boolean;
  wheelZoom: boolean;
  defaultTrace: DefaultTrace;
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
  // The Inspector's drag/keyboard-resized width in CSS px, applied to --rw.
  inspectorPanelWidth: number;
  // MAIN_PLAN #35: background for "Copy figure". Transparent pastes
  // cleanly onto a coloured slide; opaque is safer for Word/print, where a
  // transparent PNG can pick up whatever is behind it. Opaque default —
  // it matches what an exported figure looks like today.
  copyFigureTransparent: boolean;
  // File ▸ Export Origin project: write imported matrix books as Origin
  // matrices (backend writer_matrix) instead of X/Y/Z worksheet columns.
  // OFF by default: the matrix window has not been loaded in real Origin yet,
  // and a window Origin rejects would refuse the whole project.
  opjWriteMatrices: boolean;
  // WORKSPACE_LAYOUT_PLAN: dockable windows ("windows") or today's layout
  // ("classic", the default until the owner flips it). Written only through
  // the window-layout slice's setLayoutMode (it seeds the first layout).
  layoutMode: LayoutMode;
  // D6 (plan P5): in windows mode, tile the windows while the viewport is
  // narrower than this many px; 0 (the default) keeps them floating there.
  layoutTileBelow: number;
}

export const PREF_DEFAULTS: Prefs = {
  theme: "dark", // static fallback; loadPrefs resolves it from themeMode
  themeMode: "system",
  accent: "violet",
  density: "regular",
  palette: "default",
  autoSeriesStyles: false,
  reduceMotion: false,
  wheelZoom: true,
  defaultTrace: "Line",
  defaultLineWidth: 1.5,
  defaultGrid: true,
  antialias: true,
  sigFigs: 6,
  notation: "auto",
  confirmRemove: false,
  excludedDisplay: "grey", // F4.2c (a) owner decision — see EXCLUDED_DISPLAY_KEY
  originBookClickOpens: "worksheet",
  defaultPanelFit: "frames",
  libraryPanelWidth: LIBRARY_PANEL_WIDTH_DEFAULT,
  inspectorPanelWidth: INSPECTOR_PANEL_WIDTH_DEFAULT,
  copyFigureTransparent: false,
  opjWriteMatrices: false,
  layoutMode: "windows", // Owner decision 2026-11-26: the window layout is the default; see LAYOUT_MODE_KEY
  layoutTileBelow: 0,
};

/** F4.2c (a) (owner decision 2026-09-29): excluded rows default to GREYED.
 *  The choice is persisted under this key, not the legacy `excludedDisplay`
 *  one, because `syncPrefs` has always written EVERY pref on ANY change: a
 *  legacy "hide" is therefore mostly the old implicit default, written the
 *  first time a user changed anything else, and cannot be told apart from a
 *  deliberate pick. A value under THIS key was written by a build whose
 *  default is already "grey", so a "hide" here is always the user's own
 *  choice and is kept. The legacy key is still written (for an older build
 *  sharing this storage) but no longer read. */
export const EXCLUDED_DISPLAY_KEY = "excludedDisplayV2";

function loadExcludedDisplay(p: Record<string, unknown>): ExcludedDisplay {
  const v = p[EXCLUDED_DISPLAY_KEY];
  return v === "hide" || v === "grey" ? v : PREF_DEFAULTS.excludedDisplay;
}

/** Owner decision 2026-11-26: the window layout is the DEFAULT, and an explicit choice of the classic
 *  layout is kept. `syncPrefs` has always written EVERY pref on ANY change, so a stored legacy
 *  `layoutMode: "classic"` is mostly the old implicit default and cannot be told from a deliberate pick
 *  (the same trap as EXCLUDED_DISPLAY_KEY). So the choice has its own key, written ONLY after the user
 *  (or a synced server prefs file) switched the layout: a value under it is always explicit and is kept,
 *  classic included. Without it: a legacy `layoutMode: "windows"` was an explicit opt-in and stays
 *  windows; anything else (unset, a legacy "classic", junk) is unset and takes the new default. A legacy
 *  "classic" is therefore NOT kept: it was indistinguishable from the old default (provisional, owner to
 *  confirm). The legacy key is still written for an older build sharing this storage. */
export const LAYOUT_MODE_KEY = "layoutModeV2";

const asLayoutMode = (v: unknown): LayoutMode | null => (v === "windows" || v === "classic" ? v : null);

/** The layout the user chose explicitly (null = never chose). Set by `loadPrefs` and `markLayoutModeExplicit`. */
let explicitLayoutMode: LayoutMode | null = null;
/** Record an explicit choice (the layout switch writer, store/windowLayoutRun.ts); null forgets it (Reset). */
export function markLayoutModeExplicit(mode: LayoutMode | null): void {
  explicitLayoutMode = mode;
}

/** D6's tile width: 600 to 3,840 px (Preferences ▸ Small screens), else 0 = keep floating (fail closed). */
const tileBelow = (v: unknown): number => (typeof v === "number" && v >= 600 && v <= 3840 ? Math.round(v) : 0);

export function loadPrefs(): Prefs {
  const fb = PREF_DEFAULTS;
  explicitLayoutMode = null;
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    explicitLayoutMode = asLayoutMode(p[LAYOUT_MODE_KEY]) ?? (p.layoutMode === "windows" ? "windows" : null);
    const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    const num = (v: unknown, d: number, lo: number, hi: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
    const themeMode: ThemeMode = THEME_MODES.includes(p.themeMode as string)
      ? (p.themeMode as ThemeMode)
      : THEMES.includes(p.theme as string)
        ? (p.theme as ThemeMode)
        : fb.themeMode;
    return {
      theme: resolveTheme(themeMode),
      themeMode,
      accent: ACCENTS.includes(p.accent as string) ? (p.accent as Accent) : fb.accent,
      density: DENSITIES.includes(p.density as string) ? (p.density as Density) : fb.density,
      palette: normalizePalette(p.palette),
      autoSeriesStyles: (p.autoSeriesStyles as number) > 1 ? Math.floor(p.autoSeriesStyles as number) : bool(p.autoSeriesStyles, !!fb.autoSeriesStyles), // a number: the subgroup size (item 24)
      reduceMotion: bool(p.reduceMotion, fb.reduceMotion),
      wheelZoom: bool(p.wheelZoom, fb.wheelZoom),
      defaultTrace: TRACES.includes(p.defaultTrace as DefaultTrace) ? (p.defaultTrace as DefaultTrace) : fb.defaultTrace,
      defaultLineWidth: num(p.defaultLineWidth, fb.defaultLineWidth, 0.5, 4),
      defaultGrid: bool(p.defaultGrid, fb.defaultGrid),
      copyFigureTransparent: bool(p.copyFigureTransparent, fb.copyFigureTransparent),
      opjWriteMatrices: bool(p.opjWriteMatrices, fb.opjWriteMatrices),
      layoutMode: explicitLayoutMode ?? fb.layoutMode, // unset (or junk): the default, windows (owner decision 2026-11-26)
      layoutTileBelow: tileBelow(p.layoutTileBelow), // anything but 600-3,840 px: keep floating
      antialias: bool(p.antialias, fb.antialias),
      sigFigs: num(p.sigFigs, fb.sigFigs, 1, 12),
      notation: NOTATIONS.includes(p.notation as string) ? (p.notation as Notation) : fb.notation,
      confirmRemove: bool(p.confirmRemove, fb.confirmRemove),
      excludedDisplay: loadExcludedDisplay(p),
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
      inspectorPanelWidth: num(
        p.inspectorPanelWidth,
        fb.inspectorPanelWidth,
        INSPECTOR_PANEL_WIDTH_MIN,
        INSPECTOR_PANEL_WIDTH_MAX,
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
    themeMode: s.themeMode,
    accent: s.accent,
    density: s.density,
    palette: s.palette,
    autoSeriesStyles: s.autoSeriesStyles,
    reduceMotion: s.reduceMotion,
    wheelZoom: s.wheelZoom,
    defaultTrace: s.defaultTrace,
    defaultLineWidth: s.defaultLineWidth,
    defaultGrid: s.defaultGrid,
    antialias: s.antialias,
    copyFigureTransparent: s.copyFigureTransparent,
    opjWriteMatrices: s.opjWriteMatrices,
    layoutMode: s.layoutMode,
    layoutTileBelow: s.layoutTileBelow,
    sigFigs: s.sigFigs,
    notation: s.notation,
    confirmRemove: s.confirmRemove,
    excludedDisplay: s.excludedDisplay,
    originBookClickOpens: s.originBookClickOpens,
    defaultPanelFit: s.defaultPanelFit,
    libraryPanelWidth: s.libraryPanelWidth,
    inspectorPanelWidth: s.inspectorPanelWidth,
  };
}

/** Apply appearance prefs to <html> + the number formatter, then persist all
 *  prefs. Called on load and after every pref change (token system keys off the
 *  data-* attributes; data-reduce-motion drives the motion-killing rule). */
export function syncPrefs(s: AppState): void {
  applyPalette(s.palette);
  // `autoSeriesStyles` deliberately gets NO push-into-a-pure-lib line here,
  // unlike applyPalette above and setFormatOpts below. A module-level flag is
  // read by whoever happens to call the resolver, which is exactly how the
  // first cut cycled five render paths whose exports could not follow. The
  // cycle is instead handed to the two render pairs that have export parity, as
  // an explicit argument, from the store field directly — see
  // `lib/seriesStyleCycle.ts`'s header.
  const el = document.documentElement;
  el.dataset.theme = s.theme;
  el.dataset.accent = s.accent;
  el.dataset.density = s.density;
  if (s.reduceMotion) el.dataset.reduceMotion = "";
  else delete el.dataset.reduceMotion;
  el.style.setProperty("--lw", `${s.libraryPanelWidth}px`);
  el.style.setProperty("--rw", `${s.inspectorPanelWidth}px`);
  setFormatOpts(s.sigFigs, s.notation);
  // Through the slot writer: localStorage plus the server prefs file
  // (lib/prefSlots.ts; storage that throws is non-fatal there).
  writePrefSlot(PREFS_KEY, {
    ...prefsOf(s),
    [EXCLUDED_DISPLAY_KEY]: s.excludedDisplay,
    ...(explicitLayoutMode ? { [LAYOUT_MODE_KEY]: explicitLayoutMode } : {}),
  });
}

// ── Store-independent side slots (lib/prefSlots.ts) ──────────────────────
// Tiny blobs deliberately NOT folded into Prefs/AppState above: useApp.ts sits
// at its store-size ratchet ceiling, so each reader uses the slot directly
// (`slot.use()` in a component, `load()` elsewhere). Each is mirrored to the
// server prefs file like `qz.prefs`.

/** GUI_INTERACTION_PLAN #7: show the small uppercase group captions
 *  (Navigate/Inspect/Analyze/...) above the plot toolbar's clusters. Default
 *  true; toggled from the toolbar's "..." flyout or Preferences ▸ Plot. */
export interface ToolbarPrefs {
  showGroupLabels: boolean;
  /** Owner decision OG18: a short text label beside each icon-only plot-toolbar
   *  button. Default OFF (icon-only, as before). Optional so a caller that
   *  saves only the captions flag still type-checks. */
  showButtonLabels?: boolean;
}
export const TOOLBAR_PREF_DEFAULTS: ToolbarPrefs = { showGroupLabels: true, showButtonLabels: false };
export const toolbarPrefsSlot = definePrefSlot("qz.toolbarPrefs", TOOLBAR_PREF_DEFAULTS);
export const loadToolbarPrefs = (): ToolbarPrefs => toolbarPrefsSlot.load();
export const saveToolbarPrefs = (p: ToolbarPrefs): void => toolbarPrefsSlot.save(p);

/** GUI_INTERACTION_PLAN #9. Default OFF (today's behaviour): Esc with no
 *  gesture in progress reverts the active plot tool to Pointer. When ON, Esc
 *  still cancels an in-progress drag but never reverts the tool. Read
 *  directly from useGlobalShortcuts' Escape handler. */
/** `menuRecents` (default OFF): list the last few commands used from each top-level menu at
 *  the bottom of that menu (lib/menuRecents.ts; read when a menu is built). */
export interface InteractionPrefs {
  persistentTool: boolean;
  menuRecents?: boolean; // optional so a save() of the older single-field shape still type-checks
}
export const INTERACTION_PREF_DEFAULTS: InteractionPrefs = { persistentTool: false, menuRecents: false };
export const interactionPrefsSlot = definePrefSlot("qz.interactionPrefs", INTERACTION_PREF_DEFAULTS);
export const loadInteractionPrefs = (): InteractionPrefs => interactionPrefsSlot.load();
export const saveInteractionPrefs = (p: InteractionPrefs): void => interactionPrefsSlot.save(p);

/** P0.4. Default ON: view-window min/max decimation for dense line/step
 *  series above ~10k rows (lib/plotDecimate.ts), read from PlotViewport's
 *  uPlot create effect. Already a no-op below that size, for scatter /
 *  colour-mapped series and series with error bars: an escape hatch for a
 *  user who wants every raw point fed to uPlot. */
export interface PlotPerfPrefs {
  decimateDensePlots: boolean;
}
export const PLOT_PERF_PREF_DEFAULTS: PlotPerfPrefs = { decimateDensePlots: true };
export const plotPerfPrefsSlot = definePrefSlot("qz.plotPerfPrefs", PLOT_PERF_PREF_DEFAULTS);
export const loadPlotPerfPrefs = (): PlotPerfPrefs => plotPerfPrefsSlot.load();
export const savePlotPerfPrefs = (p: PlotPerfPrefs): void => plotPerfPrefsSlot.save(p);
