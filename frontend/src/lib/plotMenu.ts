// Menu-spec builder for the plot right-click menu (the canvas parity of the
// MATLAB axes/line uicontextmenus). Pure over an explicit context object — the
// same testable pattern as worksheet/worksheetMenuModel.ts — so the entry list for
// a given cursor position + store state is unit-tested without rendering a
// canvas. All entries call back into EXISTING store actions supplied on `ctx`;
// PlotContextMenu.tsx builds `ctx` from the hit-test + the live store and hands
// the result to <ContextMenu>.

import type { ContextMenuItem, Swatch } from "../components/overlays/ContextMenu";
import { buildMenuItems } from "./contextActions";
import { curveActions } from "./curveContextActions";
import type { DrawnSeriesStyle } from "./drawnSeriesStyle";
import { fmtNum } from "./format";
import { MARKER_SHAPES } from "./markerShapes";
import type { AxisZone } from "./plotHitTest";
import { NO_RANGE_REASON, type PlotRange } from "./plotRangeSelection";
import type { AxisScale, LineStyle, MarkerShape, SeriesStyle } from "./types";

export type LegendCorner = "auto" | "ne" | "nw" | "se" | "sw";

/** The hit-tested series under the cursor (null → clicked empty plot space). */
export interface MenuSeries {
  /** Dataset channel index (stable across show/hide). */
  channel: number;
  /** Display label already resolved (custom rename or default). */
  label: string;
  /** Current per-series override (possibly empty). */
  style: SeriesStyle;
  /** What the canvas DRAWS (P3.3 auto cycle resolved); absent → `style`. */
  drawn?: DrawnSeriesStyle;
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
  /** Static (Origin) legend mode — clean read-only block (decode #52). */
  legendStatic: boolean;

  // ── series actions (existing store actions) ──
  setColor: (channel: number, color: string) => void;
  setLine: (channel: number, line: LineStyle) => void;
  setWidth: (channel: number, width: number | undefined) => void;
  setMarker: (channel: number, marker: boolean, shape?: MarkerShape) => void;
  resetStyle: (channel: number) => void;
  toggleHidden: (channel: number) => void;
  rename: (channel: number) => void;
  toggleY2: (channel: number) => void;
  /** GUI_INTERACTION #3 sub-item 4 — reorder this channel's draw order by one
   *  step (dir -1 = earlier/under, +1 = later/over); mirrors PlotLegend's own
   *  `move`. */
  moveSeries: (channel: number, dir: -1 | 1) => void;
  /** Whether `moveSeries(channel, dir)` would do anything (already at that
   *  end of the draw order, or the channel isn't currently plotted). */
  canMoveSeries: (channel: number, dir: -1 | 1) => boolean;

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
  setLegendStatic: (v: boolean) => void;
  resetView: () => void;
  /** MAIN #35: publication render -> clipboard (the default copy). */
  copyFigure: () => void;
  /** MAIN #35: vector copy. Absent when the browser won't take SVG. */
  copyFigureSvg?: () => void;
  /** P3.6: add the plot to a report as a rendered figure block (lazy
   *  lib/sendFigureToReport). Optional so existing callers/tests are unchanged. */
  sendToReport?: () => void;
  /** The File/Plot menu's "Export figure…" (the vector publication export). Optional: omitted, no entry. */
  exportFigure?: () => void;
  /** The quick screen-resolution canvas grab. */
  copyImage: () => void;
  savePng: () => void;
  copyData: () => void;

  // ── tools (preserve the pre-existing axes-menu tool activations) ──
  setTool: (tool: "integ" | "fwhm" | "qfit" | "measure") => void;

  /** Audit P2.4: the selected x-range "Peak Fitting ▸ Fit this range" fits
   *  (lib/plotRangeSelection), or null — the entry is then disabled with
   *  `NO_RANGE_REASON` as its tooltip. */
  peakRange: PlotRange | null;
  /** Open the Peak analyzer on `peakRange` with its peaks found. */
  fitPeakRange: () => void;

