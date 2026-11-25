// THE Preferences tab registry (PREFS_AUDIT lane 1). The dialog shell
// (PreferencesDialog.tsx) renders whatever is listed here, in order: its tab
// strip, the pane, the search, and the per-tab Reset. A later lane adds a tab
// by appending ONE entry below (or rows to an existing pane file) and never
// edits the shell:
//
//   { id: "Export", Pane: PrefsExportPane,
//     keywords: ["format", "dpi", ...],          // every row label, for search
//     reset: { slots: [exportPrefsSlot] } },     // what "Reset tab" restores
//
// `keywords` must name each row's label: the search narrows the tab strip by
// them (rows inside the open pane filter by their own text), and
// PreferencesDialog.registry.test.tsx fails when a row label is missing.

import type { ComponentType } from "react";

import { setDefaultGraphTemplate } from "../../lib/defaultGraphTemplate";
import { exportPrefsSlot } from "../../lib/exportPrefs";
import { fitPrefsSlot } from "../../lib/fitPrefs";
import { plotStylePrefsSlot } from "../../lib/plotStylePrefsSlot";
import { resetGeneralPrefs, setWorkflowPrefs } from "../../lib/workflowPrefsEdit";
import type { ResetSpec } from "../../lib/prefsReset";
import { interactionPrefsSlot, plotPerfPrefsSlot, toolbarPrefsSlot } from "../../store/prefs";
import PrefsAppearancePane from "./PrefsAppearancePane";
import PrefsExportPane from "./PrefsExportPane";
import PrefsFilesPane from "./PrefsFilesPane";
import PrefsFittingPane from "./PrefsFittingPane";
import PrefsGeneralPane from "./PrefsGeneralPane";
import PrefsInteractionPane from "./PrefsInteractionPane";
import PrefsKeyboardPane from "./PrefsKeyboardPane";
import PrefsNumbersPane from "./PrefsNumbersPane";
import PrefsPlotPane from "./PrefsPlotPane";

export interface PrefsTabDef {
  /** The tab's label, also its id (remembered as the dialog's last tab). */
  id: string;
  Pane: ComponentType;
  /** Searchable words: every row label in the pane, plus synonyms. */
  keywords: readonly string[];
  /** What "Reset tab" restores; omit for a tab with nothing to reset. */
  reset?: ResetSpec;
  /** The pane itself is the Tab stop (a read-only pane with no controls). */
  focusPane?: boolean;
}

export const PREFS_TABS: readonly PrefsTabDef[] = [
  {
    id: "Appearance",
    Pane: PrefsAppearancePane,
    keywords: ["Theme", "Accent color", "Density", "Reduce motion", "dark", "light", "colour", "animation"],
    reset: { prefs: ["themeMode", "accent", "density", "reduceMotion"] },
  },
  {
    id: "Plot",
    Pane: PrefsPlotPane,
    keywords: [
      "Default trace",
      "Default line width",
      "Grid lines",
      "Default graph template",
      "Multi-panel fit",
      "Excluded rows",
      "Copy figure background",
      "Antialias 2-D map",
      "High-density plot decimation",
      "Toolbar group labels",
      "Series palette",
      "Vary dash & marker",
      "Marker size",
      "Font size",
      "Tick direction",
      "Legend position",
      "markers",
      "transparent",
      "colour",
      "color",
      "dash",
      "ticks",
      "legend",
    ],
    reset: {
      prefs: [
        "defaultTrace",
        "defaultLineWidth",
        "defaultGrid",
        "defaultPanelFit",
        "excludedDisplay",
        "copyFigureTransparent",
        "antialias",
        "palette",
        "autoSeriesStyles",
      ],
      slots: [plotPerfPrefsSlot, toolbarPrefsSlot, plotStylePrefsSlot],
      extra: () => setDefaultGraphTemplate(null),
    },
  },
  {
    id: "Interaction",
    Pane: PrefsInteractionPane,
    keywords: ["Mouse wheel", "Window layout (preview)", "Small screens", "Data window follows", "Persistent plot tool", "zoom", "Esc"],
    reset: { prefs: ["wheelZoom", "layoutMode", "layoutTileBelow"], slots: [interactionPrefsSlot] },
  },
  {
    id: "Data & files",
    Pane: PrefsFilesPane,
    keywords: [
      "Origin book click opens",
      "Origin upload cache",
      "Write matrix books as Origin matrices",
      "Confirm before removing data",
      "Remember import wizard settings",
      "opj",
      "cache",
      "delimiter",
      "header",
    ],
    reset: {
      prefs: ["originBookClickOpens", "opjWriteMatrices", "confirmRemove"],
      extra: () => setWorkflowPrefs({ rememberImportSettings: false, importMemory: null }),
    },
  },
  {
    id: "General",
    Pane: PrefsGeneralPane,
    keywords: [
      "Warn before closing with unsaved changes",
      "Confirm before replacing the workspace",
      "Autosave delay",
      "Recovery copies kept",
      "Recovery copy retention",
      "Undo steps",
      "Recent files kept",
      "Recent projects kept",
      "Recent folders kept",
      "Show first-run hints",
      "safety",
      "startup",
      "backup",
      "unsaved",
      "beforeunload",
      "history",
    ],
    // Only this tab's fields: the slot also holds the import-wizard memory (Data & files).
    reset: { extra: resetGeneralPrefs },
  },
  {
    id: "Fitting",
    Pane: PrefsFittingPane,
    keywords: [
      "Maximum bootstrap replicates",
      "Fit max iterations per parameter",
      "Fit function tolerance",
      "Fit parameter tolerance",
      "bootstrap",
      "corner plot",
      "solver",
      "convergence",
    ],
    reset: { slots: [fitPrefsSlot] },
  },
  {
    id: "Numbers",
    Pane: PrefsNumbersPane,
    keywords: ["Significant figures", "Notation", "scientific", "fixed", "sig figs"],
    reset: { prefs: ["sigFigs", "notation"] },
  },
  {
    id: "Export",
    Pane: PrefsExportPane,
    keywords: ["Default format", "Default size", "Raster DPI", "Transparent background", "Text as paths", "pdf", "svg", "png", "tiff", "resolution", "vector", "figure"],
    reset: { slots: [exportPrefsSlot] },
  },
  { id: "Keyboard", Pane: PrefsKeyboardPane, keywords: ["shortcuts", "keys", "hotkeys"], focusPane: true },
];

const norm = (s: string) => s.toLowerCase().trim();

/** True when `q` (already normalised) names this tab or one of its keywords. */
export function tabMatches(tab: PrefsTabDef, q: string): boolean {
  return q === "" || [tab.id, ...tab.keywords].some((w) => norm(w).includes(q));
}

export const normQuery = norm;
