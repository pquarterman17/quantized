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
// + "something the turn cannot draw" from ever standing in the live view. It is
// installed by the Plot menu command once this lazy module loads. Everything else
// is pure: the .dwk loader reads it too (in a worker).

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
  /** The focused window's saved x-break count, when the caller already has it (a loaded document). */
  xBreaks?: number;
  /** Or the windows themselves (the live store): the focused plot window's document carries its x-breaks. */
  plotWindows?: readonly { id: string; kind: string; document?: { plot: { axisBreaks: { x: readonly unknown[] } } } }[];
  focusedWindowId?: string | null;
  xFmt?: AxisFormat;
  yFmt: AxisFormat;
  y2Fmt: AxisFormat | null;
  yAxes?: readonly unknown[];
  seriesStyles?: Readonly<Record<number, SeriesStyle | undefined>>;
}

/** What the view holds that the turn cannot draw (a phrase), or "". The first four
 *  of the `REFUSED` set are ADDED by an edit and refused; a mode switch clears the
 *  exchange instead. A saved x-break counts (the same rule as `stackLayoutOn`):
 *  Break at gaps and the Figure Builder keep it in the window's document. */
export function exchangeConflict(s: ExchangeState): string {
  return s.stageTab === "map" ? "maps"
    : s.polarMode ? "polar plots"
    : s.statMode ? "statistics plots"
    : s.stackMode || s.facetKey != null || s.composition || s.xBreaks || s.plotWindows?.some((w) => w.id === s.focusedWindowId && w.kind === "plot" && w.document?.plot.axisBreaks.x.length) ? "multi-panel layouts"
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
 *  is what the user built, and the pair is refused everywhere else. `facetKey` and
 *  `xBreaks` are the document's binding and saved breaks, which its view state does
 *  not carry. */
export function dropStaleExchange<V extends { exchangeXY: boolean }>(v: V, facetKey: number | null = null, xBreaks = 0): V {
  const s = { composition: null, stageTab: "plot", xBreaks, ...v, facetKey: (v as { facetKey?: number | null }).facetKey ?? facetKey } as unknown as ExchangeState;
  return v.exchangeXY && exchangeConflict(s) ? { ...v, exchangeXY: false } : v;
}

type Store = typeof useApp;
type State = ReturnType<Store["getState"]>;

/** Plot > Exchange X-Y axes: one undo step; toggling twice is the identity. */
export function toggleExchangeXY(store: Store): void {
  store.getState().recordHistory("exchange X–Y");
  store.setState((s) => ({ exchangeXY: !s.exchangeXY }));
}

/** The conflicts a user ADDS to an exchanged view by an edit. */
const REFUSED = new Set(["insets", "broken axes", "a top X axis", "Y3+ axes"]);
const guarded = new WeakSet<Store>();

/** Keeps the pair from standing in the live view:
 *
 *  * an inset, a Y / Y2 break or a top X axis set through its setter while
 *    exchanged is refused BEFORE it commits -- the setters are wrapped, so no undo
 *    entry is made and no other subscriber sees it -- with a toast saying why;
 *  * anything else that adds one (a Y3+ axis, a Figure Builder commit) is put back
 *    from the last conflict-free state, only the conflicting fields, by a store
 *    subscription;
 *  * a mode the exchange does not draw -- polar, statistics, stack, facet, an X
 *    break, horizontal bars -- entered while exchanged turns the exchange off,
 *    saying so; so does a view that arrives holding both (a window switch).
 *
 *  The Map tab is navigation, not an edit, so it never clears the flag. */
export function installExchangeGuard(store: Store, toast: (msg: string, kind?: "danger" | "info") => void): void {
  if (guarded.has(store)) return;
  guarded.add(store);
  const refuse = (what: string) => toast(`Not applied: ${what} can't be set while X and Y are exchanged`, "danger");
  const wrap = (name: "setInsetMode" | "setXFmt" | "setYFmt" | "setY2Fmt", clash: (arg: never) => string) => {
    const set = store.getState()[name] as (arg: never) => void;
    const guardedSet = (arg: never): void => {
      const what = store.getState().exchangeXY && clash(arg);
      if (what) refuse(what);
      else set(arg);
    };
    store.setState({ [name]: guardedSet } as Partial<State>);
  };
  wrap("setInsetMode", (on: boolean) => (on ? "insets" : ""));
  wrap("setXFmt", (f: AxisFormat) => (f.top ? "a top X axis" : ""));
  wrap("setYFmt", (f: AxisFormat) => (f.breaks?.length ? "broken axes" : ""));
  wrap("setY2Fmt", (f: AxisFormat | null) => (f?.breaks?.length ? "broken axes" : ""));

  const conflictOf = (s: State): string => exchangeConflict({ ...s, stageTab: "plot" });
  const snap = (s: State) => ({ on: s.exchangeXY, win: s.focusedWindowId, insetMode: s.insetMode, xFmt: s.xFmt, yFmt: s.yFmt, y2Fmt: s.y2Fmt, yAxes: s.yAxes, yAxisOf: s.yAxisOf });
  let safe = snap(store.getState());
  const guard = (s: State): void => {
    if (!conflictOf(s)) {
      safe = snap(s);
      return;
    }
    if (!s.exchangeXY) return;
    const what = conflictOf(s);
    if (REFUSED.has(what) && safe.on && safe.win === s.focusedWindowId) { // an edit, not a view that arrived with both
      // put back only what conflicts: the rest of the edit (digits, a title ...) stands
      const back: Partial<State> =
        what === "insets" ? { insetMode: safe.insetMode }
        : what === "a top X axis" ? { xFmt: { ...s.xFmt, top: safe.xFmt.top } }
        : what === "Y3+ axes" ? { yAxes: safe.yAxes, yAxisOf: safe.yAxisOf }
        : { yFmt: { ...s.yFmt, breaks: safe.yFmt.breaks }, y2Fmt: s.y2Fmt && { ...s.y2Fmt, breaks: safe.y2Fmt?.breaks } };
      store.setState(back);
      refuse(what);
    } else {
      store.setState({ exchangeXY: false });
      toast(`Exchange X–Y axes turned off: not available for ${what}`, "info");
    }
  };
  store.subscribe(guard);
  guard(store.getState()); // a view already holding both
}
