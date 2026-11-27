// Text symbols (plan item 24, Origin's Plot Details > Symbol > Unicode): a
// series draws each point as a short string ("A", "Fe", "*") in its colour
// instead of a glyph. Lazy with the other marks (`marksImpl`). The export
// counterpart is `calc/figure_text_symbols.py`; both follow these rules, pinned
// by `tests/fixtures/wire/plot_details.json`:
//
// * the string is 1-3 characters (`symbolSanitize.validText`), the size 4-72 pt
//   (default `TEXT_SYMBOL_PT`), centred on the point;
// * the rows are the series' DRAWN points (finite x and y) in row order, every
//   `markerEvery`-th one, at most `TEXT_SYMBOL_MAX` of them (a longer series
//   keeps its first rows: one `fillText` per point, and 50,000 letters are not
//   a figure anyone reads).

import type uPlot from "uplot";

import type { SeriesStyle } from "./seriesStyleTypes";
import { validEvery, validText, validTextSize } from "./symbolSanitize";
import { seriesStrokeColor } from "./uplotDropLines";

export const TEXT_SYMBOL_PT = 10;
export const TEXT_SYMBOL_MAX = 5000;

/** The indices of the points that carry the text. */
export function textSymbolRows(
  xs: readonly (number | null | undefined)[],
  ys: readonly (number | null | undefined)[],
  every?: number,
): number[] {
  const n = validEvery(every) ? every : 1;
  const out: number[] = [];
  for (let i = 0, k = 0; i < ys.length && out.length < TEXT_SYMBOL_MAX; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (k++ % n === 0) out.push(i);
  }
  return out;
}

interface TextSpec {
  text: string;
  pt: number;
  every?: number;
  /** Per-row texts (`lib/markerTextRows.ts`, derived `markerTexts`): they replace `text`; a blank row draws none. */
  texts?: readonly (string | null)[];
}

/** A series' text symbol, or null (none, or a value the export would refuse). */
export function textSymbolSpec(style: (SeriesStyle & { markerTexts?: readonly (string | null)[] }) | undefined): TextSpec | null {
  const texts = style?.markerTexts;
  if (!style || (!texts && !validText(style.markerText)) || style.bars) return null;
  return { text: style.markerText ?? "", texts, pt: validTextSize(style.markerTextSize) ? style.markerTextSize : TEXT_SYMBOL_PT, every: style.markerEvery };
}

/** One plugin drawing every series' text (`styles[i]` is uPlot column i + 1). */
export function textSymbolPlugins(styles: readonly (SeriesStyle | undefined)[] | undefined): uPlot.Plugin[] {
  const specs = new Map<number, TextSpec>();
  styles?.forEach((st, i) => {
    const spec = textSymbolSpec(st);
    if (spec) specs.set(i + 1, spec);
  });
  if (!specs.size) return [];
  return [{
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const k = window.devicePixelRatio || 1;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const [col, spec] of specs) {
          const ys = u.data[col];
          if (!ys || u.series[col]?.show === false) continue;
          const scaleKey = u.series[col]?.scale ?? "y";
          ctx.fillStyle = seriesStrokeColor(u, col);
          ctx.font = `${((spec.pt * 96) / 72) * k}px sans-serif`; // pt -> css px, as the tick labels
          for (const i of textSymbolRows(u.data[0] as readonly (number | null | undefined)[], ys as readonly (number | null | undefined)[], spec.every)) {
            const t = spec.texts ? spec.texts[i] : spec.text;
            if (!t) continue;
            // Not clipped at the plot edge (the SVG draws an edge point's text whole): a point is drawn when
            // its centre is inside the plot area, so a zoomed-out point never paints over the axes.
            const px = u.valToPos(u.data[0][i] as number, "x", true);
            const py = u.valToPos(ys[i] as number, scaleKey, true);
            if (px >= left - 0.5 && px <= left + width + 0.5 && py >= top - 0.5 && py <= top + height + 0.5) ctx.fillText(t, px, py);
          }
        }
        ctx.restore();
      },
    },
  }];
}