  /** UX-R6 manual annotation entry point: place a new text annotation at the
   *  DATA coordinates under the cursor (the caller has already converted the
   *  click's pixel position via the live uPlot instance). Only offered while
   *  `zone === "plot"` — see buildPlotMenu below — so the placement is always
   *  inside the visible plotting rect, never extrapolated into an axis
   *  gutter. Strengthens the SAME annotation model the toolbar's "Text box"
   *  tool and the Inspector's Annotations card already write to; no second
   *  figure-decoration state. */
  addTextHere: () => void;

  /** Gap audit 2 #7: mask points from the plot. `selected` = the brushed
   *  rows (Select Rows tool / worksheet selection) of the active dataset,
   *  `excludedSelected` how many of them are already excluded, `excluded`
   *  the dataset's excluded-row count. The actions are the worksheet's own
   *  row exclusion (`store/rowState`), so undo, fits and exports follow. */
  pointMask?: {
    selected: number;
    excludedSelected: number;
    excluded: number;
    exclude: () => void;
    include: () => void;
    includeAll: () => void;
  };
  /** Gap audit 2 #8: open the Plot Details dialog on a curve. */
  openDetails?: (channel: number) => void;
  /** Gap audit 3 N2: the data point under the right-click (`row` = its
   *  dataset row) and a toggle masking / unmasking just that point. */
  pointUnder?: { row: number; excluded: boolean; toggle: () => void; refused?: string };
  /** Item 38: "Change Y / X / Worksheet" and "Hide others" for the curve
   *  under the cursor (components/Stage/curveRebindMenu.ts), spliced after "Draw order". */
  curveExtras?: ContextMenuItem[];
  /** Gap audit 3 N1: open Layer Contents for this graph. */
  layerContents?: () => void;
  /** Exchange X-Y axes (lib/exchangeXY.ts): on/off, why it cannot be (disabled entry), the toggle. */
  exchange?: { on: boolean; blocker?: string; toggle: () => void };
  colorGradient?: () => void; // gap audit 4 G1
  legendFormat?: () => void; // audit 6 M: the Legend dialog
  /** M6: open the Axis dialog on an axis (Origin's right-click on an axis goes
   *  straight to its Properties). Optional: omitted, no entry. */
  axisSettings?: (axis: "x" | "y" | "y2") => void;
  /** Gap audit 3 N3: link this graph's X axis with other graph windows. */
  linkXAxis?: () => void;
  /** Gap audit 4 G19: "Link Y axis with…" (present with another graph window). */
  linkYAxis?: () => void;
}

/** Palette swatches: the 8 re-themeable `--series-N` tokens + black/white/grey. */
const PALETTE: { key: string; title: string; value: string }[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    key: `s${i + 1}`,
    title: `Series ${i + 1}`,
    value: `--series-${i + 1}`,
  })),
  { key: "black", title: "Black", value: "#000000" },
  { key: "grey", title: "Gray", value: "#808080" },
  { key: "white", title: "White", value: "#ffffff" },
];

const LINE_OPTS: { value: LineStyle; label: string }[] = [
  { value: "solid", label: "Solid ──" },
  { value: "dashed", label: "Dashed ╌╌" },
  { value: "dotted", label: "Dotted ···" },
];

