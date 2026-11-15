// "Coming from Origin" migration tips for the Help hub (GUI_INTERACTION #17).
//
// quantized targets OriginLab refugees, and nothing in the app mapped a
// familiar Origin workflow to its quantized equivalent. This is authored
// net-new (the repo had only file-format-fidelity docs, no workflow map).
//
// Accuracy discipline: every `quantized` string below names a real, verified
// menu label / tool (cross-checked against commands/*.ts) — a tip that points
// at a menu path the app doesn't have is worse than no tip. originTips.test.ts
// pins the shape; tool references resolve against the shared command metadata.

import type { HelpItem } from "./helpContent";

export interface OriginTip {
  id: string;
  /** What you'd do in Origin. */
  origin: string;
  /** How to do it in quantized. */
  quantized: string;
  keywords?: string;
}

export const ORIGIN_TIPS: readonly OriginTip[] = [
  {
    id: "open-project",
    origin: "Open an Origin project (.opj / .opju)",
    quantized:
      "File ▸ Import data… reads .opj and .opju directly (a clean-room reader — no Origin install needed). Or import an Origin template with File ▸ Import Origin template (.otp/.otpu).",
    keywords: "opj opju project template otp open file",
  },
  {
    id: "worksheet",
    origin: "Work with worksheet columns",
    quantized:
      "Show worksheet (View menu) opens the grid. Each column is a channel; set what it plots from the Channels card in the Inspector.",
    keywords: "worksheet column grid channel data",
  },
  {
    id: "set-x-y",
    origin: "Set a column as X or Y for a plot",
    quantized:
      "Drag a channel chip onto the plot's X / Y / Y2 edge, or use the Graph Builder to drop columns into the X / Y / Group / Facet wells (plus Y error / X error wells for XY marks — unambiguous error columns prefill automatically).",
    keywords: "designation x y axis plot assign drag graph builder error bars wells",
  },
  {
    id: "set-column-values",
    origin: "Set Column Values (a column formula)",
    quantized:
      "Right-click a worksheet column header ▸ Set Column Values… for the formula dialog (function and column browsers, a row range, a live preview); combine two datasets with Data ▸ Dataset math. Recalc mode controls when formulas re-run (Auto / Manual / None).",
    keywords: "formula set column values compute derived math recalculate",
  },
  {
    id: "fit",
    origin: "Analysis ▸ Fitting (linear / nonlinear)",
    quantized: "Analyze ▸ Curve fit (shortcut F): pick a model, auto-guess or fit, read params ± errors and goodness-of-fit.",
    keywords: "fit nonlinear linear regression model nlfit",
  },
  {
    id: "peak-analyzer",
    origin: "Peak Analyzer (baseline → find → fit)",
    quantized:
      "Analyze ▸ Peak Analyzer is the same guided workflow; or use Find peaks (P) and Baseline / background as standalone steps.",
    keywords: "peak analyzer baseline find fit deconvolution",
  },
  {
    id: "plotting",
    origin: "Plot Setup / the Graph menu",
    quantized:
      "Graph Builder drives plotting by dragging columns into wells; the mark (scatter / line / box / …) morphs as columns land. Send it to the stage when it looks right.",
    keywords: "plot setup graph builder chart mark scatter line",
  },
  {
    id: "stats",
    origin: "Statistics ▸ hypothesis tests",
    quantized:
      "Analyze ▸ Test chooser recommends a test with its assumptions explained and runs it; Distribution gives a histogram + normality verdict for one column.",
    keywords: "statistics t-test anova normality hypothesis distribution",
  },
  {
    id: "multi-panel",
    origin: "Stacked / multi-layer graphs",
    quantized:
      "Panel: side-by-side / stacked / grid (Data menu) arrange several datasets; Facet by column makes small multiples. Imported Origin multi-panel figures keep their layout.",
    keywords: "layer panel stack multi facet small multiples layout",
  },
  {
    id: "export",
    origin: "Export Graph (EMF / PDF)",
    quantized:
      "Publication preview edits the focused figure at output size (fonts, ticks, margins, breaks, annotations) — Apply commits one undoable change; export is vector PDF/SVG by default (raster only on request). Multi-panel export composes several plots into one labelled page.",
    keywords: "export graph pdf svg vector emf publication figure builder preview page multi panel apply",
  },
  {
    id: "figure-documents",
    origin: "Graph windows saved in the project",
    quantized:
      "Every plot window is a figure document — Save / Save As keeps it under the Library's Editable figures and it reopens with errors, y2, styles, and annotations intact. The Editable button on a Publication figure promotes a copy. A dataset isn't limited to one window either: right-click it in the Library (or the command palette) and choose Plot in new window to view it several ways side by side.",
    keywords: "save figure editable document reopen rename duplicate library graph window publication copy promote plot in new window multiple windows side by side compare",
  },
  {
    id: "send-to-origin",
    origin: "Round-trip back to Origin",
    quantized:
      "Export Origin (.ogs) writes an Origin script + ASCII; on Windows, Send to Origin (COM) pushes straight into a running Origin.",
    keywords: "origin ogs export send com round trip",
  },
  {
    id: "inset-layers",
    origin: "Add an inset graph, picture or table to a graph (or Merge Graph layers)",
    quantized:
      "Insert ▸ Inset graph… / Image… / Table… places a layer on the focused plot: an inset of any datasets' curves on its own axes, a PNG/JPEG/SVG, or a table. Drag to move, use the corner grip to resize; the vector export draws the same layers.",
    keywords: "inset layer merge graph picture image table add layer",
  },
  {
    id: "layer-contents",
    origin: "Layer Contents (add, remove, reorder plots in a layer)",
    quantized:
      "Plot ▸ Layer Contents… (also on the plot's right-click menu) lists the graph's curves to remove, reorder, re-bind or add from any dataset; Plot ▸ Add curve from… adds one curve. Dropping a dataset from the Library onto a graph adds its Y columns.",
    keywords: "layer contents add plot remove curve reorder rebind dataset",
  },
  {
    id: "copy-page",
    origin: "Copy Page (paste a graph into Word / PowerPoint)",
    quantized:
      "Right-click the plot ▸ Copy figure. The message says what reached the clipboard: vector SVG + PNG where the browser allows it, otherwise a 300-DPI PNG. There is no EMF. On Windows, qz --desktop with QZ_WIN_CLIPBOARD=1 can write the clipboard natively (docs/desktop.md).",
    keywords: "copy page clipboard word powerpoint paste emf vector copy graph",
  },
  {
    id: "smoothing",
    origin: "Smoothing and signal processing (median, LOWESS, FFT filter, deconvolution)",
    quantized:
      "Analyze ▸ Signal Processing… covers smoothing, median filter, despike, LOWESS, (de)convolution, Hilbert envelope, FFT and inverse FFT, without re-sorting rows. To bin or thin rows, use the Resample workshop's Reduce rows.",
    keywords: "smooth smoothing median lowess loess despike fft filter ifft hilbert deconvolution convolution reduce bin",
  },
  {
    id: "mask-points",
    origin: "Mask data points (Regional Mask tool)",
    quantized:
      "The plot toolbar's Lasso Mask masks the points inside an outline (Shift unmasks); right-click a point for Mask / Unmask this point. Masked rows are left out of fits and exports.",
    keywords: "mask unmask regional mask lasso exclude points data reader",
  },
  {
    id: "function-plot",
    origin: "Plot a function (Create 2D Function Plot) or a contour from XYZ",
    quantized:
      "Plot ▸ Function plot (y = f(x))… draws a live curve with parameters on the focused graph. Plot ▸ Contour from scattered XYZ… interpolates scattered points into a labelled map.",
    keywords: "function plot 2d function graph contour xyz scattered triangulation",
  },
  {
    id: "compare-datasets",
    origin: "NLFit Compare Datasets (F-test)",
    quantized:
      "In Curve fit, open Global fit and press Compare datasets: an F-test of whether one shared value of the ticked parameters fits every series, or each needs its own.",
    keywords: "compare datasets f-test global fit shared parameters nlfit",
  },
  {
    id: "multiple-y",
    origin: "Multiple Y axes (Y3, Y4, …)",
    quantized:
      "Assign a series to Y3 and up from the Inspector's Channels card or Plot Details, then set each axis from Plot ▸ Y Axis Settings… or by double-clicking it.",
    keywords: "multiple y axes y3 y4 triple y axis offset right",
  },
  {
    id: "workspace",
    origin: "Save the whole project",
    quantized:
      "Save workspace (.dwk) saves every dataset, folder, figure, and setting; Open / Append workspace restores or merges one.",
    keywords: "save project workspace dwk session open append",
  },
];

/** Normalize a tip into a searchable HelpItem so the one Help search finds
 *  it. Matches on the Origin term (title) and the quantized answer + keywords. */
export function tipToHelpItem(t: OriginTip): HelpItem {
  return {
    key: `origin:${t.id}`,
    title: t.origin,
    detail: t.quantized,
    meta: "Coming from Origin",
    keywords: `origin migration ${t.keywords ?? ""}`,
  };
}
