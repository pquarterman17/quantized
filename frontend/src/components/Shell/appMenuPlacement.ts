// Where each command sits in the menubar (UX audit 10, P1-3): the placement
// tables, split out of appMenuModel.ts. Menu
// structure is data here, not a property of the command: the palette ignores
// all of it (it is searched, not browsed), and a command keeps its id and
// label wherever it is listed.

export interface Placement {
  /** Menu to list the command in, when not its own group. */
  menu?: string;
  /** Flyout, or `null` for the menu's top level. Omit to keep its own section. */
  section?: string | null;
}

/** Commands listed somewhere other than their group/section. Same command, same id. */
export const PLACEMENT: Readonly<Record<string, Placement>> = {
  // File: one Preferences item, not a one-item "Settings" flyout.
  preferences: { section: null },
  "sqlite-query": { menu: "File", section: "Import" },
  trash: { menu: "File", section: "Project" },
  "figure-save": { section: "Export" },
  "plot-recipe-manager": { menu: "File", section: "Export" },
  // Figure formats: a menu home for the format answers (UX audit 12; the palette keeps them).
  "export-pdf": { menu: "File", section: "Export" },
  "export-svg": { menu: "File", section: "Export" },
  "export-png": { menu: "File", section: "Export" },
  // Owner decision 2026-11-25: Export animation sits with the other figure exports.
  "export-animation": { menu: "File", section: "Export" },
  // Multi-panel export and Send figure to report are exports, not chart types (UX menus audit M2).
  // Provisional, owner to confirm: they left Plot > "Build & export", which is now Plot > Charts.
  "figure-page": { menu: "File", section: "Export" },
  "send-figure-to-report": { menu: "File", section: "Export" },
  // Edit
  "find-in-project": { menu: "Edit", section: null },
  // Data: column operations together.
  "set-column-values": { section: "Columns" },
  "add-column": { section: "Columns" },
  "mirror-column": { section: "Columns" },
  transpose: { section: "Columns" }, // a reshape, with stack / unstack (UX menus audit N7)
  "stack-columns": { section: "Columns" },
  "unstack-columns": { section: "Columns" },
  "standardize-columns": { section: "Columns" },
  // Plot > Browse: stepping a graph through columns or sheets, picking points and the Graph
  // browser window (plan item 22) get their own flyout so Layout keeps to layout.
  "browse-column-next": { section: "Browse" },
  "browse-column-prev": { section: "Browse" },
  "browse-sheet-next": { section: "Browse" },
  "browse-sheet-prev": { section: "Browse" },
  "pick-points": { section: "Browse" },
  "graph-browser": { section: "Browse" },
  // Plot: Layout keeps layout; creation, curves and legend, and axis links get their own homes.
  "function-plot": { section: "Create" },
  "contour-scattered": { section: "Create" },
  "plot-selected-together": { section: "Create" },
  "panel-row": { section: "Create" },
  "panel-column": { section: "Create" },
  "panel-grid": { section: "Create" },
  "panel-overlay": { section: "Create" },
  "legend-format": { section: "Curves & legend" },
  "color-gradient": { section: "Curves & legend" },
  // The old Plot > Display flyout held three items (grid and legend sit at the root): its
  // plot type, statistics view and magnifier inset describe how the curves are drawn, so they join
  // them. That keeps the Plot root short enough for the compact-menu e2e (e2e-fix, wave 6).
  "plot-type": { section: "Curves & legend" },
  statMode: { section: "Curves & legend" },
  "inset-mode": { section: "Curves & legend" },
  "layer-contents": { section: "Curves & legend" },
  "plot-setup": { section: "Curves & legend" },
  "add-curve-from": { section: "Curves & legend" },
  "link-x-axis": { section: "Axes" },
  "link-y-axis": { section: "Axes" },
  // View history is not an axis setting: it sits at the Plot root with Autoscale (UX menus audit N4,
  // provisional, owner to confirm). Same ids and Alt+Left / Alt+Right.
  "view-back": { section: null },
  "view-forward": { section: null },
  // Templates and the format painter leave Display (N4, provisional, owner to confirm).
  "graph-template-save": { section: "Templates & format" },
  "graph-template-apply": { section: "Templates & format" },
  "graph-template-default": { section: "Templates & format" },
  "graph-template-apply-many": { section: "Templates & format" },
  "copy-format": { section: "Templates & format" },
  "paste-format": { section: "Templates & format" },
  "paste-format-many": { section: "Templates & format" },
  // Analyze: instrument-domain items sit with their domain, not under "Transform & signal" (N5).
  "reductions-fft": { section: "XRD & reflectivity" },
  "reductions-reflfft": { section: "XRD & reflectivity" },
  "optical-gap": { section: "Spectroscopy & magnetometry" },
  sims: { section: "Spectroscopy & magnetometry" },
  // The two Magnetometry tools share that flyout: two 2-item flyouts cost two root rows, and Analyze's
  // root was one row under the compact-menu e2e limit (e2e-fix, wave 6).
  hysteresis: { section: "Spectroscopy & magnetometry" },
  magtools: { section: "Spectroscopy & magnetometry" },
  // Tools: calculators and the digitizer are not analysis of the active data.
  calculators: { menu: "Tools", section: null },
  digitizer: { menu: "Tools", section: null },
  // Window
  "window-tile": { section: "Arrange" },
};

/** Flyouts a command's section is shown under when that is not its own name, keyed "Menu/Section".
 *  The section stays the registry's vocabulary (a new chart kind still says `section: "Charts"`); only the
 *  menu merges it. Plot > Charts shares Plot > Create: every Plot root flyout costs a menu row, and the
 *  compact-menu e2e budget is 360px (e2e-fix, wave 6). */
