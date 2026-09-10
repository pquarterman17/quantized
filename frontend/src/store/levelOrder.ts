// JMP_GAP J1 (Group O-2b): the categorical level REORDER UI, on top of
// Group O-2a's model layer (`DataStruct.level_order`, `lib/categorical.ts`'s
// `categoryLevels`/`orderLevels`/`levelOrderFor` — read that file's header
// before touching this one). A STANDALONE Zustand store, the `store/
// recode.ts` precedent this file mirrors line for line in shape: open/
// draft/commit state that does NOT round-trip `.dwk` on its own (the
// COMMITTED result, `DataStruct.level_order`, does — this store is only the
// panel's transient editing state), mutating the dataset through
// `useApp.getState()` directly with ONE `recordHistory` call so the whole
// reorder is one undo entry.
//
// CODES ARE IDENTITY (the invariant this whole file exists to protect). A
// formula literal like `A==1` binds to the raw numeric code — reordering
// must only ever permute the DISPLAY sequence, never renumber, invent, or
// drop a code. `commit()` never writes the draft verbatim for exactly this
// reason: it runs the draft through `lib/categorical.ts`'s `orderLevels`
// against the column's CURRENT present codes first, which is the ONE
// authority on what a level order is allowed to mean (fail-open: a code the
// draft doesn't name still renders, ascending, at the end) and — for free —
// the same operation that repairs a STALE draft (a code that appeared or
// vanished from the column while the panel sat open) into a correct
// permutation instead of a wrong membership. Reimplementing that rule here
// instead of calling it would be exactly the "second private copy of one
// decision" mistake `lib/categorical.ts`'s own header warns about (Group
// O-1 / BUG-008).
//
// RESET VS. STORE-ASCENDING (the other invariant this file protects):
// "reset to code order" DELETES the `level_order[channel]` entry rather
// than writing an ascending array. Absent means ascending, so a stored
// ascending array would freeze the order against levels added LATER (a
// re-import, a new row landing a fresh code) — the exact fail-open
// guarantee `orderLevels` gives every OTHER order would quietly stop
// applying to this one column. `commit()` enforces this the same way
// whether the user clicked "Reset to code order" or just manually dragged
// back to ascending by hand: it always compares the resolved result against
// ascending and deletes on a match, so the two paths can never disagree.
//
// DEFECT B (store/recode.ts's term, Sol audit P1-3), same shape here: this
// is a non-modal panel that keeps `channel` as a plain index for its whole
// open lifetime, so a column shift elsewhere (a formula/recode column
// removed, a reimport) while the panel is open could silently retarget it
// at a DIFFERENT column sitting at that stale index. `openLevelOrder` also
// captures the column's LABEL (`openLabel`) as a stable identity; `commit`
// re-resolves it via `lib/recode.ts`'s `resolveRecodeChannel` before
// trusting `channel` at all — unchanged if the label still matches,
// silently RETARGETS if exactly one other column now carries it, REFUSES
// (toast, panel stays open, draft untouched) if it's gone or ambiguous.
// `resolveRecodeChannel` is reused for the RESOLUTION LOGIC only — its own
// message text says "recode" (it is Recode's own helper); this rewrites the
// two fixed phrases it can produce rather than duplicate the whole
// resolution algorithm just to get different copy.

import { create } from "zustand";

import { categoryLevels, columnOf, groupLevelLabel, isCategoricalChannel, levelsOf, orderLevels } from "../lib/categorical";
import { resolveRecodeChannel } from "../lib/recode";
import type { DataStruct } from "../lib/types";
import { refusePendingEdit } from "./pendingEdit";
import { toast } from "./toasts";
import { useApp } from "./useApp";

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

interface LevelOrderState {
  open: boolean;
  datasetId: string | null;
  channel: number | null;
  /** DEFECT B: the column's identity as of open time, independent of
   *  `channel`'s position — see module header. */
  openLabel: string | null;
  /** The panel's working order, seeded from the column's CURRENT display
   *  order at open time (`categoryLevels`) so the list starts where the
   *  user already sees it, not re-sorted by code. */
  draft: number[];

  /** Open the panel on `channel` of `datasetId` — refuses (toast, stays
   *  closed) when the column isn't categorical, mirroring `openRecode`'s
   *  refusal (store/recode.ts). */
  openLevelOrder: (datasetId: string, channel: number) => void;
  closeLevelOrder: () => void;
  /** Swap `code` up one place in `draft`; a no-op at the first row. */
  moveUp: (code: number) => void;
  /** Swap `code` down one place in `draft`; a no-op at the last row. */
  moveDown: (code: number) => void;
  /** Reorder `draft` by each level's display LABEL (`groupLevelLabel`),
   *  `localeCompare`, stable — two levels sharing one label keep their
   *  prior relative order rather than the comparator arbitrarily reordering
   *  a "tie". */
  sortByLabel: () => void;
  /** Set `draft` to ascending code order. Only edits the DRAFT — whether
   *  that ends up DELETING the stored order or (redundantly) writing an
   *  ascending array happens once, uniformly, in `commit()`. */
  resetToCodeOrder: () => void;
  /** Commit `draft` as `channel`'s stored display order — or delete the
   *  entry when the resolved result is plain ascending order (see module
   *  header). ONE undo entry. Returns false (toast, zero mutation, panel
   *  stays open) on any refusal; true and closes the panel on success. */
  commit: () => boolean;
}

