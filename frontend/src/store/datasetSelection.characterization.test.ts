// Characterization tests for the SELECTION / ACTIVATION domain (audit P4.1,
// the EIGHTH store/useApp.ts domain): `setActive`, `activateFromLibrary`,
// `toggleSelected`, `selectRange` and `selectIds`, plus the `activeId`,
// `selectedIds` and `worksheetId` fields they own.
//
// `setActive` is the one action here that reaches into the windows slice
// (`retargetPassiveRebind` + `focusedRebindPatch`), so its specs pin the
// window effects through the REAL composed store: the focused window rebinds
// to the new dataset; a PINNED focused window hands the rebind to the top-z
// unpinned visible window, or to a freshly created one when none exists.
// Each spec pins, against a POISONED baseline (view/gadget/selection fields
// seeded off their defaults, so a write that "resets" one still shows):
//  1. the EXACT set of top-level keys the call changes — a whole-getState()
//     identity diff;
//  2. that no undo step is pushed (none of these five record history), no
//     toast fires, no macro step records (the recorder is armed) and the
//     status line is untouched;
//  3. the `ensureBookData` kick (a recorder stands in for the real lazy-book
//     fetch) — which ids are kicked, in order.
//
// Written and run GREEN against the pre-extraction useApp.ts; it imports the
// store only through `./useApp` (plus two modules that do not move), so
// nothing here may change when the domain moves out.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset, DataStruct } from "../lib/types";
import { useToasts } from "./toasts";
import { useApp, type AppState } from "./useApp";
import { mainWindow } from "./windows";

type Snap = Record<string, unknown>;

const data = (meta: Record<string, unknown> = {}): DataStruct => ({
  time: [1, 2, 3],
  values: [[10, 20, 30]],
  labels: ["a"],
  units: ["V"],
  metadata: meta,
});

const ds = (id: string, over: Partial<Dataset> = {}): Dataset => ({ id, name: id, data: data(), ...over });

const snapshot = (): Snap => ({ ...(useApp.getState() as unknown as Snap) });

/** Top-level store keys whose value changed identity, sorted. */
function changedSince(before: Snap): string[] {
  const after = useApp.getState() as unknown as Snap;
  return Object.keys(after)
    .filter((k) => after[k] !== before[k])
    .sort();
}

const act = (): AppState => useApp.getState();

// Every view/gadget field a genuine dataset switch resets, poisoned off its default.
const POISON_VIEW = {
  stageTab: "map",
  xKey: 0,
  yKeys: [0],
  groupKey: 0,
  facetKey: 0,
  y2Keys: [0],
  y2Lim: [0, 1],
  y2Scale: "log",
  y2Step: 1,
  y2AxisLabel: "Y2",
  seriesStyles: { 0: { color: "red" } },
  seriesLabels: { 0: "renamed" },
  seriesOrder: [0],
  errKeys: { 0: 0 },
  hiddenChannels: [0],
  xLim: [0, 1],
  yLim: [0, 1],
  xStep: 1,
  yStep: 1,
  composition: { kind: "break", panels: [] },
  rsmPeaks: [],
  integral: { sentinel: true },
  fwhmResult: { sentinel: true },
  qfitRoi: [0, 1],
  qfitResult: { sentinel: true },
  qfitBusy: true,
  qfitError: "stale",
  gadgetBusy: true,
  gadgetError: "stale",
  gadgetIntegrateResult: { sentinel: true },
  gadgetStatsResult: { sentinel: true },
  gadgetDerivResult: { sentinel: true },
  gadgetFftPreview: { sentinel: true },
  gadgetCursors: [0, 1],
  gadgetCursorResult: { sentinel: true },
};

let kicks: string[] = [];
let WIN = mainWindow("d2");

/** Fresh initial store, then a four-dataset library: d2 is active and bound
 *  to the focused window; d2+d3 are selected; d3 is the worksheet override;
 *  `ob` is an Origin-project book in workbook wb1 (collapsed). The tree has a
 *  folder selected, so every write that exits it shows in the diff. */
