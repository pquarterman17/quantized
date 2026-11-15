// Worksheet toolbar overflow (worksheet audit follow-up): with a cell cursor
// active, `useGridCursor`'s own block-ops (copy/cut/paste/fill/clear) stand in
// for the row x column selection's (MAIN_PLAN #34), so those five extra
// buttons — plus row ops, the masked-rows button, and the row/column
// selection clusters when any of those are also live — routinely pushed the
// bar past one line at common window widths. Reuses PlotToolbar's own
// algorithm (`fitToolGroups`, ./plotToolbarOverflow) rather than a second
// implementation: fit as many LEADING groups as the bar is wide, collapse the
// rest (least-common-first, by construction of the `groups` array order)
// into the "⋯" menu. Tuned for this inline, flex-wrap bar rather than
// PlotToolbar's floating dock: no side margin, no inter-group separator
// element (the flex `gap` already spaces them) — chrome is just the "⋯"
// button's own width plus that gap.

import { useLayoutEffect, useState, type RefObject } from "react";

import { fitToolGroups } from "../plotToolbarOverflow";

export function useWorksheetToolbarFit(barRef: RefObject<HTMLDivElement | null>, total: number, watch: unknown): number {
  const [visible, setVisible] = useState(total);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      const avail = bar.clientWidth;
      if (avail <= 0) {
        setVisible(total); // unmeasured (jsdom, a hidden tab): never hide on a guess
        return;
      }
      const groups = Array.from(bar.querySelectorAll<HTMLElement>(":scope > [data-tool-group]"));
      const optsEl = bar.querySelector<HTMLElement>(":scope > [data-tool-opts]");
      const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
      const chrome = { pad: 0, sep: 0, gap, opts: optsEl?.offsetWidth ?? 0 };
      setVisible(fitToolGroups(avail, groups.map((g) => g.offsetWidth), chrome));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [barRef, total, watch]);

  return visible;
}
