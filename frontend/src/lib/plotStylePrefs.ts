// Plot-style defaults (PREFS_AUDIT lane 2, P1-5/P1-6): the values a NEW plot
// starts from, kept in one `qz.plotStylePrefs` slot (lib/prefSlots.ts).
//
// Every default below equals today's hardcoded behaviour (fail closed), so a
// user who never opens Preferences sees byte-identical figures. All defaults
// are PROVISIONAL, owner to confirm.
//
//   markerSize     5 px     lib/markers.ts DEFAULT_MARKER_PX (canvas AND export:
//                           the export sends the same number as `marker_size`)
//   fontSize       12 px    the Screen template's tick-label size (other
//                           templates keep their own); export gets it as a
//                           `font_size` override only when it differs from 12
//   tickDirection  "auto"   outward on screen, the style preset's direction in
//                           an export; any other value rides `xFmt/yFmt.ticks`,
//                           which the canvas (axisExtras) and the export
//                           (`x_fmt.ticks`) both read
//   legendPos      "auto"   `PlotView.legendPos`; exported via legend.loc
//
// This module is EAGER (plotview.ts / markers.ts read it) and the eager bundle
// has no headroom: it holds ONLY the live values (`fontSize` is the Screen
// template's own entry in lib/plotTemplates.ts, updated in place). The slot, the parse and the
// ranges live in lib/plotStylePrefsSlot.ts, a lazy module main.tsx loads at
// start-up (and Preferences), which fills `plotStyle` from `qz.plotStylePrefs`
// and keeps it current (`grid` follows the store's `defaultGrid`).

import type { AxisFormat } from "./axisFormat";
import type { LegendPos } from "./plotview";

export type TickDirection = "auto" | "in" | "out" | "both";

/** The values a new plot starts from. Provisional, owner to confirm: every
 *  initial value is today's hardcoded behaviour. `fmt` is the new plot's axis
 *  tick-label format ({auto, 2}, plus `ticks` once a direction is set). */
export const plotStyle = { markerSize: 5, legend: "auto" as LegendPos, grid: true, fmt: { mode: "auto", digits: 2 } as AxisFormat };
