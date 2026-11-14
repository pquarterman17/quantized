// Horizontal bars (an Origin bar graph, plot type 215): the plot turns on
// its side. Origin draws such a layer with its X axis VERTICAL and Y along
// the bottom; uPlot does the same through scale orientation (`ori`), so the
// "x" scale still holds X — limits, formats and log state stay with the
// axis they belong to — and only the geometry rotates. `BAR_PATHS` reads
// the orientation and lays the bars along it; the export draws the same
// (`calc/figure_orient.py`).
//
// Applied when any series asks for horizontal bars (`SeriesStyle.bars ===
// "horizontal"`): Origin rotates the whole layer, not one curve.
import type uPlot from "uplot";
import type { SeriesStyle } from "./seriesStyleTypes";
import type { PlotTool } from "./uplotOpts";

export function hasHorizontalBars(styles: readonly (SeriesStyle | undefined)[] | undefined): boolean {
  return (styles ?? []).some((s) => s?.bars === "horizontal");
}

/** `{scales, axes}`, rotated for horizontal bars; unchanged otherwise. The
 *  X axis moves to the left (side 3) with the Y axis's measured gutter, the
 *  Y axis to the bottom (side 2) with the X axis's band height, and a
 *  secondary Y to the top (side 0). */
export function orientAxes(
  scales: uPlot.Scales,
  axes: uPlot.Axis[],
  styles: readonly (SeriesStyle | undefined)[] | undefined,
): { scales: uPlot.Scales; axes: uPlot.Axis[] } {
  if (!hasHorizontalBars(styles)) return { scales, axes };
  const turned: uPlot.Scales = {};
  for (const [key, sc] of Object.entries(scales)) turned[key] = { ...sc, ori: key === "x" ? 1 : 0 };
  const [x, y, ...rest] = axes;
  return {
    scales: turned,
    axes: [
      { ...x, side: 3, size: y?.size },
      { ...y, side: 2, size: x?.size },
      ...rest.map((a) => ({ ...a, side: 0 as const })),
    ],
  };
}

// ── Overlays on a turned plot ───────────────────────────────────────────────
//
// Every overlay plugin is written for an upright plot: it asks uPlot where a
// value sits (`valToPos`) and draws with the x position across and the y
// position down, relative to `u.bbox`. On a turned plot both positions come
// back along the other axis. Rather than teach each overlay about rotation,
// `orientPlugins` hands their DRAW hooks an upright VIEW of the plot and
// turns the canvas under them: in the view, X runs left to right and Y
// bottom to top over a bbox of the plot's turned size; the canvas transform
// (a transpose with both axes flipped, so "low" and "high" keep their
// meaning — off-scale markers point the right way) puts every stroke, fill
// and point where the turned plot shows that value. Text is drawn upright at
// its anchor. This covers reference lines, region shades, annotations,
// error bars and spans, colour-mapped series, off-scale markers and the axis
// extras alike, and nothing in those modules changes.
//
// Pointer-driven tools and drag editing read raw mouse offsets, which no
// view can turn; `orientArgs` switches them off on a turned plot (the
// toolbar shows why: `TURNED_TOOL_NOTE`). The cursor and its readout need
// nothing: uPlot moves the crosshair with the orientation and the readout
// reads the cursor's data index.

/** Tools that work on a turned plot: everything else reads raw pointer
 *  positions along the upright axes. */
export const TURNED_TOOLS: readonly PlotTool[] = ["pointer", "zoom", "cursor"];
export const TURNED_TOOL_NOTE =
  "Not available on a horizontal bar graph (the plot is turned on its side)";

/** `args` for a turned plot: a pointer-driven tool falls back to zoom, and
 *  wheel zoom and every drag-to-edit hook are off. Unchanged otherwise. */
export function orientArgs<A extends OrientableArgs>(args: A): A {
  if (!hasHorizontalBars(args.seriesStyles)) return args;
  return {
    ...args,
    tool: TURNED_TOOLS.includes(args.tool) ? args.tool : "zoom",
    wheelZoom: false,
    onRefLineMove: undefined,
    annotationEdit: null,
    axisLabelEdit: null,
    shapeEdit: null,
    shapeDraw: null,
    peakWizardEdit: undefined,
    anchorEdit: undefined,
  };
}

interface OrientableArgs {
  seriesStyles?: (SeriesStyle | undefined)[];
  tool: PlotTool;
  wheelZoom?: boolean;
  onRefLineMove?: unknown;
  annotationEdit?: unknown;
  axisLabelEdit?: unknown;
  shapeEdit?: unknown;
  shapeDraw?: unknown;
  peakWizardEdit?: unknown;
  anchorEdit?: unknown;
}

const DRAW_HOOKS = new Set(["draw", "drawClear", "drawAxes", "drawSeries"]);

/** The upright frame of a turned plot `u`: the view's bbox, and the canvas
 *  transform `[a, b, c, d, e, f]` from view to canvas pixels. */
