// The eager seams for two uPlot plugin families that only some plots need,
// loaded ON DEMAND so a plain plot never pays for them in the eager bundle
// (MAIN_PLAN #29):
//   - `lib/axisExtras.ts` -- the Axis dialog's canvas extras (figures-audit
//     #6): needed only once some axis carries an extra;
//   - `lib/uplotGadgets.ts` -- the quick-fit / cursors ROI gadget frame
//     (#33/#34): needed only while the "qfit" tool is active. Moved behind
//     this seam to fund #6's eager bytes; the tool's first activation in a
//     session waits for one chunk, after which it is instant.
//   - `lib/uplotToolPlugins.ts` -- the tool-dock plugins (pan, cursor
//     readout, measure, region statistics, integrate, FWHM): needed only
//     while one of those tools is picked, or while an integral / FWHM result
//     it made is still drawn. Moved behind this seam in bundle diet slice 27
//     (plans/BUNDLE_HEADROOM.md). Unlike the two above it is also WARMED: the
//     plot toolbar starts the load once it has mounted, so a first tool pick
//     after first paint builds with the plugin already there.
// `uplotOpts.buildOpts` reads each module through these getters and simply
// skips it while still null; the main plot viewport loads whatever its
// current args need (`components/Stage/useLazyPlotParts.ts`) and rebuilds
// once it resolves.

import { hasAxisExtras, type AxisFormat } from "./axisFormat";

type ExtrasModule = typeof import("./axisExtras");
type GadgetsModule = typeof import("./uplotGadgets");
type ToolsModule = typeof import("./uplotToolPlugins");

let extras: ExtrasModule | null = null;
let gadgets: GadgetsModule | null = null;
let extrasLoading: Promise<void> | null = null;
let gadgetsLoading: Promise<void> | null = null;
let tools: ToolsModule | null = null;
let toolsLoading: Promise<void> | null = null;

/** The loaded axis-extras applier, or null before it has loaded. */
export function axisExtrasApplier(): ExtrasModule["applyAxisExtras"] | null {
  return extras?.applyAxisExtras ?? null;
}

/** The loaded gadget plugins, or null before they have loaded. */
export function gadgetPlugins(): GadgetsModule | null {
  return gadgets;
}

/** Load the axis-extras module once (idempotent; a failed load may retry). */
export function loadAxisExtras(): Promise<void> {
  extrasLoading ??= import("./axisExtras").then(
    (m) => {
      extras = m;
    },
    (e: unknown) => {
      extrasLoading = null;
      throw e;
    },
  );
  return extrasLoading;
}

/** Load the gadget plugins once (idempotent; a failed load may retry). */
export function loadGadgetPlugins(): Promise<void> {
  gadgetsLoading ??= import("./uplotGadgets").then(
    (m) => {
      gadgets = m;
    },
    (e: unknown) => {
      gadgetsLoading = null;
      throw e;
    },
  );
  return gadgetsLoading;
}

/** The loaded tool-dock plugins, or null before they have loaded. */
export function toolPlugins(): ToolsModule | null {
  return tools;
}

/** Load the tool-dock plugins once (idempotent; a failed load may retry). */
export function loadToolPlugins(): Promise<void> {
  toolsLoading ??= import("./uplotToolPlugins").then(
    (m) => {
      tools = m;
    },
    (e: unknown) => {
      toolsLoading = null;
      throw e;
    },
  );
  return toolsLoading;
}

/** The tools whose plugin is in `lib/uplotToolPlugins.ts`. */
const PLUGIN_TOOLS: ReadonlySet<string> = new Set(["pan", "cursor", "measure", "stats", "integ", "fwhm"]);

/** Whether a plot with this tool (and an integral / FWHM result to draw, or
 *  not) needs the tool-dock plugins. */
export function needsToolPlugins(tool: string, regionResult = false): boolean {
  return regionResult || PLUGIN_TOOLS.has(tool);
}

/** Whether any of these formats needs the extras drawn. */
export function needsAxisExtras(...fmts: readonly (AxisFormat | null | undefined)[]): boolean {
  return fmts.some(hasAxisExtras);
}
