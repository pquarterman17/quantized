// Menu-spec builder for the plot right-click menu (the canvas parity of the
// MATLAB axes/line uicontextmenus). Pure over an explicit context object — the
// same testable pattern as worksheet/worksheetMenus.ts — so the entry list for
// a given cursor position + store state is unit-tested without rendering a
// canvas. All entries call back into EXISTING store actions supplied on `ctx`;
// PlotContextMenu.tsx builds `ctx` from the hit-test + the live store and hands
// the result to <ContextMenu>.

import type { ContextMenuItem, Swatch } from "../components/overlays/ContextMenu";
import { MARKER_SHAPES } from "./markers";
import type { AxisZone } from "./plotHitTest";
import type { AxisScale, LineStyle, MarkerShape, SeriesStyle } from "./types";

export type LegendCorner = "ne" | "nw" | "se" | "sw";

/** The hit-tested series under the cursor (null → clicked empty plot space). */
export interface MenuSeries {
  /** Dataset channel index (stable across show/hide). */
  channel: number;
  /** Display label already resolved (custom rename or default). */
  label: string;
  /** Current per-series override (possibly empty). */
  style: SeriesStyle;
  hidden: boolean;
  onY2: boolean;
}

export interface PlotMenuContext {
  series: MenuSeries | null;
  zone: AxisZone;
  hasY2: boolean;
  /** Whether any other visible series remains if this one is hidden (guards the
   *  "Hide series" entry against emptying the plot). */
  canHide: boolean;

  // ── axis + plot view state (for checkmarks / label wording) ──
  xScale: AxisScale;
  yScale: AxisScale;
  /** Effective y2 scale (y2Scale ?? yScale), already resolved by the caller. */
  y2Scale: AxisScale;
  showGrid: boolean;
  showLegend: boolean;
  legendPos: LegendCorner;

  // ── series actions (existing store actions) ──
  setColor: (channel: number, color: string) => void;
  setLine: (channel: number, line: LineStyle) => void;
  setWidth: (channel: number, width: number | undefined) => void;
  setMarker: (channel: number, marker: boolean, shape?: MarkerShape) => void;
  resetStyle: (channel: number) => void;
  toggleHidden: (channel: number) => void;
  rename: (channel: number) => void;
  toggleY2: (channel: number) => void;

  // ── axis actions ──
  setXScale: (v: AxisScale) => void;
  setYScale: (v: AxisScale) => void;
  setY2Scale: (v: AxisScale) => void;
  autoscaleX: () => void;
  autoscaleY: () => void;
  autoscaleY2: () => void;
  limitsX: () => void;
  limitsY: () => void;
  limitsY2: () => void;

  // ── plot actions ──
  setShowGrid: (v: boolean) => void;
  setShowLegend: (v: boolean) => void;
  setLegendPos: (pos: LegendCorner) => void;
  resetView: () => void;
  copyImage: () => void;
  savePng: () => void;
  copyData: () => void;

  // ── tools (preserve the pre-existing axes-menu tool activations) ──
  setTool: (tool: "integ" | "fwhm" | "qfit" | "measure") => void;
}

/** Palette swatches: the 8 re-themeable `--series-N` tokens + black/white/grey. */
const PALETTE: { key: string; title: string; value: string }[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    key: `s${i + 1}`,
    title: `Series ${i + 1}`,
    value: `--series-${i + 1}`,
  })),
  { key: "black", title: "Black", value: "#000000" },
  { key: "grey", title: "Grey", value: "#808080" },
  { key: "white", title: "White", value: "#ffffff" },
];

const LINE_OPTS: { value: LineStyle; label: string }[] = [
  { value: "solid", label: "Solid ──" },
  { value: "dashed", label: "Dashed ╌╌" },
  { value: "dotted", label: "Dotted ···" },
];

const LEGEND_OPTS: { value: LegendCorner; label: string }[] = [
  { value: "ne", label: "Top-right" },
  { value: "nw", label: "Top-left" },
  { value: "se", label: "Bottom-right" },
  { value: "sw", label: "Bottom-left" },
];

/** Colour-swatch row for the hit-tested series. */
function colorSwatches(s: MenuSeries, ctx: PlotMenuContext): Swatch[] {
  return PALETTE.map((c) => ({
    key: c.key,
    title: c.title,
    css: c.value.startsWith("--") ? `var(${c.value})` : c.value,
    active: s.style.color === c.value,
    run: () => ctx.setColor(s.channel, c.value),
  }));
}

/** MAIN #12: the Axes-card idiom (a 3-way Linear/Log/Reciprocal pick) mirrored
 *  as a submenu, same pattern as the "Line style" submenu above. */
const SCALE_OPTS: { value: AxisScale; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "log", label: "Log" },
  { value: "reciprocal", label: "Reciprocal" },
];

