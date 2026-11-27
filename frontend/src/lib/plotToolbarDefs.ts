// Pure data for the plot toolbar (GUI_INTERACTION_PLAN #7, plot-toolbar
// legibility): every button's short NAME (aria-label + the tooltip's bold
// header) split from its one-line behaviour DESCRIPTION (the tooltip's second
// line), plus which of the six named groups (Navigate/Inspect/Analyze/
// Annotate/View/Export) it belongs to. No React/store import here — kept in
// lib/ so it's trivially unit-testable and free of the .tsx component-ceiling
// ratchet. Wording is reworded from PlotToolbar's old single-line `title`
// strings, not new behavior — see PlotToolbar.tsx for how these render.
//
// GUI_INTERACTION_PLAN #9 (active-tool feedback): `hint` is the optional
// gesture-phrased override ToolHud.tsx shows ("drag a range to…", "click a
// point to…"); every entry below already reads as a gesture in `desc`, so
// none need one today — the field exists so a future tool whose `desc`
// reads as a feature description rather than an instruction can override
// without forking the toolbar's own copy. `TOOL_DEFS`/`toolDefFor` are the
// single lookup ToolHud uses to go from the live `plotTool` to its
// name/hint — including "region" (the Baseline workshop's programmatic
// "pick from plot" mode, `useBaseline.pickRegion`), which has no toolbar
// button of its own but is still a real non-pointer `PlotTool`.

import type { DrawShapeKind } from "../components/Stage/useShapeDraw";
import type { PlotTool } from "./uplotOpts";
import * as GLYPHS from "./glyphs";

export interface ToolDef {
  id: PlotTool;
  glyph: string;
  name: string;
  desc: string;
  hint?: string;
}

export interface ActionDef {
  id: string;
  glyph: string;
  name: string;
  desc: string;
}

export interface ShapeDef {
  kind: DrawShapeKind;
  glyph: string;
  label: string;
}

// ── Navigate: viewport manipulation. Pointer is FIRST and the store default
// (MAIN #18, owner directive from live testing) — a plain arrow cursor for
// selecting/arranging plot objects; zoom/pan move or reshape the view. ──
export const NAVIGATE_TOOLS: ToolDef[] = [
  { id: "pointer", glyph: GLYPHS.toolPointer, name: "Pointer", desc: "Select and arrange plot objects" },
  { id: "zoom", glyph: GLYPHS.toolZoom, name: "Zoom", desc: "Drag a box to zoom into a region" },
  { id: "pan", glyph: GLYPHS.toolPan, name: "Pan", desc: "Drag to pan the view" },
];

// ── Inspect: read values off the plot without transforming it. ──
export const INSPECT_TOOLS: ToolDef[] = [
  { id: "cursor", glyph: GLYPHS.toolCursor, name: "Data cursor", desc: "Click a point to read its coordinates" },
  { id: "measure", glyph: GLYPHS.toolMeasure, name: "Measure", desc: "Drag between two points for Δx, Δy, slope" },
  { id: "stats", glyph: GLYPHS.toolStats, name: "Region stats", desc: "Drag a range to compute summary statistics" },
  { id: "select", glyph: GLYPHS.toolSelect, name: "Select rows", desc: "Drag an x-range, or a box around points, to select rows; right-click to mask them" },
  { id: "lasso", glyph: GLYPHS.toolLasso, name: "Lasso mask", desc: "Drag an outline around points to mask them; Shift unmasks" },
  { id: "pick", glyph: GLYPHS.toolPick, name: "Pick points", desc: "Click data points to collect them into a worksheet" },
];

// ── Analyze: region tools whose result persists as a chip (∫ / ∩) or a live
// gadget overlay. ──
export const ANALYZE_TOOLS: ToolDef[] = [
  { id: "integ", glyph: GLYPHS.toolIntegrate, name: "Integrate", desc: "Drag a range for the area under the curve" },
  { id: "fwhm", glyph: GLYPHS.toolFwhm, name: "Peak / FWHM", desc: "Drag a range to measure a peak's width" },
  { id: "qfit", glyph: GLYPHS.toolQuickFit, name: "Live fit / quick analysis", desc: "Drag a region or place cursors for a live fit or analysis" },
];

// The Baseline workshop's "Fit from region" (useBaseline.pickRegion) arms
// this tool programmatically — no toolbar button, but still a real
// non-pointer `PlotTool` that needs a HUD entry (GUI_INTERACTION #9).
// Mirrors PlotReadouts' existing resting text for this tool.
const REGION_TOOL: ToolDef = {
  id: "region",
  glyph: GLYPHS.toolRegion,
  name: "Background region",
  desc: "Drag a background range on x for baseline fitting; drag a taller box to limit y too",
};

