// Plot > "Exchange X-Y axes" (Origin's command of the same name): the graph
// turns on its side -- X up the left, Y along the bottom -- with every axis
// keeping its own title, units, scale, limits, direction and tick format. The
// toggle is `PlotView.exchangeXY`; the screen turns the layer through uPlot's
// scale orientation (lib/uplotOrient.ts, shared with horizontal bars) and the
// export through calc/figure_orient.py (`overrides.exchange_xy`).
//
// Only the flat X-Y plot can be exchanged. Maps, polar and statistics plots,
// stacked / faceted / broken layouts, the magnifier inset, Y / Y2 axis breaks,
// a top X axis, Y3+ axes and horizontal bars (already turned) have their own
// renderers or do not turn, so the pair is REFUSED both ways: the command is
// disabled with the reason when one is present, and while exchanged each is
// refused (`installExchangeGuard`, below). The server refuses the same combinations with
// a 422 (`calc.figure_orient.validate_exchange`). The shared table is
// tests/fixtures/wire/exchange_xy.json (`conflicts`).
//
// The LIVE half -- `installExchangeGuard`, below -- keeps the pair "exchanged X-Y"
// + "something the turn cannot draw" from ever standing in the live view (one
// store subscription, installed by the Plot menu command once this lazy module
// loads). Everything else is pure: the .dwk loader reads it too (in a worker).

import type { useApp } from "../store/useApp";
import type { AxisDraft } from "./axisDialogModel";
import type { AxisFormat, SeriesStyle } from "./types";

export interface ExchangeState {
  exchangeXY: boolean;
  stageTab: string;
  polarMode: boolean;
  statMode: boolean;
  stackMode: boolean;
  insetMode: boolean;
  facetKey: number | null;
  composition: unknown;
  xFmt?: AxisFormat;
  yFmt: AxisFormat;
  y2Fmt: AxisFormat | null;
  yAxes?: readonly unknown[];
  seriesStyles?: Readonly<Record<number, SeriesStyle | undefined>>;
}

/** What the view holds that the turn cannot draw (a phrase), or "". The
 *  four a user can ADD while exchanged (`ADDED`) are refused by the guard; a
 *  mode switch clears the exchange instead. */
export function exchangeConflict(s: ExchangeState): string {
  return s.stageTab === "map" ? "maps"
    : s.polarMode ? "polar plots"
    : s.statMode ? "statistics plots"
    : s.stackMode || s.facetKey != null || s.composition ? "multi-panel layouts"
    : Object.values(s.seriesStyles ?? {}).some((v) => v?.bars === "horizontal") ? "horizontal bars (already turned)"
    : s.yFmt.breaks?.length || s.y2Fmt?.breaks?.length ? "broken axes"
    : s.xFmt?.top ? "a top X axis"
    : s.yAxes?.length ? "Y3+ axes"
    : s.insetMode ? "insets"
    : "";
}

/** Why the view cannot be exchanged (the disabled reason), or undefined when it
 *  can. An already exchanged view can always be turned back. */
export function exchangeBlocker(s: ExchangeState): string | undefined {
  const what = s.exchangeXY ? "" : exchangeConflict(s);
  return what ? `Not available for ${what}` : undefined;
}

/** The Axis dialog's draft would add a break or a top axis to an exchanged
 *  view: the error to show (and Apply refuses), or "". */
export function exchangeAxisClash(on: boolean, axis: string, d: Pick<AxisDraft, "breakFrom" | "breakTo" | "topKind">): string {
  const adds = axis === "x" ? d.topKind !== "none" : d.breakFrom.trim() !== "" || d.breakTo.trim() !== "";
  return on && adds ? "A break or a top axis can't be set while X and Y are exchanged (Plot ▸ Exchange X–Y axes)." : "";
}

/** A LOADED view (or figure document's view) holding an exchange of X and Y
 *  beside something the turn cannot draw loses the exchange: the rest of the view
 *  is what the user built, and the pair is refused everywhere else. `facetKey`
 *  is the document's binding, which its view state does not carry. */
export function dropStaleExchange<V extends { exchangeXY: boolean }>(v: V, facetKey: number | null = null): V {
  const s = { composition: null, stageTab: "plot", ...v, facetKey: (v as { facetKey?: number | null }).facetKey ?? facetKey } as unknown as ExchangeState;
  return v.exchangeXY && exchangeConflict(s) ? { ...v, exchangeXY: false } : v;
}

type Store = typeof useApp;
type State = ReturnType<Store["getState"]>;

/** The conflicts a user ADDS to an exchanged view by an edit: refused (the edited
 *  fields go back, with a toast). A mode the exchange does not draw -- polar,
 *  statistics, stack, facet, X break, horizontal bars -- entered while exchanged
 *  turns the exchange off instead, saying so; so does a view that arrives holding
 *  both (a window switch, a restore). The Map tab is navigation, not an edit. */
const REFUSED = new Set(["insets", "broken axes", "a top X axis", "Y3+ axes"]);
const guarded = new WeakSet<Store>();

export function installExchangeGuard(store: Store, toast: (msg: string, kind?: "danger" | "info") => void): void {
  if (guarded.has(store)) return;
  guarded.add(store);
  const conflictOf = (s: State): string => exchangeConflict({ ...s, stageTab: "plot" });
  const guard = (s: State, p: State): void => {
    const what = s.exchangeXY && conflictOf(s);
    if (!what) return;
    if (p.exchangeXY && REFUSED.has(what) && !conflictOf(p)) {
      store.setState({ insetMode: p.insetMode, xFmt: p.xFmt, yFmt: p.yFmt, y2Fmt: p.y2Fmt, yAxes: p.yAxes, yAxisOf: p.yAxisOf });
      toast(`Not applied: ${what} can't be set while X and Y are exchanged`, "danger");
    } else {
      store.setState({ exchangeXY: false });
      toast(`Exchange X–Y axes turned off: not available for ${what}`, "info");
    }
  };
  store.subscribe(guard);
  guard(store.getState(), { ...store.getState(), exchangeXY: false }); // a view already holding both
}
