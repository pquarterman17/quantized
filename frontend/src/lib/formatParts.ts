// Format BY PARTS (plan item 42, Origin's "Paste Format (Advanced)" and Theme
// Organizer categories): the explicit list of store fields each part of a graph
// format owns. Copy Format captures the whole format (`lib/graphFormat.ts`); a
// paste or a saved theme may apply only the ticked parts.
//
// Every field a format could carry has ONE owner here, and the tables are typed
// `Record<keyof T, ...>`, so a field added to `PlotView`, `SeriesStyle`,
// `AxisFormat` or `AxisLabelStyle` fails the type check until somebody decides
// which part owns it, or that it is never pasted ("never": data bindings, text,
// decorations, plot modes). `formatParts.test.ts` pins the lists at run time.
//
// Pure. Applying a part is `lib/formatPartsPatch.ts`.

import type { PlotView } from "./plotview";
import type { AxisFormat, AxisLabelStyle, SeriesStyle } from "./types";

export type FormatPartId =
  | "fontTicks" | "fontTitles"
  | "colorCurves" | "colorBackground" | "colorGrid"
  | "symbols" | "lines" | "curveOptions"
  | "scalesX" | "scalesY" | "scalesY2" | "extraAxes" | "limitsX" | "limitsY" | "limitsY2"
  | "legend" | "frame";

export type FormatPartGroup = "Fonts" | "Colours" | "Symbols" | "Line styles" | "Scales" | "Legend" | "Frame";

export interface FormatPart {
  id: FormatPartId;
  group: FormatPartGroup;
  label: string;
  /** Not in "everything": data-anchored (limits) or never carried by Copy / Paste Format before
   *  (the page background). It travels only when ticked. */
  optIn?: boolean;
}

export const FORMAT_PARTS: readonly FormatPart[] = [
  { id: "fontTicks", group: "Fonts", label: "Tick label size" },
  { id: "fontTitles", group: "Fonts", label: "Axis title fonts" },
  { id: "colorCurves", group: "Colours", label: "Curve colours and colour gradient" },
  { id: "colorGrid", group: "Colours", label: "Grid lines" },
  { id: "colorBackground", group: "Colours", label: "Page background", optIn: true },
  { id: "symbols", group: "Symbols", label: "Marker shape, size, fill and edge" },
  { id: "lines", group: "Line styles", label: "Line width and dash" },
  { id: "curveOptions", group: "Line styles", label: "Other curve options (bars, fill, error bars, stacking)" },
  { id: "scalesX", group: "Scales", label: "X axis type and tick format" },
  { id: "scalesY", group: "Scales", label: "Y axis type and tick format" },
  { id: "scalesY2", group: "Scales", label: "Y2 axis type and tick format" },
  { id: "extraAxes", group: "Scales", label: "Extra Y axes (Y3 and up) and which curves use them" },
  { id: "limitsX", group: "Scales", label: "X limits and tick step", optIn: true },
  { id: "limitsY", group: "Scales", label: "Y limits and tick step", optIn: true },
  { id: "limitsY2", group: "Scales", label: "Y2 limits and tick step", optIn: true },
  { id: "legend", group: "Legend", label: "Legend: show, position, size and frame" },
  { id: "frame", group: "Frame", label: "Axis box and plot template" },
];

const IDS: readonly FormatPartId[] = FORMAT_PARTS.map((p) => p.id);

/** What "everything" means: every part that is not opt-in -- the same fields Paste Format carries, plus the legend's free position. */
export const DEFAULT_PARTS: readonly FormatPartId[] = FORMAT_PARTS.filter((p) => !p.optIn).map((p) => p.id);

export const isPartId = (v: unknown): v is FormatPartId => IDS.includes(v as FormatPartId);

/** The valid, de-duplicated part ids of an untrusted list (a saved theme); null when none survive. */
export function sanitizeParts(v: unknown): FormatPartId[] | null {
  if (!Array.isArray(v)) return null;
  const ids = IDS.filter((id) => v.includes(id));
  return ids.length > 0 ? ids : null;
}

/** The label of a part. */
export const partLabel = (id: FormatPartId): string => FORMAT_PARTS.find((p) => p.id === id)?.label ?? id;

// ── Owners ───────────────────────────────────────────────────────────────────

type Owner = FormatPartId | "never";
/** `series`: the per-curve styles (`SERIES_OWNER`); `axisFmt`: a tick format (`AXIS_FMT_OWNER`). */
type ViewOwner = Owner | "series" | "axisFmt";

/** Every `PlotView` field: its part, or "never". A field Copy Format never carried and no part owns is "never"
 *  (data bindings, text, decorations, plot modes), so it can never be pasted by accident. */