function seed(): void {
  useApp.setState(useApp.getInitialState(), true);
  WIN = mainWindow("d2");
  kicks = [];
  useApp.setState({
    datasets: [
      ds("d1"),
      ds("d2"),
      ds("d3"),
      ds("ob", { data: data({ origin_book: "Book1" }), workbookId: "wb1" }),
    ],
    activeId: "d2",
    selectedIds: ["d2", "d3"],
    worksheetId: "d3",
    plotWindows: [WIN],
    focusedWindowId: WIN.id,
    librarySelection: { kind: "folder", id: "f1" },
    expandedWorkbookIds: [],
    originBookClickOpens: "worksheet",
    ensureBookData: (id: string) => void kicks.push(id),
    status: "sentinel-status",
    macroRecording: true,
    macroSteps: [],
    history: [],
    future: [],
    ...(POISON_VIEW as unknown as Partial<AppState>),
  });
}

let toastsBefore: unknown;
beforeEach(() => {
  seed();
  toastsBefore = useToasts.getState().toasts;
});

/** No action in this domain records its OWN undo step, toasts or records a
 *  macro step. `undoLabels` names the one undo step a delegate pushes (the
 *  pinned-window path's `createWindow`). */
function expectNoSideNotices(undoLabels: string[] = []): void {
  expect(act().history.map((h) => h.label), "undo steps").toEqual(undoLabels);
  expect(useToasts.getState().toasts, "no toast").toBe(toastsBefore);
  expect(act().macroSteps, "no macro step").toEqual([]);
  expect(act().status, "status untouched").toBe("sentinel-status");
}

// A genuine plot-intent switch on an unpinned focused window: the rebind,
// the dataset-derived view reset, technique memory and the transient reset.
const SWITCH_KEYS = [
  "activeId", "composition", "errKeys", "facetKey", "fwhmResult", "gadgetBusy", "gadgetCursorResult",
  "gadgetCursors", "gadgetDerivResult", "gadgetError", "gadgetFftPreview", "gadgetIntegrateResult",
  "gadgetStatsResult", "groupKey", "hiddenChannels", "integral", "librarySelection", "plotWindows",
  "qfitBusy", "qfitError", "qfitResult", "qfitRoi", "rsmPeaks", "selectedIds", "seriesLabels",
  "seriesOrder", "seriesStyles", "stageTab", "worksheetId", "xKey", "xLim", "xStep", "y2AxisLabel",
  "y2Keys", "y2Lim", "y2Scale", "y2Step", "yKeys", "yLim", "yStep",
];
// Re-activating the id that is ALREADY active: no view reset, no memory.
const REACTIVATE_KEYS = [
  "composition", "fwhmResult", "gadgetBusy", "gadgetCursorResult", "gadgetCursors",
  "gadgetDerivResult", "gadgetError", "gadgetFftPreview", "gadgetIntegrateResult",
  "gadgetStatsResult", "integral", "librarySelection", "plotWindows", "qfitBusy", "qfitError",
  "qfitResult", "qfitRoi", "rsmPeaks", "selectedIds", "stageTab", "worksheetId",
];
// An unknown id: everything a switch writes except the stage tab (no dataset to route on).
const UNKNOWN_KEYS = SWITCH_KEYS.filter((k) => k !== "stageTab");
// A pinned focused window: `focusWindow` hands the live view to the retarget
// window first, so its hydrated view fields land on top of a switch.
const FOCUS_HANDOFF_KEYS = [
  "annotations", "axisLabelOffsets", "axisLabelStyles", "focusedWindowId", "refLines",
  "regionShades", "shapes", "statMarks", "statPicks", "xFmt", "yFmt",
];
const withKeys = (base: string[], extra: string[]): string[] => [...base, ...extra].sort();
// The worksheet-intent path for an Origin book.
const WORKSHEET_INTENT_KEYS = ["librarySelection", "selectedIds", "stageTab", "worksheetId"];

describe("initial state (moves with the slice)", () => {
  it("nothing is active, selected or overridden", () => {
    const init = useApp.getInitialState();
    expect(init.activeId).toBeNull();
    expect(init.selectedIds).toEqual([]);
    expect(init.worksheetId).toBeNull();
  });
});

