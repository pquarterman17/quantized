// APPEARANCE + PREFERENCES as store state, extracted from store/useApp.ts
// (audit P4.1, the twelfth domain — store-size ratchet, MAIN_PLAN #2).
// Composed into the ONE useApp store like ./recalcEngine: `useApp` spreads
// `createAppearancePrefsSlice(set, get, initialPrefs)` into the store, so
// every `useApp((s) => s.theme)` selector and `getState().setPref(k, v)` call
// keeps working. A code boundary, not a second store.
//
// WHAT THIS MODULE OWNS: every `Prefs` key as a store field (declared here,
// except `libraryPanelWidth`, which ./libraryPanel declares with its resize
// actions), their initial values, the five writers — setTheme, setAccent,
// setDensity, setPalette and the Preferences dialog's generic setPref — and
// the pref-value types (Theme … PrefKey, re-exported by ./useApp). The
// `qz.prefs` blob itself (load / snapshot / apply-to-<html>) stays in
// ./prefs; every writer here is "set one key, then `syncPrefs`".
//
// Contract: no writer records an undo step, toasts or records a macro step,
// and each writes exactly the one key it names.
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, no React. ./useApp
// is TYPE-only, so the runtime graph stays one-directional (useApp -> here).
//
// Characterization tests: store/appearancePrefs.characterization.test.ts —
// written green against the pre-extraction useApp.ts and unchanged by the
// move.

import type { Notation } from "../lib/format";
import type { PanelFit } from "../lib/panelLayout";
import type { DefaultTrace } from "../lib/types";
import { syncPrefs, type Prefs } from "./prefs";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export type Theme = "dark" | "light";
export type Accent = "violet" | "teal" | "ocean" | "amber" | "rose";
export type Density = "compact" | "regular" | "comfy";
/** How excluded/filtered rows (#50/#53) render on the plot: "hide" drops them
 *  (gaps); "grey" draws them as muted markers. Fits exclude them either way. */
export type ExcludedDisplay = "hide" | "grey";
/** WORKSHEET_PLAN item 15 ("origin book click opens…"): what a Library click
 *  on an Origin-project dataset does — "worksheet" (default, Origin's own
 *  model: opening a workbook never touches your graphs) or "plot" (the
 *  pre-item-12 behavior — restores the unconditional plot-intent activation
 *  for every dataset, Origin or not). See `useApp.activateFromLibrary`. */
export type OriginBookClickOpens = "worksheet" | "plot";
// Keys the Preferences dialog can set through the generic setPref action.
// DERIVED from `Prefs` rather than restated: the hand-maintained union had
// to be edited in lockstep with prefs.ts for every new preference, which is
// drift waiting to happen (and 18 lines of it). `keyof` cannot go stale.
export type PrefKey = keyof Prefs;

export interface AppearancePrefsSlice {
  theme: Theme;
  accent: Accent;
  density: Density;
  palette: string; // series colour-cycle preset (overrides --series-1..8)
  // P3.3: the non-colour half of that cycle — auto dash/marker by series
  // position, opt-in. Full rationale on `Prefs.autoSeriesStyles` (prefs.ts).
  autoSeriesStyles: boolean;
  // Behavioural prefs (Preferences dialog). reduceMotion + sigFigs/notation apply
  // live; defaultGrid seeds showGrid at startup; the rest persist for later use.
  reduceMotion: boolean;
  wheelZoom: boolean;
  defaultTrace: DefaultTrace;
  defaultLineWidth: number;
  defaultGrid: boolean;
  /** MAIN #35: Copy figure background — transparent vs the preset's opaque. */
  copyFigureTransparent: boolean;
  antialias: boolean;
  sigFigs: number;
  notation: Notation;
  confirmRemove: boolean;
  excludedDisplay: ExcludedDisplay;
  originBookClickOpens: OriginBookClickOpens;
  // #54: app-wide default fit a fresh Origin multi-panel apply starts from
  // (frames = aspect-preserving letterbox, window = fill). Read at apply time,
  // mirroring how `defaultGrid` seeds `showGrid`.
  defaultPanelFit: PanelFit;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: Accent) => void;
  setDensity: (density: Density) => void;
  setPalette: (palette: string) => void;
  // Generic pref setter (used by the Preferences dialog); applies + persists.
  setPref: (key: PrefKey, value: string | number | boolean) => void;
}

export function createAppearancePrefsSlice(set: SliceSet, get: SliceGet, initialPrefs: Prefs): AppearancePrefsSlice {
  // One writer shape for all five: set the key, then apply + persist.
  const write = (patch: Partial<AppState>): void => {
    set(patch);
    syncPrefs(get());
  };
  return {
    // Every `Prefs` key IS an AppState field of the same name — that is how
    // `prefsOf(s)` reads them straight back out — so the persisted blob seeds
    // them in ONE spread instead of a hand-maintained line per preference
    // (the same anti-drift move `PrefKey = keyof Prefs` made for the key
    // union). It also re-assigns `libraryPanelWidth` with the IDENTICAL value
    // `createLibraryPanelSlice` was constructed from, so the order of the two
    // spreads in useApp is immaterial.
    ...initialPrefs,
    setTheme: (theme) => write({ theme }),
    setAccent: (accent) => write({ accent }),
    setDensity: (density) => write({ density }),
    setPalette: (palette) => write({ palette }),
    setPref: (key, value) => write({ [key]: value } as Partial<AppState>),
  };
}