export const VIEW_OWNER: Record<keyof PlotView, ViewOwner> = {
  xScale: "scalesX", xReversed: "scalesX", yScale: "scalesY", y2Scale: "scalesY2",
  xFmt: "axisFmt", yFmt: "axisFmt", y2Fmt: "axisFmt",
  xLim: "limitsX", xStep: "limitsX", yLim: "limitsY", yStep: "limitsY", y2Lim: "limitsY2", y2Step: "limitsY2",
  yAxes: "extraAxes", yAxisOf: "extraAxes",
  y2Keys: "extraAxes", // only ever changes to take a curve OFF Y2 onto a Y3+ axis (lib/graphFormatMultiY.ts)
  axisLabelStyles: "fontTitles",
  seriesStyles: "series", seriesRamp: "colorCurves",
  showGrid: "colorGrid",
  showLegend: "legend", legendPos: "legend", legendStatic: "legend", legendXY: "legend", legendFrameXY: "legend", legendSize: "legend",
  showAxisBox: "frame", plotTemplate: "frame",
  // Text and positions the user typed or dragged: not format.
  legendTitle: "never", axisLabelOffsets: "never", plotTitle: "never", xAxisLabel: "never", yAxisLabel: "never", y2AxisLabel: "never",
  seriesLabels: "never",
  // What is plotted, and from where: data, never pasted.
  xKey: "never", yKeys: "never", groupKey: "never", facetKey: "never", errKeys: "never", seriesOrder: "never",
  hiddenChannels: "never", rowRange: "never", pointLabels: "never", overlays: "never",
  // Plot modes, decorations and layout.
  exchangeXY: "never", stackMode: "never", insetMode: "never", inset: "never", layers: "never", polarMode: "never",
  statMode: "never", statHideEmptyLevels: "never", statShowGroupN: "never", statShowSummary: "never", statMarks: "never",
  statPicks: "never", refLines: "never", annotations: "never", regionShades: "never", shapes: "never",
  waterfall: "never", waterfallDx: "never", panelFit: "never", pageSetup: "never",
};

/** The window's page background lives on the window record, not the view (`PlotWindow.bg`). */
export const BACKGROUND_PART: FormatPartId = "colorBackground";

/** Every `AxisFormat` key. "scales" is the axis's own part (`scalesX` / `scalesY` / `scalesY2`). `breaks` are
 *  data-anchored stretches of the SOURCE's units: the target keeps its own. */
export const AXIS_FMT_OWNER: Record<keyof AxisFormat, "scales" | "fontTicks" | "colorGrid" | "never"> = {
  mode: "scales", digits: "scales", divide: "scales", divideMark: "scales", minor: "scales", ticks: "scales", base: "scales",
  prob: "scales", custom: "scales", prefix: "scales", suffix: "scales", cross: "scales", reverse: "scales", anchor: "scales",
  equal: "scales", rotate: "scales", offset: "scales", top: "scales",
  size: "fontTicks", grid: "colorGrid", breaks: "never",
};

export const AXIS_SCALES_PART = { x: "scalesX", y: "scalesY", y2: "scalesY2" } as const satisfies Record<string, FormatPartId>;

/** Every `SeriesStyle` key. A channel-bound key is "never": a channel index from one dataset means nothing on
 *  another (`portableStyle` strips them from a format too). `rampRank` is derived, never stored. */
export const SERIES_OWNER: Record<keyof SeriesStyle, Owner> = {
  color: "colorCurves",
  marker: "symbols", markerSize: "symbols", markerShape: "symbols", markerFill: "symbols", markerEdge: "symbols",
  markerFillColor: "symbols", markerAlpha: "symbols", markerEvery: "symbols", markerText: "symbols", markerTextSize: "symbols",
  markerTextFrom: "symbols", symbolGap: "symbols",
  width: "lines", line: "lines", step: "lines", connect: "lines", doubleLine: "lines", lineFront: "lines",
  fill: "curveOptions", bars: "curveOptions", stack: "curveOptions", stackTotal: "curveOptions", float: "curveOptions",
  explicit: "curveOptions", logOffset: "curveOptions", errorBar: "curveOptions", dropLines: "curveOptions", rug: "curveOptions",
  rugLength: "curveOptions", rugOpacity: "curveOptions", rowStates: "curveOptions",
  colorBy: "never", colormap: "never", sizeBy: "never", sizeRange: "never", rampRank: "never",
};

/** Every `AxisLabelStyle` key rides the axis-title part: a title's size, italic and bold are one font. */
export const AXIS_LABEL_STYLE_OWNER: Record<keyof AxisLabelStyle, "fontTitles"> = { size: "fontTitles", italic: "fontTitles", bold: "fontTitles" };

// ── What the ticked parts select ─────────────────────────────────────────────

export type PartSet = ReadonlySet<FormatPartId>;

const keysOf = <T extends string>(table: Record<T, string>, owned: (owner: string) => boolean): T[] =>
  (Object.keys(table) as T[]).filter((k) => owned(table[k]));

/** The `PlotView` fields copied whole: those owned by a ticked part (not the split `series` / `axisFmt` fields). */
export const wholeViewKeys = (parts: PartSet): (keyof PlotView)[] =>
  keysOf(VIEW_OWNER, (o) => o !== "series" && o !== "axisFmt" && o !== "never" && parts.has(o as FormatPartId));

/** The `SeriesStyle` keys the ticked parts replace on each curve. */
export const seriesKeys = (parts: PartSet): (keyof SeriesStyle)[] => keysOf(SERIES_OWNER, (o) => o !== "never" && parts.has(o as FormatPartId));

/** The `AxisFormat` keys of `axis` the ticked parts replace. */
export const axisFmtKeys = (parts: PartSet, axis: keyof typeof AXIS_SCALES_PART): (keyof AxisFormat)[] =>
  keysOf(AXIS_FMT_OWNER, (o) => (o === "scales" ? parts.has(AXIS_SCALES_PART[axis]) : o !== "never" && parts.has(o as FormatPartId)));
