// The CATEGORY axis for the Canvas2D statistical stage: the tick labels under
// each box/violin/strip slot, plus the label-fitting rule they share.
//
// Split out of `statRender.ts` when Group R's nested-label fix pushed that file
// past its line pin. It is a genuine unit rather than a convenient offcut: the
// truncation budget and the nested-label split are one decision about how much
// of a category's name can reach the screen, and this is the only painter that
// makes it.

import { NESTED_LABEL_SEP } from "../../lib/statschooser";
import type { Rect } from "./statRender";

function truncateLabel(s: string, max = 14): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function drawCategoryAxis(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  slots: { cx: number }[],
  labels: string[],
  caption: string,
  ink: string,
  muted: string,
) {
  ctx.font = "10px 'JetBrains Mono', monospace";
  ctx.fillStyle = muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // NESTED labels (Group R) are stacked on two lines rather than truncated to
  // one. Review finding 1: `truncateLabel`'s 14-character budget cut
  // `lot = 0 / wafer = 0` down to `lot = 0 / waf…`, so all four boxes of a
  // two-lot/two-wafer plot painted just two distinct ticks and the second
  // factor — the entire point of nesting — never reached the screen. The
  // distinguishing half is at the END of the string, exactly where a
  // single-line truncation lands.
  //
  // Each half is truncated on its own, so a long column name eats only its own
  // line. The caption sits at +30 and a second 10px line ends near +27, so
  // this fits the space the axis already reserves.
  slots.forEach((s, i) => {
    const sx = rect.x + s.cx * rect.w;
    const label = labels[i] ?? "";
    const cut = label.indexOf(NESTED_LABEL_SEP);
    const lines = cut < 0 ? [label] : [label.slice(0, cut), label.slice(cut + NESTED_LABEL_SEP.length)];
    lines.forEach((line, li) => {
      ctx.fillText(truncateLabel(line), sx, rect.y + rect.h + 6 + li * 11);
    });
  });
  ctx.fillStyle = ink;
  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.fillText(caption, rect.x + rect.w / 2, rect.y + rect.h + 30);
}
