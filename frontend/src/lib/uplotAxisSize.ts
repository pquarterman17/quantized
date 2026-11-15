// The measured Y tick-label band, moved verbatim out of `lib/uplotOpts.ts`
// (its line pin) when the Y3+ axes (gap audit 4 G11) needed room there. Every
// Y axis -- Y1, Y2 and each Y3+ -- sizes its tick band with it.

import type uPlot from "uplot";

/** Y-axis tick-value band: MEASURE the widest formatted tick label rather than
 *  assuming ~4 chars, so many-digit labels (common in Origin imports, e.g.
 *  "0.000012" or "-1234.5") don't overflow the band and overlap the axis
 *  title. uPlot calls this during layout with the drawn tick strings; we
 *  reserve their width + a generous gap, floored at the prior fixed width so a
 *  small template never shrinks below what already rendered fine. */
export function measuredYAxisSize(tickPx: number, canvasFont: string, pxr: number): uPlot.Axis["size"] {
  const yGutterFloor = Math.max(60, tickPx * 4 + 16);
  const yTickPad = tickPx + 12; // tick marks + label gap + breathing room
  return (self, values) => {
    if (!values || values.length === 0) return yGutterFloor;
    const ctx = self.ctx;
    const prevFont = ctx.font;
    ctx.font = canvasFont;
    let maxW = 0;
    for (const v of values) {
      // Log minor splits deliberately format to null/blank. They draw grid
      // and tick marks, but must not reserve gutter width for the string
      // coercion of `null`.
      if (v == null || v === "") continue;
      maxW = Math.max(maxW, ctx.measureText(v).width);
    }
    ctx.font = prevFont;
    return Math.max(yGutterFloor, Math.ceil(maxW / pxr + yTickPad));
  };
}
