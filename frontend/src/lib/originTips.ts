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
      "Add a computed column with a formula; combine two datasets with Data ▸ Dataset math. Recalc mode controls when formulas re-run (auto / manual / off).",
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