export const useLevelOrder = create<LevelOrderState>((set, get) => ({
  open: false,
  datasetId: null,
  channel: null,
  openLabel: null,
  draft: [],

  openLevelOrder: (datasetId, channel) => {
    const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
    if (!ds || !isCategoricalChannel(ds.data, channel)) {
      toast(`"${ds?.data.labels[channel] ?? "that column"}" isn't categorical — level order needs a level table.`, "danger");
      return;
    }
    set({
      open: true,
      datasetId,
      channel,
      openLabel: ds.data.labels[channel],
      draft: categoryLevels(ds.data, channel),
    });
  },

  closeLevelOrder: () => set({ open: false, datasetId: null, channel: null, openLabel: null, draft: [] }),

  moveUp: (code) =>
    set((s) => {
      const i = s.draft.indexOf(code);
      if (i <= 0) return {};
      const draft = [...s.draft];
      [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]];
      return { draft };
    }),

  moveDown: (code) =>
    set((s) => {
      const i = s.draft.indexOf(code);
      if (i < 0 || i >= s.draft.length - 1) return {};
      const draft = [...s.draft];
      [draft[i], draft[i + 1]] = [draft[i + 1], draft[i]];
      return { draft };
    }),

  sortByLabel: () =>
    set((s) => {
      const { datasetId, channel } = s;
      const ds = datasetId != null ? useApp.getState().datasets.find((d) => d.id === datasetId) : undefined;
      if (!ds || channel == null) return {};
      const labelOf = (code: number) => groupLevelLabel(ds.data, channel, code);
      // Array.prototype.sort has been a STABLE sort since ES2019 in every
      // engine this app targets — equal labels keep their incoming (prior
      // draft) relative order, never an arbitrary comparator-dependent one.
      const draft = [...s.draft].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
      return { draft };
    }),

  resetToCodeOrder: () =>
    set((s) => {
      const { datasetId, channel } = s;
      const ds = datasetId != null ? useApp.getState().datasets.find((d) => d.id === datasetId) : undefined;
      if (!ds || channel == null) return {};
      return { draft: levelsOf(columnOf(ds.data, channel)) };
    }),

  commit: () => {
    const { datasetId, channel, openLabel, draft } = get();
    if (datasetId == null || channel == null || openLabel == null) return false;
    const app = useApp.getState();
    const ds = app.datasets.find((d) => d.id === datasetId);
    if (!ds) {
      toast("can't reorder levels: dataset not found", "danger");
      return false;
    }
    // DEFECT B — re-resolve the LABEL identity before trusting `channel` at
    // all (see module header). A resolved retarget updates `channel` in the
    // panel state too; a refusal leaves the draft untouched.
    const resolved = resolveRecodeChannel(ds.data.labels, channel, openLabel);
    if (!resolved.ok) {
      const reason = resolved.reason
        .replace("can't commit recode", "can't reorder levels")
        .replace("reopen Recode", "reopen Reorder levels");
      toast(reason, "danger");
      return false;
    }
    const resolvedChannel = resolved.channel;
    if (resolvedChannel !== channel) set({ channel: resolvedChannel });
    if (!isCategoricalChannel(ds.data, resolvedChannel)) {
      toast(`can't reorder levels for "${ds.data.labels[resolvedChannel]}": no longer categorical`, "danger");
      return false;
    }
    const present = levelsOf(columnOf(ds.data, resolvedChannel)); // ascending, by construction
    // Fail-open re-derivation: `orderLevels` is the ONE authority on what a
    // level order means (lib/categorical.ts header) — named codes that are
    // still present, in the draft's sequence, then any present code the
    // draft doesn't name, ascending. Running the (possibly stale) draft
    // through it is what keeps invariant 1 (codes are identity, never
    // invented or dropped) even when a code appeared or vanished from the
    // column while the panel sat open — the result is always exactly the
    // set `present` holds, never the draft's raw membership.
    const reordered = orderLevels(present, draft);
    const ascending = arraysEqual(reordered, present);
    // "Reset to code order" and a manual drag back to ascending must agree
    // (invariant 3): both funnel through this same ascending check, so
    // either path DELETES the stored entry rather than writing one.
    const { level_order: prevOrder, ...restData } = ds.data;
    const nextOrder: Record<number, number[]> = { ...(prevOrder ?? {}) };
    if (ascending) delete nextOrder[resolvedChannel];
    else nextOrder[resolvedChannel] = reordered;
    const data: DataStruct = Object.keys(nextOrder).length
      ? { ...restData, level_order: nextOrder }
      : (restData as DataStruct);
    // Same site class as `commitRecode`/`setCategoricalCell` (BUG-006 site 9):
    // a pending dataset's `.data` is a read-only display projection that gets
    // replaced wholesale once the real fetch lands, so a `level_order` write
    // here would be silently discarded — refuse instead of losing it quietly.
    if (refusePendingEdit(() => useApp.getState(), ds, "reordering levels")) return false;
    // No `recordMacro` call, deliberately: this is a pure DISPLAY-order
    // change, the same class `setSeriesOrder` ("reorder curves", store/
    // useApp.ts) is — that action records history for undo but has no
    // macro line either. A column-MUTATING action (`setChannelType`,
    // `commitRecode`) does call recordMacro; this isn't one.
    app.recordHistory("reorder levels");
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === datasetId ? { ...d, data } : d)),
    }));
    toast(`reordered levels for "${ds.data.labels[resolvedChannel]}"`, "ok");
    set({ open: false, datasetId: null, channel: null, openLabel: null, draft: [] });
    return true;
  },
}));