export function turnedFrame(u: uPlot): { bbox: uPlot.BBox; matrix: [number, number, number, number, number, number] } {
  const { left, top, width, height } = u.bbox;
  // view (vx, vy) -> canvas (e - vy, f - vx): X up the canvas, Y across it.
  const e = top + left + width;
  const f = left + top + height;
  return { bbox: { left, top, width: height, height: width }, matrix: [0, -1, -1, 0, e, f] };
}

function isTurned(u: uPlot): boolean {
  return u.scales.x?.ori === 1;
}

/** An upright view of turned plot `u` for one draw hook (module notes). */
export function uprightView(u: uPlot): uPlot {
  const { bbox, matrix } = turnedFrame(u);
  const [, , , , e, f] = matrix;
  const pxr = globalThis.devicePixelRatio || 1; // uPlot's own pxRatio
  const turnedKey = (key: string): boolean => u.scales[key]?.ori === 1;
  // View position from the plot's own: canvas pixels flip about e/f; CSS
  // (plot-area) pixels about the plot area's turned size.
  const toView = (pos: number, key: string, canvas?: boolean): number => {
    if (canvas) return (turnedKey(key) ? f : e) - pos;
    return (turnedKey(key) ? u.bbox.height : u.bbox.width) / pxr - pos;
  };
  const ctx = uprightContext(u.ctx, matrix);
  return new Proxy(u, {
    get(target, prop, receiver) {
      if (prop === "bbox") return bbox;
      if (prop === "ctx") return ctx;
      if (prop === "valToPos") {
        return (v: number, key: string, canvas?: boolean) => toView(target.valToPos(v, key, canvas), key, canvas);
      }
      if (prop === "posToVal") {
        return (p: number, key: string, canvas?: boolean) => target.posToVal(toView(p, key, canvas), key, canvas);
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

// The view's "right" is up on the canvas and its "up" is right: arrows in a
// label turn with it, and so does the side the label sits on (view
// alignment -> canvas baseline, view baseline -> canvas alignment).
const TURNED_ARROW: Record<string, string> = { "▸": "▴", "◂": "▾", "▴": "▸", "▾": "◂" };
const BASELINE_FOR_ALIGN: Record<string, CanvasTextBaseline> = {
  left: "bottom", start: "bottom", right: "top", end: "top", center: "middle",
};
const ALIGN_FOR_BASELINE: Record<string, CanvasTextAlign> = {
  top: "right", hanging: "right", middle: "center",
  bottom: "left", alphabetic: "left", ideographic: "left",
};

/** `ctx` with the view transform applied and text kept upright: a label is
 *  placed where the view puts its anchor, then drawn unturned there, on the
 *  side of the anchor the view meant. */
function uprightContext(
  ctx: CanvasRenderingContext2D,
  [a, b, c, d, e, f]: [number, number, number, number, number, number],
): CanvasRenderingContext2D {
  const at = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];
  const text = (draw: "fillText" | "strokeText") =>
    (s: string, x: number, y: number, maxWidth?: number): void => {
      const [cx, cy] = at(x, y);
      const label = s.replace(/[▸◂▴▾]/g, (ch) => TURNED_ARROW[ch]);
      const align = ALIGN_FOR_BASELINE[ctx.textBaseline] ?? "left";
      const baseline = BASELINE_FOR_ALIGN[ctx.textAlign] ?? "bottom";
      ctx.save();
      ctx.transform(a, b, c, d, f, e); // the view turn's inverse: back to plain canvas pixels
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      if (maxWidth === undefined) ctx[draw](label, cx, cy);
      else ctx[draw](label, cx, cy, maxWidth);
      ctx.restore();
    };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === "fillText") return text("fillText");
      if (prop === "strokeText") return text("strokeText");
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
}

/** `plugins` with their draw hooks given the upright view of a turned plot
 *  (module notes); unchanged on an upright plot. */
export function orientPlugins(
  plugins: uPlot.Plugin[],
  styles: readonly (SeriesStyle | undefined)[] | undefined,
): uPlot.Plugin[] {
  if (!hasHorizontalBars(styles)) return plugins;
  return plugins.map((plugin) => {
    const hooks: Record<string, unknown> = {};
    for (const [name, hook] of Object.entries(plugin.hooks)) {
      if (!DRAW_HOOKS.has(name) || typeof hook !== "function") {
        hooks[name] = hook;
        continue;
      }
      const draw = hook as (u: uPlot, ...rest: unknown[]) => void;
      hooks[name] = (u: uPlot, ...rest: unknown[]) => {
        if (!isTurned(u)) return draw(u, ...rest);
        const [ma, mb, mc, md, me, mf] = turnedFrame(u).matrix;
        u.ctx.save();
        u.ctx.transform(ma, mb, mc, md, me, mf);
        try {
          draw(uprightView(u), ...rest);
        } finally {
          u.ctx.restore();
        }
      };
    }
    return { ...plugin, hooks: hooks as uPlot.Plugin["hooks"] };
  });
}
