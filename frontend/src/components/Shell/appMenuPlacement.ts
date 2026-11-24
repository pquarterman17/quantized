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
  // Edit
  "find-in-project": { menu: "Edit", section: null },
  // Data: column operations together.
  "set-column-values": { section: "Columns" },
  "stack-columns": { section: "Columns" },
  "unstack-columns": { section: "Columns" },
  "standardize-columns": { section: "Columns" },
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
  "layer-contents": { section: "Curves & legend" },
  "add-curve-from": { section: "Curves & legend" },
  "link-x-axis": { section: "Axes" },
  "link-y-axis": { section: "Axes" },
  // Tools: calculators and the digitizer are not analysis of the active data.
  calculators: { menu: "Tools", section: null },
  digitizer: { menu: "Tools", section: null },
  // Window
  "window-tile": { section: "Arrange" },
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
  Edit: ["history-undo", "history-redo", "edit-cut", "edit-copy", "paste-data", "select-all-datasets", "find-in-project", "rename-dataset", "copy-figure", "palette"],
};

/** A separator goes before these ids when they are listed at the top level. */
export const BREAK_BEFORE: Readonly<Record<string, ReadonlySet<string>>> = {
  File: new Set(["open-workspace", "preferences"]),
  Edit: new Set(["edit-cut", "select-all-datasets", "palette"]),
};

/** Flyout order within a menu: listed first, the rest in registry order. */
export const SECTION_ORDER: Readonly<Record<string, readonly string[]>> = {
  File: ["Import", "Project", "Export"],
  Plot: ["Axes", "Display", "Curves & legend", "Layout", "Create", "Build & export"],
  Data: ["Combine & split", "Columns", "Rows & summary", "Recalculation"],
  Window: ["Create & open", "Arrange", "Active window", "Navigate"],
};

/** File > Export, grouped (UX audit 11, N4): data, Origin, figure, publication and
 *  page, then recipes and templates. Listed ids come first in this order with a
 *  separator between groups; an unlisted id trails after a final separator.
 *  Provisional, owner to confirm: Origin is its own group. */
export const EXPORT_GROUPS: readonly (readonly string[])[] = [
  ["quick-convert", "export-csv", "export-hdf5", "export-worksheet", "export-consolidated"],
  ["export-origin", "export-origin-project", "send-to-origin"],
  ["export-figure", "export-figure-quick", "export-pdf", "export-svg", "export-png"],
  ["figure-builder", "export-page", "page-setup"],
  ["figure-save", "figure-save-as", "figure-save-recipe", "plot-recipe-manager"],
];

/** Shortcuts the browser owns: a page cannot intercept them, so the hint says so. */
export const BROWSER_RESERVED: ReadonlySet<string> = new Set(["window-new", "window-close", "window-focus-next", "window-focus-prev"]);

/** A second chord for the same command, shown after the first. */
export const EXTRA_SHORTCUT: Readonly<Record<string, string>> = { autoscale: "⌘R", left: "⌘B" };