const LEGEND_OPTS: { value: LegendCorner; label: string }[] = [
  { value: "auto", label: "Auto (least crowded)" },
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
  settings?: () => void,
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
    ...(settings ? [{ label: `${name} axis settings…`, run: settings }] : []),
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
    // M7 (UX menus audit; provisional, owner to confirm): the curve block was
    // ~15 rows (about 35 with the common block). The one-click swatch row stays
    // on top; the four style pickers (and the old "Color" duplicate of the
    // swatch row) fold into one "Style" submenu, and the two draw-order moves
    // into "Draw order". The everyday verbs (Hide, Rename, Y axis side) and
    // Plot Details stay top level.
    items.push({ swatches: colorSwatches(s, ctx) });
    const details = ctx.openDetails;
    const target = { series: s, ctx, overridden };
    const only = (...ids: string[]) => buildMenuItems(curveActions.filter((a) => "id" in a && ids.includes(a.id)), target);
    // Checks what the canvas DRAWS: with P3.3's auto cycle on, an unstyled
    // series' dash/glyph comes from the cycle and is marked "(auto)". Picking
    // any entry still stores it explicitly, and the cycle then steps aside.
    const drawn = s.drawn?.style ?? s.style;
    const auto = (label: string, isAuto: boolean | undefined) => (isAuto ? `${label} (auto)` : label);
    const line = drawn.line ?? "solid";
    items.push({
      label: "Style",
      submenu: [
        {
          // Gap audit 2 #8: named colors (and Custom… into Plot Details' full picker).
          label: "Color",
          submenu: [
            ...PALETTE.map((c) => ({ label: c.title, run: () => ctx.setColor(s.channel, c.value), checked: s.style.color === c.value })),
            ...(details ? [{ separator: true as const }, { label: "Custom…", run: () => details(s.channel) }] : []),
          ],
        },
        {
          label: "Line style",
          submenu: LINE_OPTS.map((o) => ({
            label: auto(o.label, o.value === line && s.drawn?.autoLine),
            run: () => ctx.setLine(s.channel, o.value),
            checked: line === o.value,
          })),
        },
        {
          label: "Width",
          submenu: [1, 2, 3].map((w) => ({ label: `${w} px`, run: () => ctx.setWidth(s.channel, w), checked: s.style.width === w })),
        },
        {
          label: "Marker",
          submenu: [
            { label: "None", run: () => ctx.setMarker(s.channel, false), checked: !s.style.marker },
            ...MARKER_SHAPES.map((m) => {
              const on = !!s.style.marker && (drawn.markerShape ?? "circle") === m.value;
              return {
                label: auto(m.label, on && s.drawn?.autoMarkerShape),
                run: () => ctx.setMarker(s.channel, true, m.value),
                checked: on,
              };
            }),
          ],
        },
        ...only("curve.resetStyle"),
      ],
    });
    // GUI_INTERACTION #8: the discrete curve actions are defined once in the
    // shared context-action registry (lib/curveContextActions.ts).
    items.push(...only("curve.toggleHidden", "curve.rename", "curve.toggleY2"));
    items.push({ label: "Draw order", submenu: only("curve.moveEarlier", "curve.moveLater") });
    items.push(...(ctx.curveExtras ?? []));
    if (details) items.push({ label: "Plot Details…", run: () => details(s.channel) });
    items.push({ separator: true });
  }

  // Gap audit 2 #7: exclude / include the brushed points, Origin's "mask".
  const p = ctx.pointUnder;
  if (p) {
    if (p.refused) items.push({ label: `Can't mask this point: ${p.refused}`, run: () => undefined, disabled: true, title: p.refused });
    else items.push({ label: p.excluded ? `Unmask this point (row ${p.row + 1})` : `Mask this point (row ${p.row + 1})`, run: p.toggle });
    if (!(ctx.pointMask && (ctx.pointMask.selected > 0 || ctx.pointMask.excluded > 0))) items.push({ separator: true });
  }
  const m = ctx.pointMask;
  if (m && (m.selected > 0 || m.excluded > 0)) {
    if (m.selected > 0) {
      items.push({ label: `Exclude selected points (${m.selected})`, run: m.exclude, disabled: m.excludedSelected >= m.selected });
      items.push({ label: "Include selected points", run: m.include, disabled: m.excludedSelected === 0 });
    }
    if (m.excluded > 0) items.push({ label: `Include all points (${m.excluded})`, run: m.includeAll });
    items.push({ separator: true });
  }

  // UX-R6 manual annotation: an obvious, always-near-the-top entry — offered
  // only inside the plot body (not an axis gutter, where a data-anchored
  // placement would land off the visible extents).
  if (ctx.zone === "plot") {
    items.push({ label: "Add text here…", run: ctx.addTextHere });
    items.push({ separator: true });
  }

  // 2 ── Axes (which axis depends on the cursor zone) ────────────────────────
  const xItems = axisItems("X", ctx.xScale, ctx.setXScale, ctx.autoscaleX, ctx.limitsX, ctx.axisSettings && (() => ctx.axisSettings?.("x")));
  const yItems = axisItems("Y", ctx.yScale, ctx.setYScale, ctx.autoscaleY, ctx.limitsY, ctx.axisSettings && (() => ctx.axisSettings?.("y")));
  const y2Items = axisItems("Y2", ctx.y2Scale, ctx.setY2Scale, ctx.autoscaleY2, ctx.limitsY2, ctx.axisSettings && (() => ctx.axisSettings?.("y2")));
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
      { label: "Legend", run: () => ctx.setShowLegend(!ctx.showLegend), checked: ctx.showLegend },
      // decode #52: a clean read-only block (Origin apply) vs the full
      // interactive legend; the user flips it back after an Origin apply.
      { label: "Static (Origin) legend", run: () => ctx.setLegendStatic(!ctx.legendStatic), checked: ctx.legendStatic, disabled: !ctx.showLegend },
      ...(ctx.legendFormat ? [{ label: "Legend formatting…", run: ctx.legendFormat }] : []),
      { separator: true },
      ...LEGEND_OPTS.map((o) => ({
        label: o.label,
        run: () => ctx.setLegendPos(o.value),
        checked: ctx.legendPos === o.value,
        disabled: !ctx.showLegend,
      })),
    ],
  });
  // A checkbox named for the thing, not an action: "Hide grid ✓" read as "the grid is hidden".
  items.push({ label: "Grid lines", run: () => ctx.setShowGrid(!ctx.showGrid), checked: ctx.showGrid });
  const ex = ctx.exchange;
  if (ex) items.push({ label: "Exchange X–Y axes", run: ex.toggle, checked: ex.on, disabled: !!ex.blocker, title: ex.blocker });
  if (ctx.layerContents) items.push({ label: "Layer contents…", run: ctx.layerContents });
  if (ctx.colorGradient) items.push({ label: "Color gradient…", run: ctx.colorGradient });
  if (ctx.linkXAxis) items.push({ label: "Link X axis with…", run: ctx.linkXAxis });
  if (ctx.linkYAxis) items.push({ label: "Link Y axis with…", run: ctx.linkYAxis });
  items.push({
    label: "Tools",
    submenu: [
      { label: "Integrate (area under curve)", run: () => ctx.setTool("integ") },
      { label: "Peak / FWHM", run: () => ctx.setTool("fwhm") },
      { label: "Gadget (fit/stats/FFT/cursors)", run: () => ctx.setTool("qfit") },
      { label: "Measure (Δx, Δy)", run: () => ctx.setTool("measure") },
    ],
  });
  const r = ctx.peakRange;
  items.push({
    label: "Peak fitting",
    submenu: [
      {
        label: "Fit this range",
        run: ctx.fitPeakRange,
        disabled: !r,
        title: r ? `Peak analyzer on ${fmtNum(r.lo)} – ${fmtNum(r.hi)} (the ${r.source})` : NO_RANGE_REASON,
      },
    ],
  });
  items.push({ separator: true });
  // First in the block — the owner's "I zoomed by accident, get me back"
  // escape hatch (2026-07-11; double-click on empty canvas does it too).
  items.push({ label: "Reset zoom (autoscale)", run: ctx.resetView });
  // MAIN #35: the publication-quality copy is the DEFAULT "Figure"; the screen
  // grab keeps a slot but says what it is, so the fast option stays available
  // without being mistaken for publication output. The four copy variants
  // share one "Copy" submenu (UX audit 10, P1-6) instead of four top-level rows.
  const copyItems: ContextMenuItem[] = [
    { label: "Figure", run: ctx.copyFigure },
    // Vector copy appears ONLY where the clipboard accepts SVG. An entry that
    // always fails is worse than no entry — the PNG copy already serves
    // everyone, and "Export figure…" is the universal vector route.
    ...(ctx.copyFigureSvg ? [{ label: "Figure (vector)", run: ctx.copyFigureSvg }] : []),
    { label: "Image (screen)", run: ctx.copyImage },
    { label: "Data (TSV)", run: ctx.copyData },
  ];
  items.push({ label: "Copy", submenu: copyItems });
  if (ctx.exportFigure) items.push({ label: "Export figure…", run: ctx.exportFigure });
  items.push({ label: "Save as PNG", run: ctx.savePng });
  if (ctx.sendToReport) items.push({ label: "Send to report…", run: ctx.sendToReport });

  return items;
}
