// The plot right-click curve entries "Change Y ▸ / Change X ▸ / Change
// Worksheet ▸" and "Hide others / Show all" (Origin gap plan item 38). Built
// from the open-time store snapshot like the rest of the menu; the writes are
// loaded on demand (store/curveRebindApply.ts) when an entry is picked.

import type { ContextMenuItem } from "../overlays/contextMenuTypes";
import {
  columnChoices,
  curveBindingAt,
  rebindBlocker,
  worksheetCandidates,
  type CurveBindingRef,
  type RebindState,
} from "../../lib/curveRebind";
import { is2DMap } from "../../lib/mapdata";
import { onLoadFailure, runLazy } from "../../lib/runLazy";

type Apply = typeof import("../../store/curveRebindApply");

const withApply = (run: (m: Apply) => void) => () =>
  void runLazy("Loading curve editing…", () => import("../../store/curveRebindApply")).then(run, onLoadFailure);

/** The entries for the curve at display channel `channel`; `plotted` is every
 *  channel of the layer (hidden ones included). Empty when the curve has no
 *  editable binding of its own. */
export function curveRebindItems(s: RebindState, channel: number, plotted: readonly number[]): ContextMenuItem[] {
  const out: ContextMenuItem[] = [];
  const cur = curveBindingAt(s, channel);
  const source = cur && s.datasets.find((d) => d.id === cur.datasetId);
  if (cur && source && !source.pending && !is2DMap(source.data)) {
    const blocked = rebindBlocker(s) ?? undefined;
    const to = (b: Partial<CurveBindingRef>): CurveBindingRef => ({ ...cur, ...b });
    const go = (b: CurveBindingRef) => withApply((m) => void m.rebindCurve(channel, cur, b));
    const cols = columnChoices(source);
    const pick = (label: string, submenu: ContextMenuItem[]): ContextMenuItem => ({ label, submenu, disabled: !!blocked, title: blocked });
    out.push(
      pick("Change Y", cols.map((c) => ({ label: c.label, checked: c.col === cur.yKey, run: go(to({ yKey: c.col })) }))),
      pick("Change X", [
        { label: "Its own X", checked: cur.xKey === null, run: go(to({ xKey: null })) },
        ...cols.map((c) => ({ label: c.label, checked: c.col === cur.xKey, run: go(to({ xKey: c.col })) })),
      ]),
    );
    const sheets = worksheetCandidates(s, cur);
    const sheetItem = (c: (typeof sheets)[number]): ContextMenuItem => {
      const why = "ambiguous" in c.resolution ? c.resolution.ambiguous : undefined;
      const short = "by" in c.resolution && c.resolution.by === "short";
      return {
        label: why ? `${c.sheet.name} (ambiguous)` : short ? `${c.sheet.name} (by short name)` : c.sheet.name,
        disabled: !!why,
        title: why ?? (short ? "Matched on the columns' short names (A, B, ...), not their long names" : undefined),
        run: withApply((m) => void m.changeCurveWorksheet(channel, cur, c.sheet.id)),
      };
    };
    const books = [...new Set(sheets.map((c) => c.book))];
    const sheetItems: ContextMenuItem[] =
      books.length > 1
        ? books.map((b) => ({ label: b || "Other sheets", submenu: sheets.filter((c) => c.book === b).map(sheetItem) }))
        : sheets.map(sheetItem);
    out.push(
      sheets.length === 0
        ? { label: "Change Worksheet", submenu: [], disabled: true, title: "No other sheet has columns named like this curve's" }
        : pick("Change Worksheet", sheetItems),
    );
  }
  if (plotted.length > 1) {
    const hidden = (c: number) => s.hiddenChannels.includes(c);
    const noOther = plotted.every((c) => c === channel || hidden(c));
    out.push({ label: "Hide others", disabled: noOther, title: noOther ? "No other visible curve." : undefined, run: withApply((m) => m.hideOtherCurves(channel, plotted)) });
    if (plotted.some(hidden)) out.push({ label: "Show all", run: withApply((m) => m.showAllCurves(plotted)) });
  }
  return out;
}