/** Every PlotTool with a ToolDef, keyed by id — the ONE lookup ToolHud.tsx
 *  (and anything else that wants a tool's name/hint) reads from, so the
 *  toolbar and the HUD can never drift onto different wording. */
export const TOOL_DEFS: Readonly<Record<PlotTool, ToolDef | undefined>> = Object.fromEntries(
  [...NAVIGATE_TOOLS, ...INSPECT_TOOLS, ...ANALYZE_TOOLS, REGION_TOOL].map((t) => [t.id, t]),
) as Record<PlotTool, ToolDef | undefined>;

/** The ToolDef for a live `plotTool` value, or undefined for a tool with no
 *  def (there are none today — every PlotTool variant is covered above). */
export function toolDefFor(tool: PlotTool): ToolDef | undefined {
  return TOOL_DEFS[tool];
}

// ── Annotate: the shape dock flyout (MAIN #27) — the ONE place a first-time
// user discovers every drawable mark, including "Text box" (not a Shape
// kind — see useShapeDraw's header). ──
export const SHAPE_TOOLS: ShapeDef[] = [
  { kind: "arrow", glyph: GLYPHS.shapeArrow, label: "Arrow" },
  { kind: "line", glyph: GLYPHS.shapeLine, label: "Line" },
  { kind: "rect", glyph: GLYPHS.shapeRect, label: "Rectangle" },
  { kind: "ellipse", glyph: GLYPHS.shapeEllipse, label: "Ellipse" },
  { kind: "textbox", glyph: GLYPHS.shapeTextbox, label: "Text box" },
  { kind: "slope", glyph: GLYPHS.shapeSlope, label: "Slope" },
  { kind: "distance", glyph: GLYPHS.shapeDistance, label: "Distance" },
  { kind: "angle", glyph: GLYPHS.shapeAngle, label: "Angle" },
  { kind: "scalebar", glyph: GLYPHS.shapeScalebar, label: "Scale bar" },
];

// ── View: whole-plot view actions + alternate render modes. Each is a named
// const (not an array) — every one has bespoke active/disabled wiring in
// PlotToolbar.tsx, so array-index lookups would be more fragile than a name. ──
export const RESET_VIEW: ActionDef = {
  id: "reset",
  glyph: GLYPHS.actionReset,
  name: "Reset view",
  desc: "Restore the default zoom and pan",
};
export const SMART_SCALE: ActionDef = {
  id: "smartScale",
  glyph: GLYPHS.actionSmartScale,
  name: "Smart auto-scale",
  desc: "Pick linear or log scale from the data's range",
};
export const STACK_MODE: ActionDef = {
  id: "stack",
  glyph: GLYPHS.stackedPanels,
  name: "Stack channels",
  desc: "Show each channel in its own panel",
};
export const INSET_MODE: ActionDef = {
  id: "inset",
  glyph: GLYPHS.actionInset,
  name: "Magnifier inset",
  desc: "Show a zoomed inset over the plot",
};
export const POLAR_MODE: ActionDef = {
  id: "polar",
  glyph: GLYPHS.actionPolar,
  name: "Polar plot",
  desc: "Render angle vs. radius",
};
export const STAT_MODE: ActionDef = {
  id: "statMode",
  glyph: GLYPHS.actionStatMode,
  name: "Statistics view",
  desc: "Show box, violin, Q-Q, or histogram views",
};

// ── Export: get the plot or its data out. ──
export const SAVE_PNG: ActionDef = {
  id: "savePng",
  glyph: GLYPHS.actionSavePng,
  name: "Save PNG",
  desc: "Export the plot as a PNG image",
};
export const COPY_DATA: ActionDef = {
  id: "copyData",
  glyph: GLYPHS.actionCopyData,
  name: "Copy data",
  desc: "Copy the plotted data as tab-separated values",
};
export const COPY_FIGURE: ActionDef = {
  id: "copyFigure",
  glyph: GLYPHS.actionCopyFigure,
  name: "Copy figure",
  desc: "Copy the publication figure (300 DPI) for Office; adds vector SVG where the browser allows",
};
export const SNAPSHOT_WINDOW: ActionDef = {
  id: "snapshotWindow",
  glyph: GLYPHS.newWindow,
  name: "Snapshot window",
  desc: "Freeze the plot into a new compare window",
};
