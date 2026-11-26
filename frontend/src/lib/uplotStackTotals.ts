// Total labels on a stack (plan item 24, Origin's Layer > Stack "show total"):
// a series flagged `stackTotal` that is also `stack` labels the running total
// at its top edge (the stack's sum up to and including it) at every row where
// it has a value, above the edge for a positive total and below it for a
// negative one. Put it on the TOP series of a stack to total the stack. Lazy
// with the other marks (`marksImpl`); the export is `calc/figure_stack_totals.py`
// and both follow the label rule below, pinned by `tests/fixtures/wire/plot_details.json`.
//
// * the label is the total to 6 significant figures, trailing zeros dropped;
// * 9 pt text, centred, 3 pt clear of the edge;
// * a horizontal-bar plot draws none (the export warns).

import type uPlot from "uplot";

import type { SeriesStyle } from "./seriesStyleTypes";
import { seriesStrokeColor } from "./uplotDropLines";

export const STACK_TOTAL_PT = 9;
export const STACK_TOTAL_GAP_PT = 3;

type Col = readonly (number | null | undefined)[];
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** The label for a total. */
export const stackTotalLabel = (v: number): string => String(Number(v.toPrecision(6)));

/** One label: the row, the total and its text. */
export interface StackTotal { row: number; total: number; text: string }

/** The totals a flagged series labels: one per row where it has a value. `below` are the uPlot data
 *  columns of the stacked series under it (`uplotStack.stackedBelow`). Pure, for the export parity test. */
export function stackTotals(xs: Col, data: readonly Col[], col: number, below: readonly number[]): StackTotal[] {
  const out: StackTotal[] = [];
  for (let r = 0; r < xs.length; r++) {
    const y = data[col]?.[r];
    if (!fin(xs[r]) || !fin(y)) continue;
    let total = y;
    for (const c of below) {
      const v = data[c]?.[r];
      if (fin(v)) total += v;
    }
    out.push({ row: r, total, text: stackTotalLabel(total) });
  }
  return out;
}

/** The same-axis stacked columns under display series `i` (`uplotStack.stackedBelow`, by scale key). */
function below(styles: readonly (SeriesStyle | undefined)[], u: uPlot, i: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < i; j++) if (styles[j]?.stack && (u.series[j + 1]?.scale ?? "y") === (u.series[i + 1]?.scale ?? "y")) out.push(j + 1);
  return out;
}

export function stackTotalPlugins(styles: readonly (SeriesStyle | undefined)[] | undefined): uPlot.Plugin[] {
  if (!styles?.some((s) => s?.stack && s.stackTotal && s.bars !== "horizontal")) return [];
  return [{
    hooks: {
      draw: (u: uPlot) => {
        const { ctx } = u;
        const { left, top, width, height } = u.bbox;
        const k = window.devicePixelRatio || 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, width, height);
        ctx.clip();
        ctx.textAlign = "center";
        ctx.font = `${((STACK_TOTAL_PT * 96) / 72) * k}px sans-serif`;
        styles.forEach((st, i) => {
          if (!st?.stack || !st.stackTotal || st.bars === "horizontal" || u.series[i + 1]?.show === false) return;
          const key = u.series[i + 1]?.scale ?? "y";
          ctx.fillStyle = seriesStrokeColor(u, i + 1);
          for (const t of stackTotals(u.data[0] as Col, u.data as unknown as Col[], i + 1, below(styles, u, i))) {
            ctx.textBaseline = t.total < 0 ? "top" : "bottom";
            const gap = ((STACK_TOTAL_GAP_PT * 96) / 72) * k * (t.total < 0 ? 1 : -1);
            ctx.fillText(t.text, u.valToPos(u.data[0][t.row] as number, "x", true), u.valToPos(t.total, key, true) + gap);
          }
        });
        ctx.restore();
      },
    },
  }];
}