/** The X/Y/Y2 sub-entries (scale submenu + autoscale + set-limits) for one axis. */
function axisItems(
  name: string,
  scale: AxisScale,
  setScale: (v: AxisScale) => void,
  autoscale: () => void,
  limits: () => void,
): ContextMenuItem[] {
  return [
    {
      label: `${name} scale`,
      submenu: SCALE_OPTS.map((o) => ({
        label: o.label,
        run: () => setScale(o.value),
        checked: scale === o.value,
      })),
    },
    { label: `Autoscale ${name}`, run: autoscale },
    { label: `Set ${name} limits…`, run: limits },
  ];
}

/** Build the full plot context-menu entry list for the given cursor context. */
export function buildPlotMenu(ctx: PlotMenuContext): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  // 1 ── Series (nearest curve) ─────────────────────────────────────────────
  const s = ctx.series;
  if (s) {
    const overridden = Object.values(s.style).some((v) => v !== undefined);
    items.push({ header: s.label });
    items.push({ swatches: colorSwatches(s, ctx) });
    items.push({
      label: "Line style",
      submenu: LINE_OPTS.map((o) => ({
        label: o.label,
        run: () => ctx.setLine(s.channel, o.value),
        checked: (s.style.line ?? "solid") === o.value,
      })),
    });
    items.push({
      label: "Width",
      submenu: [1, 2, 3].map((w) => ({
        label: `${w} px`,
        run: () => ctx.setWidth(s.channel, w),
        checked: s.style.width === w,
      })),
    });
    items.push({
      label: "Marker",
      submenu: [
        { label: "None", run: () => ctx.setMarker(s.channel, false), checked: !s.style.marker },
        ...MARKER_SHAPES.map((m) => ({
          label: m.label,
          run: () => ctx.setMarker(s.channel, true, m.value),
          checked: !!s.style.marker && (s.style.markerShape ?? "circle") === m.value,
        })),
      ],
    });
    items.push({ separator: true });
    items.push({ label: s.hidden ? "Show series" : "Hide series", run: () => ctx.toggleHidden(s.channel), disabled: !s.hidden && !ctx.canHide });
    items.push({ label: "Rename…", run: () => ctx.rename(s.channel) });
    items.push({
      label: s.onY2 ? "Move to left Y axis" : "Move to right Y axis",
      run: () => ctx.toggleY2(s.channel),
    });
    if (overridden) items.push({ label: "Reset series style", run: () => ctx.resetStyle(s.channel) });
    items.push({ separator: true });
  }

  // 2 ── Axes (which axis depends on the cursor zone) ────────────────────────
  const xItems = axisItems("X", ctx.xScale, ctx.setXScale, ctx.autoscaleX, ctx.limitsX);
  const yItems = axisItems("Y", ctx.yScale, ctx.setYScale, ctx.autoscaleY, ctx.limitsY);
  const y2Items = axisItems("Y2", ctx.y2Scale, ctx.setY2Scale, ctx.autoscaleY2, ctx.limitsY2);
  if (ctx.zone === "x") {
    items.push({ header: "X axis" }, ...xItems);
  } else if (ctx.zone === "y") {
    items.push({ header: "Y axis" }, ...yItems);
  } else if (ctx.zone === "y2") {
    items.push({ header: "Y2 axis" }, ...y2Items);
  } else {
    // "plot" (or a fallback) → offer every axis as a compact submenu.
    items.push({ label: "X axis", submenu: xItems });
    items.push({ label: "Y axis", submenu: yItems });
    if (ctx.hasY2) items.push({ label: "Y2 axis", submenu: y2Items });
  }
  items.push({ separator: true });

  // 3 ── Plot ────────────────────────────────────────────────────────────────
  items.push({
    label: "Legend",
    submenu: [
      { label: ctx.showLegend ? "Hide legend" : "Show legend", run: () => ctx.setShowLegend(!ctx.showLegend), checked: ctx.showLegend },
      { separator: true },
      ...LEGEND_OPTS.map((o) => ({
        label: o.label,
        run: () => ctx.setLegendPos(o.value),
        checked: ctx.legendPos === o.value,
        disabled: !ctx.showLegend,
      })),
    ],
  });
  items.push({ label: ctx.showGrid ? "Hide grid" : "Show grid", run: () => ctx.setShowGrid(!ctx.showGrid), checked: ctx.showGrid });
  items.push({
    label: "Tools",
    submenu: [
      { label: "Integrate (area under curve)", run: () => ctx.setTool("integ") },
      { label: "Peak / FWHM", run: () => ctx.setTool("fwhm") },
      { label: "Gadget (fit/stats/FFT/cursors)", run: () => ctx.setTool("qfit") },
      { label: "Measure (Δx, Δy)", run: () => ctx.setTool("measure") },
    ],
  });
  items.push({ separator: true });
  items.push({ label: "Copy image", run: ctx.copyImage });
  items.push({ label: "Copy data (TSV)", run: ctx.copyData });
  items.push({ label: "Save as PNG", run: ctx.savePng });
  items.push({ label: "Reset view (autoscale)", run: ctx.resetView });

  return items;
}
