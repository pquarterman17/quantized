// The `qz.plotStylePrefs` slot (use / save / reset), its parse and the pane's
// ranges. LAZY: main.tsx imports it at start-up and Preferences imports it.
// Loading it fills the eager `plotStyle` values (lib/plotStylePrefs.ts) from
// storage, and every later write (the dialog, a reset, the server prefs file)
// keeps them current.

import { definePrefSlot, onPrefSlotChange } from "./prefSlots";
import { plotStyle, type TickDirection } from "./plotStylePrefs";
import { PLOT_TEMPLATES } from "./plotTemplates";
import { useApp } from "../store/useApp";
import type { LegendPos } from "./plotview";
import { reseedPlotViewDefaults } from "./plotStylePrefsReseed";

export interface PlotStylePrefs {
  markerSize: number;
  fontSize: number;
  tickDirection: TickDirection;
  legendPos: LegendPos;
}

/** Provisional, owner to confirm: every default is today's hardcoded value. */
export const PLOT_STYLE_DEFAULTS: PlotStylePrefs = { markerSize: 5, fontSize: 12, tickDirection: "auto", legendPos: "auto" };
export const MARKER_SIZE_RANGE = [2, 16] as const; // uPlot cannot draw a marker under 2 px
export const FONT_SIZE_RANGE = [8, 24] as const;
export const TICK_DIRECTIONS: readonly TickDirection[] = ["auto", "out", "in", "both"];
export const LEGEND_POSITIONS: readonly LegendPos[] = ["auto", "ne", "nw", "se", "sw"];

const clamp = (v: unknown, d: number, [lo, hi]: readonly [number, number]): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** A stored value to prefs: ranges clamped, anything unknown the default. */
export function parsePlotStyle(r: Record<string, unknown>): PlotStylePrefs {
  const d = PLOT_STYLE_DEFAULTS;
  return {
    markerSize: clamp(r.markerSize, d.markerSize, MARKER_SIZE_RANGE),
    fontSize: clamp(r.fontSize, d.fontSize, FONT_SIZE_RANGE),
    tickDirection: TICK_DIRECTIONS.includes(r.tickDirection as TickDirection) ? (r.tickDirection as TickDirection) : d.tickDirection,
    legendPos: LEGEND_POSITIONS.includes(r.legendPos as LegendPos) ? (r.legendPos as LegendPos) : d.legendPos,
  };
}

export const plotStylePrefsSlot = definePrefSlot("qz.plotStylePrefs", PLOT_STYLE_DEFAULTS, parsePlotStyle);

function apply(): void {
  const p = plotStylePrefsSlot.load();
  plotStyle.markerSize = p.markerSize;
  plotStyle.legend = p.legendPos;
  plotStyle.fmt = { mode: "auto", digits: 2, ...(p.tickDirection === "auto" ? {} : { ticks: p.tickDirection }) };
  PLOT_TEMPLATES[0].fontSize = p.fontSize; // the Screen template's tick-label px (every reader resolves it through resolveTemplate)
}

const nonDefault = (): boolean => {
  const p = plotStylePrefsSlot.load();
  return p.legendPos !== "auto" || p.tickDirection !== "auto";
};

// Start-up: fill the eager values, follow the store's Grid lines default, and
// let a non-default value reach the first (blank) plot's view too.
apply();
plotStyle.grid = useApp.getState().defaultGrid;
useApp.subscribe((s) => {
  plotStyle.grid = s.defaultGrid;
});
if (nonDefault() || !plotStyle.grid) reseedPlotViewDefaults();
onPrefSlotChange((k) => k === "qz.plotStylePrefs" && apply());
