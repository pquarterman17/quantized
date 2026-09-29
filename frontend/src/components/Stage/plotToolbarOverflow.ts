// Plot-toolbar overflow (GUI audit P1): the dock is ~850px wide with its group
// captions on, so at 125% OS scaling, in a default-size Graph Window, or in a
// narrow app window its outer groups used to sit past the stage edge, where
// up to 15 of 23 buttons could not be clicked. Now the trailing groups that do
// not fit collapse, right to left, into the dock's "⋯" menu; Navigate always
// stays. Every tool therefore stays one or two clicks away, and the dock keeps
// a fixed height, so the legend and mini-toolbar offsets below it hold.
//
// A collapsed group stays mounted (absolutely positioned, `visibility:
// hidden`, aria-hidden: see `.qzk-tool-group[data-overflow]` in shell.css), so
// its natural width can still be measured when deciding whether it fits back.

import { useLayoutEffect, useState, type RefObject } from "react";

/** Width of the dock's non-group chrome, all in CSS px. */
export interface DockChrome {
  /** padding + border of the dock itself, both sides */
  pad: number;
  /** one separator's outer width (incl. its margins) */
  sep: number;
  /** the flex gap between adjacent dock items */
  gap: number;
  /** the trailing "⋯" button */
  opts: number;
}

/** How many leading groups fit in `avail` px, never fewer than one. With k
 *  groups showing the dock holds k groups, k separators (one after each
 *  group, the last one before "⋯") and the "⋯" button: 2k + 1 flex items. */
export function fitToolGroups(avail: number, groupWidths: readonly number[], c: DockChrome): number {
  let used = c.pad + c.opts;
  let k = 0;
  for (const w of groupWidths) {
    const next = used + w + c.sep + 2 * c.gap;
    if (next > avail && k > 0) break;
    used = next;
    k++;
  }
  return Math.max(1, k);
}

/** The stage-side margin the dock keeps on each side (its `top: 12px`
 *  twin; see `.qzk-float-tools`). */
const SIDE_MARGIN = 12;

function px(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Measure the dock and return how many groups to show. Returns `total` when
 *  the stage has no layout (jsdom, a hidden tab), so nothing is ever hidden
 *  on a guess. `labelsKey` re-measures when the captions change group widths. */
export function useToolGroupFit(barRef: RefObject<HTMLDivElement | null>, total: number, labelsKey: boolean): number {
  const [visible, setVisible] = useState(total);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const host = bar?.parentElement;
    if (!bar || !host) return;
    const measure = () => {
      const avail = host.clientWidth - 2 * SIDE_MARGIN;
      if (host.clientWidth <= 0) {
        setVisible(total);
        return;
      }
      const groups = Array.from(bar.querySelectorAll<HTMLElement>(":scope > [data-tool-group]"));
      const sepEl = bar.querySelector<HTMLElement>(":scope > [data-tool-sep='opts']");
      const optsEl = bar.querySelector<HTMLElement>(":scope > [data-tool-opts]");
      const cs = getComputedStyle(bar);
      const sepCs = sepEl ? getComputedStyle(sepEl) : null;
      const chrome: DockChrome = {
        pad: px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth),
        sep: sepEl && sepCs ? sepEl.offsetWidth + px(sepCs.marginLeft) + px(sepCs.marginRight) : 0,
        gap: px(cs.columnGap),
        opts: optsEl?.offsetWidth ?? 0,
      };
      setVisible(fitToolGroups(avail, groups.map((g) => g.offsetWidth), chrome));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [barRef, total, labelsKey]);

  return visible;
}
