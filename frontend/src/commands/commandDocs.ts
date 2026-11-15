// The help copy of the core command list (File, View/Edit/Help, Data, Plot,
// Insert): each command's one-sentence description and its extra ⌘K search
// keywords, keyed by command id.
//
// BUNDLE_HEADROOM slice 28. Only the surfaces that show or search this copy
// read it: the menus' item tooltips (the menu model is lazy), the ⌘K palette
// (lazy) and Help (lazy). None of them renders at first paint, but as fields
// of the command objects the strings shipped in the entry chunk with the
// commands, about 12 kB of them. They live here instead, and
// `buildAppActions` (appCommands.ts, the full list App loads right after
// mount) merges them back, so the list the menus, the palette and Help read
// once it lands is the same list as before.
//
// Adding a core command: give it an entry here. `commandDocs.test.ts` fails
// on a core command without one, on an entry with no command, and on a core
// command that still carries its own description or keywords.
//
// Lazy-only: appCommands.ts is the only module that imports this, and
// architecture.test.ts's DRAGGED_OUT list keeps it out of the entry chunk.

import type { Action } from "../store/commands";

export type CommandDocs = Pick<Action, "description" | "keywords">;

export const CORE_COMMAND_DOCS: Readonly<Record<string, CommandDocs>> = {
  // ── commands/fileCommands.ts ──
  "new-workbook": { description: "Add an empty worksheet to type or paste data into.", keywords: "blank empty book sheet table create" },
  import: { description: "Open one or more supported data files as datasets." },
  "import-sheets": { description: "One workbook, a sheet per file." },
  "import-append": {
    description: "Import multiple compatible files and concatenate them into one dataset.",
    keywords: "combine concatenate merge multi-file append",
  },
  "import-wizard": {
    description: "Preview and configure messy or unfamiliar files, then save the import settings for reuse.",
    keywords: "guess preview parse delimiter header units filter messy",
  },
  "import-origin-template": {
    description: "Import plot styling and layout from an Origin graph template.",
    keywords: "otp otpu origin graph template style preset",
  },
  demo: { description: "Add a generated demonstration dataset for quickly trying plots and analysis." },
  "load-sample": {
    description: "Load the bundled sample data for a guided first workflow without finding a file.",
    keywords: "demo example first-run VSM hysteresis try this",
  },
  "save-workspace": { description: "Save datasets, folders, figures, results, and settings as a Quantized workspace." },
  "pack-project": {
    description: "Create a portable, self-contained copy of the open project and its source files.",
    keywords: "pack project portable bundle copy sources",
  },
  "open-workspace": { description: "Replace the current session with a previously saved Quantized workspace." },
  "open-workspace-safe": {
    description: "Replace the current session with a saved workspace, skipping its saved window layout.",
    keywords: "safe recovery layout skip windows corrupted crash",
  },
  "append-workspace": {
    description: "Merge another saved workspace into the current library without replacing it.",
    keywords: "merge combine import project origin append second library",
  },
  "clear-autosave": { description: "Delete the recovery snapshot while leaving the currently open workspace unchanged." },
  "remove-all": { description: "Permanently clear every dataset, folder, report, and imported figure from the session." },
  "export-csv": { description: "Export the active dataset as a diffraction-friendly CSV file." },
  "export-hdf5": { description: "Export the active dataset and available raw/corrected forms to HDF5." },
  "figure-builder": {
    description: "Preview or export the focused figure at publication size; Apply updates that figure without changing its data.",
    keywords: "figure builder live preview publication",
  },
  "figure-page": {
    description: "Temporarily compose multiple plots into an aligned publication page, then export it.",
    keywords: "figure page multi panel composite",
  },
  "export-figure": { description: "Export the current plot or composed page to a publication-ready image or vector file." },
  "export-origin": { description: "Export data and current plot settings as an Origin script plus accompanying data." },
  "export-origin-project": {
    description: "Save the selected datasets, or all of them, as workbooks in one Origin project.",
    keywords: "opj opju origin project workbook books export",
  },
  "send-to-origin": { description: "Send selected datasets directly to a running Origin session on supported Windows systems." },
  "export-worksheet": { description: "Save worksheets with Long Name and Units rows." },
  "export-consolidated": { description: "Combine every loaded dataset into one consolidated CSV export." },
  preferences: { description: "Configure application appearance, behavior, and persistent user preferences." },
  "export-page": {
    description: "Export an imported multi-panel page using its original spatial page coordinates.",
    keywords: "origin multi-panel page rect true coordinates #54",
  },
  // ── commands/uiCommands.ts ──
  theme: { description: "Switch the application between light and dark appearance." },
  density: { description: "Cycle interface spacing between compact, regular, and comfortable layouts." },
  accent: { description: "Cycle the interface highlight color without changing plot series colors." },
  "toggle-excluded-rows": { description: "Switch XY plot windows between greying and hiding excluded or filtered-out rows." },
  left: { description: "Show or hide the left project library and dataset browser." },
  right: { description: "Show or hide the right properties Inspector for the current selection." },
  "column-switcher": { description: "Quickly preview and switch the plotted data channels in the active dataset." },
  worksheet: { description: "Switch the central stage to the active dataset's worksheet." },
  workflow: { description: "Show analysis steps for the active worksheet." },
  "reset-tool-windows": { description: "Restore floating analysis windows to visible default positions and sizes." },
  plot: { description: "Switch the central stage to the interactive plot." },
  palette: { description: "Search available commands by name, purpose, alias, or shortcut." },
  "paste-data": { description: "Create a dataset from tabular text currently on the clipboard.", keywords: "clipboard import tsv csv table" },
  help: {
    description: "Search tools, commands, import formats, shortcuts, and Origin migration guidance.",
    keywords: "documentation guide how to search tools help",
  },
  shortcuts: { description: "Open the keyboard and mouse shortcut reference." },
  "text-format-help": { description: "View syntax for Greek letters, scientific symbols, fractions, roots, and formatted plot text." },
  "copy-diagnostics": {
    description: "Copy a plain-text report of app settings, display, and workspace size for a bug report — no dataset names, file paths, or measured values.",
    keywords: "bug report support troubleshoot environment version bundle",
  },
  "what-is-this": {
    description: "Point at an interface control to reveal its concise contextual explanation.",
    keywords: "inspect hover contextual help point identify tooltip",
  },
  "interaction-hints": {
    description: "Replay the first-use hints for right-click, double-click, dragging, and plot controls.",
    keywords: "first run mouse right click double click drag drop tips",
  },
  // ── commands/dataCommands.ts ──
  "sqlite-query": { description: "Run a read-only query against a SQLite database and import the result as a dataset." },
  "find-in-project": { description: "Search dataset names, columns, notes, and metadata across the entire project." },
  trash: { description: "Review, restore, or permanently purge datasets moved to project trash." },
  "dataset-math": { description: "Create a derived dataset by mathematically combining two existing datasets." },
  resample: {
    description: "Interpolate one or more datasets onto a new x-grid or another dataset's x, with a live preview.",
    keywords: "interpolate interp1 align regrid common grid match x resample reduce rows bin average duplicate x every nth decimate thin",
  },
  "meta-factors": { description: "Clean up metadata; add a metadata field as a factor column.", keywords: "promote sample unify" },
  transpose: { description: "Swap worksheet rows and columns in a new derived dataset.", keywords: "reshape" },
  "stack-columns": { description: "Reshape selected wide columns into value and category columns in long form.", keywords: "jmp reshape stack long form wide" },
  "unstack-columns": {
    description: "Pivot category and value columns into separate columns in a wide worksheet.",
    keywords: "jmp unstack pivot wide long reshape",
  },
  "join-by-key": { description: "Combine two datasets by matching values in selected key columns.", keywords: "jmp join merge key combine text reshape" },
  tabulate: {
    description: "Calculate grouped summary statistics and create a linked result table.",
    keywords: "jmp tabulate group summary statistics aggregate",
  },
  "row-statistics": {
    description: "Add computed columns holding each row's mean, standard deviation, minimum, maximum, sum or count across chosen columns.",
    keywords: "origin row statistics across columns per row average",
  },
  "frequency-count": {
    description: "Bin one column into a new worksheet with bin edges and centers, counts, cumulative counts and percentages.",
    keywords: "origin frequency count histogram bins table cumulative percent",
  },
  pipeline: {
    description: "Inspect, edit, and rerun the reproducible transformation and analysis steps.",
    keywords: "jmp jsl script recipe save replay reproducible",
  },
  "recalc-now": {
    description: "Immediately rerun corrections and fits whose inputs or settings have changed — or, in recalc mode None (which tracks no changes), every derived worksheet and fit.",
  },
  "recalc-mode": {
    description: "Choose whether stale calculations rerun automatically (Auto), are marked stale and rerun on request (Manual), or are not tracked at all (None — Recalculate now then reruns everything derived).",
  },
  "data-filter": {
    description: "Filter worksheet rows interactively using conditions on one or more columns.",
    keywords: "jmp local data filter rows condition level range",
  },
  merge: {
    description: "Append the selected datasets' rows into one new dataset, by column position or name, with a live preview.",
    keywords: "append concatenate reshape",
  },
  duplicate: { description: "Create an independent copy of the active dataset in the current folder." },
  reimport: { description: "Reload the active dataset from its recorded source using the saved import settings." },
  split: { description: "Create one derived dataset for each distinct value in a selected column.", keywords: "jmp by group split factor level separate" },
  // ── commands/plotCommands.ts ──
  yLog: { description: "Switch the vertical axis between linear, logarithmic, and reciprocal scales." },
  yTickFormat: { description: "Change vertical-axis labels between automatic, fixed, scientific, and engineering notation." },
  waterfall: { description: "Separate overlapping curves with an adjustable vertical offset." },
  "contour-scattered": { description: "Interpolate scattered X, Y, Z points onto a grid and show them as a map." },
  "function-plot": { description: "Plot y = f(x; parameters) over an x range as a live, editable curve." },
  "plot-recipe-manager": { description: "Browse every saved recipe and template.", keywords: "plot recipes manager" },
  autoscale: { description: "Reset zoom and restore automatic limits around the plotted data." },
  "view-back": { description: "Return to the preceding zoom or pan state." },
  "view-forward": { description: "Move forward to the next zoom or pan state." },
  xLog: { description: "Switch the horizontal axis between linear, logarithmic, and reciprocal scales." },
  xTickFormat: { description: "Change horizontal-axis labels between automatic, fixed, scientific, and engineering notation." },
  grid: { description: "Show or hide major plot grid lines." },
  legend: { description: "Show or hide the plot legend." },
  stacked: { description: "Switch between overlaid curves and vertically stacked plot lanes." },
  "panel-fit": {
    description: "Choose whether a multi-panel page preserves its aspect ratio or fills the available stage.",
    keywords: "aspect window spatial page",
  },
  "page-setup": {
    description: "Set publication-page dimensions and margins for layout and export.",
    keywords: "page size margins width height print export #54",
  },
  statMode: { description: "Switch the active numeric column between its plot and statistical distribution views." },
  "inset-mode": { description: "Show a zoomed inset of a region over the plot.", keywords: "zoom inset magnify detail" },
  "facet-by-column": { description: "Split data into small-multiple panels using the distinct values of a selected column." },
  "break-x-axis": { description: "Detect large gaps in horizontal values and display a discontinuous x-axis." },
  "break-y-axis": {
    description: "Hide a stretch of the vertical axis (Break from / Break to) so two separated ranges share one graph.",
    keywords: "axis break gap discontinuous",
  },
  "plot-in-new-window": {
    description: "Open the active dataset in a new plot window, independent of the currently focused window.",
    keywords: "duplicate window multiple views compare side by side library discoverability",
  },
  "panel-row": { description: "Arrange selected datasets in one horizontal row of aligned panels." },
  "panel-column": { description: "Arrange selected datasets in one vertical column of aligned panels." },
  "panel-grid": { description: "Arrange selected datasets in a compact grid of panels." },
  "panel-overlay": { description: "Draw selected datasets together in one shared plot." },
  "plot-selected-together": {
    description: "Plot two or more selected Library datasets in one live graph, one curve per dataset; it follows edits to its sources.",
    keywords: "combine merge overlay library selection",
  },
  "layer-contents": {
    description: "List the current graph's curves: add from any dataset, remove, reorder, or re-bind a curve to another X/Y.",
    keywords: "layer contents curves add remove reorder rebind plot dataset book",
  },
  // ── commands/plotStyleCommands.ts ──
  "color-gradient": { description: "Spread a colormap across the graph's curves.", keywords: "color colour colormap ramp increment" },
  // ── commands/plotCommands.ts ──
  "link-x-axis": {
    description: "Pick graph windows whose X axis follows this one: zoom or pan X in one and the others follow.",
    keywords: "link sync synchronize x axis zoom pan windows graphs compare",
  },
  "link-y-axis": {
    description: "Pick graph windows whose Y axis follows this one: zoom or pan Y in one and the others follow.",
    keywords: "link sync synchronize y axis zoom pan windows graphs compare",
  },
  "add-curve-from": {
    description: "Add a curve from another dataset to the current graph (opens Layer Contents); the graph stays linked to its sources.",
    keywords: "layer contents add plot curve overlay dataset book",
  },
  "send-figure-to-report": {
    description: "Add the current plot to a report; Word, PowerPoint and HTML report exports embed it as rendered.",
    keywords: "report figure embed word powerpoint docx pptx html",
  },
  "axis-dialog": {
    description: "Edit an axis (scale, limits, break, ticks, number format, divide-by, fonts), or double-click the axis.",
    keywords: "scale limits ticks minor divide font break",
  },
  "plot-type": {
    description: "Switch the graph to line, scatter, area, column, box, violin, histogram, contour, double-Y, polar, waterfall, stacked panels or ternary.",
    keywords: "gallery bar histogram heatmap double y polar violin waterfall ternary panels",
  },
  "graph-template-save": { description: "Save this graph's style (not its data) as a reusable template.", keywords: "style otp" },
  "graph-template-apply": { description: "Restyle this graph with a saved template; its data is kept.", keywords: "style otp" },
  "copy-format": { description: "Copy this graph's style (not its data).", keywords: "style" },
  "paste-format": { description: "Apply the copied style to this graph; its data is kept.", keywords: "style" },
  "graph-template-apply-many": {
    description: "Restyle every graph in this folder, the Library selection, or all open graphs with a saved template; one undo step.",
    keywords: "style otp theme organizer folder all batch consistent",
  },
  "paste-format-many": {
    description: "Apply the copied style to every graph in this folder, the Library selection, or all open graphs; one undo step.",
    keywords: "style folder all batch consistent theme",
  },
  "insert-arrow": { description: "Draw an arrow annotation directly on the active plot." },
  "insert-line": { description: "Draw a straight reference or annotation line on the active plot." },
  "insert-rect": { description: "Draw a rectangular region or callout on the active plot." },
  "insert-ellipse": { description: "Draw an elliptical region or callout on the active plot." },
  "insert-textbox": { description: "Place a movable rich-text annotation box on the active plot." },
  "insert-inset": { description: "A small graph of any data, on its own axes, over the plot." },
  "insert-image": { description: "A PNG, JPEG or SVG image on the plot." },
  "insert-table": { description: "A small table, typed or from worksheet rows, on the plot." },
};

/** `actions` with each core command's description and keywords merged in. */
export function withCommandDocs(actions: readonly Action[]): Action[] {
  return actions.map((action) =>
    Object.hasOwn(CORE_COMMAND_DOCS, action.id) ? { ...action, ...CORE_COMMAND_DOCS[action.id] } : action,
  );
}
