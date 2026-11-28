// Tip of the day content (plan item 45). Each tip teaches one real feature and
// names the exact menu path, so a reader can find it in the menu bar.
//
// Every tip carries the command id it describes and its menu path
// (`Menu ▸ Section ▸ Label`). tips.test.ts resolves each one against the REAL
// command registry and the REAL menu model (buildAppMenuItems), so a renamed,
// moved or removed command fails the build instead of leaving a stale tip.
// When you change a menu label or placement, update the tip here.

export interface Tip {
  id: string;
  title: string;
  body: string;
  /** The command a tip describes: its id in the command registry. */
  command: string;
  /** The exact menu path, segments joined by TIP_PATH_SEP. */
  path: string;
}

export const TIP_PATH_SEP = " ▸ ";

export const TIPS: readonly Tip[] = [
  { id: "palette", command: "palette", path: "Edit ▸ Command palette…", title: "Find any command by typing", body: "Open the command palette with ⌘K (Ctrl+K on Windows) and type what you want to do. It searches command names and what they do, so you rarely need to remember where a menu item lives." },
  { id: "preferences", command: "preferences", path: "File ▸ Preferences…", title: "Make the app fit your habits", body: "Preferences holds appearance, number format, plot and export defaults, autosave and the keyboard shortcuts. A change applies at once, and each tab has its own Reset." },
  { id: "find", command: "find-in-project", path: "Edit ▸ Find in project…", title: "Search the whole project", body: "Find in project searches dataset names, columns, notes and metadata, so a sample you measured last month is one search away." },
  { id: "repeat", command: "repeat-last-action", path: "Edit ▸ Repeat last action", title: "Repeat a step on other data", body: "Run the last signal-processing or resample step again, with the same settings, on the datasets you have selected. A step that cannot be repeated says so." },
  { id: "graph-builder", command: "graph-builder", path: "Plot ▸ Create ▸ Graph builder…", title: "Drag columns to build a graph", body: "Graph builder lets you drop columns into X, Y, error and group wells and switch the mark between line, scatter, box and violin while you watch the plot change." },
  { id: "ternary", command: "ternary-figure", path: "Plot ▸ Create ▸ Ternary diagram…", title: "Plot a three-component composition", body: "Pick three composition columns, and optionally a fourth to colour by, and Ternary diagram previews the figure exactly as the PDF, SVG or PNG export draws it." },
  { id: "waterfall", command: "waterfall", path: "Plot ▸ Layout ▸ Waterfall…", title: "Stack curves with an offset", body: "Waterfall plots the selected datasets together and offsets each curve vertically, which keeps a temperature or field series readable." },
  { id: "facet", command: "facet-by-column", path: "Plot ▸ Layout ▸ Facet by column…", title: "Small multiples from one column", body: "Facet by column splits a plot into one panel for each distinct value of a column you choose, so the panels compare side by side." },
  { id: "inset", command: "inset-mode", path: "Plot ▸ Curves & legend ▸ Magnifier inset", title: "Zoom a region inside the plot", body: "Magnifier inset shows a zoomed copy of a region over the plot, so a small feature stays visible next to the full range." },
  { id: "template", command: "graph-template-save", path: "Plot ▸ Templates & format ▸ Save graph template…", title: "Reuse a graph's style", body: "Save graph template stores a graph's style, not its data. Apply it to the next graph and keep every figure in a paper looking the same." },
  { id: "copy-format", command: "copy-format", path: "Plot ▸ Templates & format ▸ Copy format", title: "Copy a graph's format to another", body: "Copy format takes the style of the current graph. Paste format, in the same menu, puts it on another graph, and Paste format (choose parts) lets you pick what carries over." },
  { id: "export-figure", command: "export-figure", path: "File ▸ Export ▸ Export figure…", title: "Export at publication size", body: "Export figure opens a true-size preview with named journal presets, then saves PDF, SVG, PNG, TIFF or EPS." },
  { id: "curvefit", command: "curvefit", path: "Analyze ▸ Curve fit…", title: "Fit a model and read the residuals", body: "Curve fit runs a chosen model on the active dataset and shows the fit, its parameters and its residuals, so you can judge a fit by more than the curve alone." },
  { id: "peaks", command: "peak-wizard", path: "Analyze ▸ Peak analyzer…", title: "Find and fit peaks step by step", body: "Peak analyzer walks through baseline, peak finding and fitting, and the peak markers stay editable on the plot." },
  { id: "signal", command: "signal-processing", path: "Analyze ▸ Transform & signal ▸ Signal processing…", title: "Smooth, differentiate or filter with a preview", body: "Signal processing offers smoothing, derivatives, integration, FFT and filters, each with a live preview before you save the result." },
  { id: "distribution", command: "distribution", path: "Analyze ▸ Statistics ▸ Distribution…", title: "Look at one column's distribution", body: "Distribution shows a histogram, quantiles, descriptive statistics, a fitted distribution and a normality verdict, and can repeat it for each level of a grouping column." },
  { id: "stats-tests", command: "stats-tests", path: "Analyze ▸ Statistics ▸ Statistical tests…", title: "Run a test and read the verdict", body: "Statistical tests runs the test you pick on chosen columns and writes a one-sentence interpretation beside the results table." },
  { id: "filter", command: "data-filter", path: "Data ▸ Rows & summary ▸ Data filter…", title: "Filter rows by condition", body: "Data filter keeps the rows that meet conditions on one or more columns, and you change the conditions interactively." },
  { id: "set-values", command: "set-column-values", path: "Data ▸ Columns ▸ Set column values…", title: "Compute a column from a formula", body: "Set column values fills a column from a formula of the other columns." },
  { id: "pipeline", command: "pipeline", path: "Data ▸ Recalculation ▸ Pipeline…", title: "See and rerun your processing steps", body: "Pipeline lists the transformation and analysis steps behind your data, so you can edit one and rerun the chain." },
  { id: "calculators", command: "calculators", path: "Tools ▸ Calculators…", title: "Materials-science calculators", body: "Calculators covers crystal, scattering length density, transport, optics and superconductivity helpers, for the numbers you would otherwise look up." },
  { id: "shortcuts", command: "shortcuts", path: "Help ▸ Keyboard shortcuts", title: "Learn the keyboard shortcuts", body: "Keyboard shortcuts lists every keyboard and mouse shortcut in one sheet. Press ? outside a text field to open it." },
  { id: "hints", command: "recent-hints", path: "Help ▸ Recent hints…", title: "Reread a message that vanished", body: "Recent hints keeps the last status messages and notifications of this session, with their time and the name of any button they offered. It is cleared when you quit." },
  { id: "gallery", command: "sample-gallery", path: "Help ▸ Sample gallery…", title: "Open a sample graph with its data", body: "Sample gallery opens a ready-made graph together with its worksheet, so you can see how a plot type is built and then edit it." },
];

/** The tip at `index`, wrapping both ways (a stored index never goes out of range). */
export function tipAt(index: number): Tip {
  const n = TIPS.length;
  return TIPS[((Math.trunc(Number.isFinite(index) ? index : 0) % n) + n) % n]!;
}
