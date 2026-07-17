// Pure data for the plot toolbar (GUI_INTERACTION_PLAN #7, plot-toolbar
// legibility): every button's short NAME (aria-label + the tooltip's bold
// header) split from its one-line behaviour DESCRIPTION (the tooltip's second
// line), plus which of the six named groups (Navigate/Inspect/Analyze/
// Annotate/View/Export) it belongs to. No React/store import here — kept in
// lib/ so it's trivially unit-testable and free of the .tsx component-ceiling
// ratchet. Wording is reworded from PlotToolbar's old single-line `title`
// strings, not new behavior — see PlotToolbar.tsx for how these render.

import type { DrawShapeKind } from "../components/Stage/useShapeDraw";
import type { PlotTool } from "./uplotOpts";

export interface ToolDef {
  id: PlotTool;
  glyph: string;
  name: string;
  desc: string;
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
  { id: "pointer", glyph: "➤", name: "Pointer", desc: "Select and arrange plot objects" },
  { id: "zoom", glyph: "⛶", name: "Zoom", desc: "Drag a box to zoom into a region" },
  { id: "pan", glyph: "✥", name: "Pan", desc: "Drag to pan the view" },
];

// ── Inspect: read values off the plot without transforming it. ──
export const INSPECT_TOOLS: ToolDef[] = [
  { id: "cursor", glyph: "✛", name: "Data Cursor", desc: "Click a point to read its coordinates" },
  { id: "measure", glyph: "∡", name: "Measure", desc: "Drag between two points for Δx, Δy, slope" },
  { id: "stats", glyph: "Σ", name: "Region Stats", desc: "Drag a range to compute summary statistics" },
  { id: "select", glyph: "⬚", name: "Select Rows", desc: "Drag an x-range to select rows in the worksheet" },
];

// ── Analyze: region tools whose result persists as a chip (∫ / ∩) or a live
// gadget overlay. ──
export const ANALYZE_TOOLS: ToolDef[] = [
  { id: "integ", glyph: "∫", name: "Integrate", desc: "Drag a range for the area under the curve" },
  { id: "fwhm", glyph: "∩", name: "Peak / FWHM", desc: "Drag a range to measure a peak's width" },
  { id: "qfit", glyph: "≈", name: "Gadget", desc: "Drag a region or place cursors for a live fit or analysis" },
];

// ── Annotate: the shape dock flyout (MAIN #27) — the ONE place a first-time
// user discovers every drawable mark, including "Text box" (not a Shape
// kind — see useShapeDraw's header). ──
export const SHAPE_TOOLS: ShapeDef[] = [
  { kind: "arrow", glyph: "↗", label: "Arrow" },
  { kind: "line", glyph: "╱", label: "Line" },
  { kind: "rect", glyph: "▭", label: "Rectangle" },
  { kind: "ellipse", glyph: "◯", label: "Ellipse" },
  { kind: "textbox", glyph: "▤", label: "Text box" },
];

// ── View: whole-plot view actions + alternate render modes. Each is a named
// const (not an array) — every one has bespoke active/disabled wiring in
// PlotToolbar.tsx, so array-index lookups would be more fragile than a name. ──
export const RESET_VIEW: ActionDef = {
  id: "reset",
  glyph: "⊡",
  name: "Reset View",
  desc: "Restore the default zoom and pan",
};
export const SMART_SCALE: ActionDef = {
  id: "smartScale",
  glyph: "⊿",
  name: "Smart Auto-scale",
  desc: "Pick linear or log scale from the data's range",
};
export const STACK_MODE: ActionDef = {
  id: "stack",
  glyph: "▤",
  name: "Stack Channels",
  desc: "Show each channel in its own panel",
};
export const INSET_MODE: ActionDef = {
  id: "inset",
  glyph: "⊕",
  name: "Magnifier Inset",
  desc: "Show a zoomed inset over the plot",
};
export const POLAR_MODE: ActionDef = {
  id: "polar",
  glyph: "✺",
  name: "Polar Plot",
  desc: "Render angle vs. radius",
};
export const STAT_MODE: ActionDef = {
  id: "statMode",
  glyph: "▦",
  name: "Statistics View",
  desc: "Show box, violin, Q-Q, or histogram views",
};

// ── Export: get the plot or its data out. ──
export const SAVE_PNG: ActionDef = {
  id: "savePng",
  glyph: "⤓",
  name: "Save PNG",
  desc: "Export the plot as a PNG image",
};
export const COPY_DATA: ActionDef = {
  id: "copyData",
  glyph: "⧉",
  name: "Copy Data",
  desc: "Copy the plotted data as tab-separated values",
};
export const COPY_IMAGE: ActionDef = {
  id: "snapshot",
  glyph: "⎘",
  name: "Copy Image",
  desc: "Copy the plot image to the clipboard",
};
export const SNAPSHOT_WINDOW: ActionDef = {
  id: "snapshotWindow",
  glyph: "⊞",
  name: "Snapshot Window",
  desc: "Freeze the plot into a new compare window",
};
