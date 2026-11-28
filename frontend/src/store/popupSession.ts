// One undo step per popup session (plan item 44, Origin's Plot Details).
//
// A figure popup's Apply writes to the plot and stays open, so a session can
// hold several Applies. Each write goes through the store's own commit, which
// records its own history entry. This module folds them: after every Apply the
// entries it pushed collapse into ONE entry holding the state from before the
// FIRST Apply, so one Ctrl+Z after the popup closes (or while it is open)
// undoes the whole session, and a session that applied nothing records
// nothing. Folding after each Apply, rather than once on close, keeps the
// stack right however the popup goes away (OK, Cancel, Esc, backdrop).
//
// A gesture that moves the X / Y limits (the Axis popup's From / To) opts the
// folded entry into undoing them too, as `store/historyNav.ts` describes: the
// marks belong to a snapshot object, and the fold replaces that object.

import { navigationView } from "../lib/plotview";
import { markNavUndoable } from "./historyNav";
import { snapshotOf, type HistorySnapshot } from "./historySnapshot";
import type { AppState } from "./useApp";

export interface PopupSession {
  /** Run one Apply's store writes; the history entries they push fold into the session's one. */
  run: <T>(fn: () => T) => T;
}

interface Opened {
  snapshot: HistorySnapshot;
  /** `seq` of the entry on top before the session's first Apply. */
  since: number | undefined;
  /** `seq` of the entry on top after the last fold. */
  top: number | undefined;
  nav: string;
  labels: Set<string>;
}

/** `fallbackLabel` names the entry when the Applies pushed differently-labelled steps. */
export function createPopupSession(get: () => AppState, fallbackLabel: string): PopupSession {
  let opened: Opened | null = null;

  const settle = (o: Opened) => {
    const { history } = get();
    if (history.at(-1)?.seq === o.top) return; // nothing was pushed
    const k = o.top === undefined ? -1 : history.findIndex((e) => e.seq === o.top);
    for (const e of history.slice(k + 1)) o.labels.add(e.label);
    const label = o.labels.size === 1 ? [...o.labels][0]! : fallbackLabel;
    get().foldHistorySince(o.since, label, o.snapshot);
    o.top = get().history.at(-1)?.seq;
    const nav = navigationView(get());
    if (JSON.stringify(nav) !== o.nav) markNavUndoable(o.snapshot, nav);
  };

  return {
    run: (fn) => {
      const s = get();
      const top = s.history.at(-1)?.seq;
      // Something outside this popup moved the history since the last fold: an
      // undo pressed while it was open, or an entry another action pushed (a
      // fit finishing). Folding from the old start would swallow that entry
      // into this session's step, and one undo would silently revert it too, so
      // the next Apply starts a new step from here instead.
      if (opened && top !== opened.top) opened = null;
      opened ??= { snapshot: snapshotOf(s), since: top, top, nav: JSON.stringify(navigationView(s)), labels: new Set() };
      try {
        return fn();
      } finally {
        settle(opened);
      }
    },
  };
}