describe("setActive", () => {
  it("a genuine switch rebinds the focused window, resets the view and selection, and kicks the book fetch", () => {
    const before = snapshot();
    act().setActive("d1");
    expect(changedSince(before)).toEqual(SWITCH_KEYS);
    const s = act();
    expect(s.activeId).toBe("d1");
    expect(s.selectedIds).toEqual(["d1"]);
    expect(s.worksheetId).toBeNull();
    expect(s.librarySelection).toBeNull();
    expect(s.stageTab).toBe("plot");
    expect(s.focusedWindowId).toBe(WIN.id);
    expect(s.plotWindows.map((w) => [w.id, w.datasetId])).toEqual([[WIN.id, "d1"]]);
    expect(s.xKey).toBeNull();
    expect(s.yKeys).toBeNull();
    expect(s.xLim).toBeNull();
    expect(s.composition).toBeNull();
    expect(s.integral).toBeNull();
    expect(s.gadgetCursors).toBeNull();
    expect(s.qfitBusy).toBe(false);
    expect(s.expandedWorkbookIds).toEqual([]);
    expect(kicks).toEqual(["d1"]);
    expectNoSideNotices();
  });

  it("re-activating the already-active dataset keeps the view, still resets the selection and transient state", () => {
    const before = snapshot();
    act().setActive("d2");
    expect(changedSince(before)).toEqual(REACTIVATE_KEYS);
    const s = act();
    expect(s.xKey, "channel keys survive a re-activation").toBe(0);
    expect(s.xLim).toEqual([0, 1]);
    expect(s.selectedIds).toEqual(["d2"]);
    expect(s.worksheetId).toBeNull();
    expect(s.composition).toBeNull();
    expect(s.plotWindows[0].datasetId).toBe("d2");
    expect(kicks).toEqual(["d2"]);
    expectNoSideNotices();
  });

  it("activating a sheet in a collapsed workbook discloses the workbook (once)", () => {
    const before = snapshot();
    act().setActive("ob");
    expect(changedSince(before)).toEqual(withKeys(SWITCH_KEYS, ["expandedWorkbookIds"]));
    expect(act().expandedWorkbookIds).toEqual(["wb1"]);
    const disclosed = act().expandedWorkbookIds;
    act().setActive("d1");
    act().setActive("ob");
    expect(act().expandedWorkbookIds, "an already-disclosed workbook is not re-written").toBe(disclosed);
    expect(kicks).toEqual(["ob", "d1", "ob"]);
    expectNoSideNotices();
  });

  it("an unknown id still becomes active; the stage tab stays put", () => {
    const before = snapshot();
    act().setActive("nope");
    expect(changedSince(before)).toEqual(UNKNOWN_KEYS);
    expect(act().activeId).toBe("nope");
    expect(act().stageTab).toBe("map");
    expect(act().plotWindows[0].datasetId).toBe("nope");
    expect(kicks).toEqual(["nope"]);
    expectNoSideNotices();
  });

  it("a PINNED focused window hands the rebind to the top-z unpinned visible plot window", () => {
    const low = { ...mainWindow("d3"), z: 1 };
    const high = { ...mainWindow("d3"), z: 5 };
    const hidden = { ...mainWindow("d3"), z: 9, winState: "minimized" as const };
    const pinned = { ...WIN, pinned: true };
    useApp.setState({ plotWindows: [pinned, low, high, hidden] });
    const before = snapshot();
    act().setActive("d1");
    expect(changedSince(before)).toEqual(withKeys(SWITCH_KEYS, FOCUS_HANDOFF_KEYS));
    const s = act();
    expect(s.focusedWindowId).toBe(high.id);
    expect(s.plotWindows.map((w) => [w.id, w.datasetId])).toEqual([
      [pinned.id, "d2"],
      [low.id, "d3"],
      [high.id, "d1"],
      [hidden.id, "d3"],
    ]);
    expect(s.activeId).toBe("d1");
    expect(kicks).toEqual(["d1"]);
    expectNoSideNotices();
  });

  it("a PINNED focused window with no candidate creates, focuses and binds a fresh window", () => {
    const pinned = { ...WIN, pinned: true };
    useApp.setState({ plotWindows: [pinned] });
    const before = snapshot();
    act().setActive("d1");
    expect(changedSince(before)).toEqual(withKeys(SWITCH_KEYS, [...FOCUS_HANDOFF_KEYS, "future", "history"]));
    const s = act();
    expect(s.plotWindows).toHaveLength(2);
    const fresh = s.plotWindows[1];
    expect(s.focusedWindowId).toBe(fresh.id);
    expect(fresh.datasetId).toBe("d1");
    expect(fresh.pinned).toBe(false);
    expect(s.plotWindows[0].datasetId, "the pinned window keeps its dataset").toBe("d2");
    expect(s.activeId).toBe("d1");
    expect(kicks).toEqual(["d1"]);
    expectNoSideNotices(["create window"]);
  });
});