export const FLYOUT_ALIAS: Readonly<Record<string, string>> = { "Plot/Charts": "Create" };

/** Commands ALSO listed in a second flyout of their own menu, where users browsing that topic look
 *  (UX menus audit N5: map tools were spread over five menus). Same command, same id. Provisional,
 *  owner to confirm: the Analyze > Maps flyout. Keyed by menu, then id. */
export const ALSO_LISTED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Analyze: { "map-ops": "Maps", "map-grid": "Maps", "map-analysis": "Maps", "map-stack-fit": "Maps", "surface-fit": "Maps", "roi-cuts": "Maps", rsm: "Maps" },
};

/** Figure export lives under File > Export; it is not repeated under Plot. */
export const LISTED_UNDER_FILE: ReadonlySet<string> = new Set(["export-figure", "export-figure-quick", "figure-builder", "page-setup"]);

/** The menu a command is listed under: the palette's category chip (UX audit 11, N6).
 *  Derived from placement, so it follows a menu move instead of the stale `group`. */
export function menuHome(id: string, group: string): string {
  if (LISTED_UNDER_FILE.has(id)) return "File";
  return PLACEMENT[id]?.menu ?? group;
}

/** Top-level order within a menu: listed ids first, in this order; the rest keep registry order. */
export const ROOT_ORDER: Readonly<Record<string, readonly string[]>> = {
  File: ["new-workbook", "import", "open-workspace", "save-workspace-quick", "save-workspace", "preferences"],
  Plot: ["autoscale", "view-back", "view-forward", "grid", "legend", "plot-in-new-window"],
  Edit: ["history-undo", "history-redo", "edit-cut", "edit-copy", "paste-data", "select-all-datasets", "find-in-project", "rename-dataset", "copy-figure", "repeat-last-action", "repeat-last-reversed", "reopen-last-dialog", "palette"],
};

/** A separator goes before these ids when they are listed at the top level. */
export const BREAK_BEFORE: Readonly<Record<string, ReadonlySet<string>>> = {
  File: new Set(["open-workspace", "preferences"]),
  Edit: new Set(["edit-cut", "select-all-datasets", "palette"]),
};

/** Flyout order within a menu: listed first, the rest in registry order. */
export const SECTION_ORDER: Readonly<Record<string, readonly string[]>> = {
  File: ["Import", "Project", "Export"],
  // "Charts" was "Build & export" (UX menus audit M2, provisional, owner to confirm); the export items moved to File > Export.
  // It now shares "Create" (FLYOUT_ALIAS).
  Plot: ["Axes", "Templates & format", "Curves & legend", "Layout", "Browse", "Create"],
  Analyze: ["Fit", "Transform & signal", "Spectroscopy & magnetometry", "Peaks & baseline", "XRD & reflectivity", "Maps", "Statistics", "Quality & reliability", "Normalize"],
  Data: ["Combine & split", "Columns", "Rows & summary", "Recalculation"],
  Window: ["Create & open", "Arrange", "Active window", "Navigate"],
};

/** Menu flyouts grouped by separators, keyed "Menu/Flyout": listed ids come first in this order with a
 *  separator between groups; an unlisted id trails after a final separator. File > Export (UX audit 11,
 *  N4): data, Origin, figure, publication and page, then recipes and templates (provisional, owner to
 *  confirm: Origin is its own group). Plot > Axes (UX menus audit N4): X, Y, then both. */
export const FLYOUT_GROUPS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  "File/Export": [
    ["quick-convert", "export-csv", "export-hdf5", "export-worksheet", "export-consolidated"],
    ["export-origin", "export-origin-project", "send-to-origin"],
    ["export-figure", "export-figure-quick", "export-pdf", "export-svg", "export-png", "export-animation"],
    ["figure-builder", "figure-page", "export-page", "page-setup", "send-figure-to-report"],
    ["figure-save", "figure-save-as", "figure-save-recipe", "plot-recipe-manager"],
  ],
  "Plot/Axes": [
    ["xLog", "xTickFormat", "axis-dialog", "link-x-axis"],
    ["yLog", "yTickFormat", "y-axis-settings", "link-y-axis"],
    ["exchange-xy"],
    ["scale-x-log", "scale-x-linear", "scale-y-log", "scale-y-linear"],
  ],
  // Creation first, then (after the separator an unlisted id gets) the chart types that merged in.
  "Plot/Create": [["function-plot", "contour-scattered", "plot-selected-together", "panel-row", "panel-column", "panel-grid", "panel-overlay"]],
  "Plot/Templates & format": [
    ["graph-template-save", "graph-template-apply", "graph-template-default", "graph-template-apply-many"],
    ["copy-format", "paste-format", "paste-format-many"],
  ],
};

/** Shortcuts the browser owns: a page cannot intercept them, so the hint says so. New workbook's
 *  Ctrl+N opens a new browser window and never reaches the page (UX menus audit M9); a different chord
 *  is a provisional owner decision, so for now the menu says "desktop app" like the window chords. */
export const BROWSER_RESERVED: ReadonlySet<string> = new Set(["new-workbook", "window-new", "window-close", "window-focus-next", "window-focus-prev"]);

/** A second chord for the same command, shown after the first. */
export const EXTRA_SHORTCUT: Readonly<Record<string, string>> = { autoscale: "⌘R", left: "⌘B", "history-redo": "⌘Y" };
