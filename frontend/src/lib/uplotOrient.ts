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
//
// Bundle diet slice 27 (plans/BUNDLE_HEADROOM.md): the overlay half -- the
// upright view, its canvas context and the draw-hook wrapper -- moved
// verbatim to lib/uplotTurn.ts, a LAZY chunk that every session starts
// loading when this module loads (app startup), the `lib/regionDecorLoader.ts`
// shape. `orientPlugins` hands the plugins back unchanged until it lands; a
// turned plot built before then (its axes and bars already turned: those
// stay here) rebuilds once it settles (Stage/useLazyPlotParts.ts).
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

type TurnModule = typeof import("./uplotTurn");

let turn: TurnModule | null = null;
let turnSettled = false;
/** Settles once the overlay half has loaded -- or failed to (offline: the
 *  overlays of a turned plot draw upright, never a crash). */
export const orientTurnSettled: Promise<void> = import("./uplotTurn")
  .then(
    (m) => {
      turn = m;
    },
    () => {},
  )
  .then(() => {
    turnSettled = true;
  });
export const orientTurnReady = (): boolean => turnSettled;

/** `plugins` with their draw hooks given the upright view of a turned plot
 *  (module notes); unchanged on an upright plot, and until the overlay half
 *  (lib/uplotTurn.ts) has loaded. */
export function orientPlugins(
  plugins: uPlot.Plugin[],
  styles: readonly (SeriesStyle | undefined)[] | undefined,
): uPlot.Plugin[] {
  if (!hasHorizontalBars(styles) || !turn) return plugins;
  return turn.turnPlugins(plugins);
}