describe("activateFromLibrary", () => {
  it("an Origin book under the default pref opens the worksheet and leaves the plot alone", () => {
    const before = snapshot();
    act().activateFromLibrary("ob");
    expect(changedSince(before)).toEqual(WORKSHEET_INTENT_KEYS);
    const s = act();
    expect(s.worksheetId).toBe("ob");
    expect(s.selectedIds).toEqual(["ob"]);
    expect(s.stageTab).toBe("worksheet");
    expect(s.librarySelection).toBeNull();
    expect(s.activeId).toBe("d2");
    expect(kicks).toEqual(["ob"]);
    expectNoSideNotices();
  });

  it("an Origin book under the 'plot' pref is a plain setActive", () => {
    useApp.setState({ originBookClickOpens: "plot" });
    const before = snapshot();
    act().activateFromLibrary("ob");
    expect(changedSince(before)).toEqual(withKeys(SWITCH_KEYS, ["expandedWorkbookIds"]));
    expect(act().activeId).toBe("ob");
    expect(act().worksheetId).toBeNull();
    expect(act().plotWindows[0].datasetId).toBe("ob");
    expect(kicks).toEqual(["ob"]);
    expectNoSideNotices();
  });

  it("a non-Origin dataset is a plain setActive whatever the pref", () => {
    const before = snapshot();
    act().activateFromLibrary("d1");
    expect(changedSince(before)).toEqual(SWITCH_KEYS);
    expect(act().activeId).toBe("d1");
    expect(act().plotWindows[0].datasetId).toBe("d1");
    expect(kicks).toEqual(["d1"]);
    expectNoSideNotices();
  });

  it("an unknown id falls through to setActive", () => {
    const before = snapshot();
    act().activateFromLibrary("nope");
    expect(changedSince(before)).toEqual(UNKNOWN_KEYS);
    expect(act().activeId).toBe("nope");
    expect(kicks).toEqual(["nope"]);
    expectNoSideNotices();
  });
});

describe("toggleSelected", () => {
  it("adds an unselected row and exits the tree selection; the active dataset stays", () => {
    const before = snapshot();
    act().toggleSelected("d1");
    expect(changedSince(before)).toEqual(["librarySelection", "selectedIds"]);
    expect(act().selectedIds).toEqual(["d2", "d3", "d1"]);
    expect(act().activeId).toBe("d2");
    expect(kicks).toEqual([]);
    expectNoSideNotices();
  });

  it("removes a selected row; with no tree selection only selectedIds changes", () => {
    useApp.setState({ librarySelection: null });
    const before = snapshot();
    act().toggleSelected("d3");
    expect(changedSince(before)).toEqual(["selectedIds"]);
    expect(act().selectedIds).toEqual(["d2"]);
    expectNoSideNotices();
  });
});

describe("selectRange", () => {
  it("selects forward from the active anchor in library order", () => {
    const before = snapshot();
    act().selectRange("ob");
    expect(changedSince(before)).toEqual(["librarySelection", "selectedIds"]);
    expect(act().selectedIds).toEqual(["d2", "d3", "ob"]);
    expect(act().activeId).toBe("d2");
    expectNoSideNotices();
  });

  it("selects backward from the anchor", () => {
    act().selectRange("d1");
    expect(act().selectedIds).toEqual(["d1", "d2"]);
  });

  it("with no active dataset the clicked row is its own anchor", () => {
    useApp.setState({ activeId: null });
    act().selectRange("d3");
    expect(act().selectedIds).toEqual(["d3"]);
  });

  it("an unknown id selects just that id and still exits the tree selection", () => {
    const before = snapshot();
    act().selectRange("nope");
    expect(changedSince(before)).toEqual(["librarySelection", "selectedIds"]);
    expect(act().selectedIds).toEqual(["nope"]);
    expectNoSideNotices();
  });
});

describe("selectIds", () => {
  it("de-duplicates, drops unknown ids, keeps the given order and exits the tree selection", () => {
    const before = snapshot();
    act().selectIds(["d3", "d1", "d3", "ghost"]);
    expect(changedSince(before)).toEqual(["librarySelection", "selectedIds"]);
    expect(act().selectedIds).toEqual(["d3", "d1"]);
    expect(act().activeId).toBe("d2");
    expectNoSideNotices();
  });

  it("an all-unknown list empties the selection but keeps the tree selection", () => {
    const before = snapshot();
    act().selectIds(["ghost"]);
    expect(changedSince(before)).toEqual(["selectedIds"]);
    expect(act().selectedIds).toEqual([]);
    expect(act().librarySelection).toEqual({ kind: "folder", id: "f1" });
    expectNoSideNotices();
  });
});
