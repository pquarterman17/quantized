// BUG-009's guard half: no row preference may be recorded against a PENDING
// dataset's decimated preview, because `lib/bookData.installBookData` clears
// `excludedRows`/`filter` outright when the real book lands (#50/#53) — so
// before this guard the user's exclusions and filters vanished silently, with
// no message and no undo entry to notice.
//
// The complementary rule is tested just as hard: CLEARING is deliberately
// still allowed, or the guard would trap a user looking at row state they want
// gone.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";
import { resetBookTransportForTests } from "../lib/bookData";

function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "book.opj",
    data: {
      time: [0, 1, 2, 3],
      values: [[10], [20], [30], [40]],
      labels: ["Signal"],
      units: [""],
      metadata: {},
    },
    ...over,
  };
}

/** A dataset whose full data has not arrived: `.data` is a decimated preview. */
function pendingDataset(over: Partial<Dataset> = {}): Dataset {
  return dataset({
    pending: { kind: "upload", bookId: "b1", rows: 4000, cols: 1, previewSampled: true },
    ...over,
  });
}

const ds = () => useApp.getState().datasets[0];

beforeEach(() => {
  // BUG-009: the guard kicks a real fetch that rejects under jsdom and records
  // the reason in module scope; clear it so one test cannot answer for the next.
  resetBookTransportForTests();
  useApp.setState({ datasets: [dataset()], activeId: "d1", selection: null, history: [], status: "" });
});

describe("row-state writes are refused while a dataset is pending (BUG-009)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [pendingDataset()], activeId: "d1", selection: null, history: [], status: "" });
  });

  it("toggleRowExcluded records nothing and leaves no undo entry", () => {
    useApp.getState().toggleRowExcluded("d1", 2);
    expect(ds().excludedRows).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().status).toMatch(/still loading its full data/);
  });

  it("setRowsExcluded records nothing", () => {
    useApp.getState().setRowsExcluded("d1", [0, 1]);
    expect(ds().excludedRows).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("excludeSelectedRows — the worksheet toolbar's Exclude button — records nothing", () => {
    useApp.setState({ selection: { datasetId: "d1", rows: [1, 2] } });
    useApp.getState().excludeSelectedRows();
    expect(ds().excludedRows).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(0);
    // The selection survives the refusal, so the retry the message suggests
    // still has something to act on.
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [1, 2] });
  });

  it("keepOnlySelectedRows records nothing — its complement would be taken over the PREVIEW row count", () => {
    useApp.setState({ selection: { datasetId: "d1", rows: [1] } });
    useApp.getState().keepOnlySelectedRows();
    expect(ds().excludedRows).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("setDatasetFilter records nothing", () => {
    useApp.getState().setDatasetFilter("d1", [{ col: 0, kind: "range", min: 15, max: 35 }]);
    expect(ds().filter).toBeUndefined();
    expect(useApp.getState().status).toMatch(/still loading its full data/);
  });
});

describe("CLEARING row state is still allowed while pending, deliberately", () => {
  it("clearRowExclusions clears, so a user is never trapped with exclusions they cannot remove", () => {
    // Reachable via the .dwk ROUND TRIP, not a reimport (which clears
    // `pending` in the same updater): lib/workspaceSerialize.ts writes
    // excludedRows/filter/pending independently and
    // lib/workspaceDatasetParse.ts restores all three independently, so a
    // document saved by a pre-guard build loads pending WITH row state.
    // Refusing here would create the very lockout the guard exists to prevent,
    // and clears nothing `installBookData` would not clear a moment later.
    useApp.setState({ datasets: [pendingDataset({ excludedRows: [0, 2] })], activeId: "d1", history: [] });
    useApp.getState().clearRowExclusions("d1");
    expect(ds().excludedRows).toBeUndefined();
  });

  it("clearDatasetFilter clears", () => {
    useApp.setState({
      datasets: [pendingDataset({ filter: [{ col: 0, kind: "range", min: 15, max: 35 }] })],
      activeId: "d1",
    });
    useApp.getState().clearDatasetFilter("d1");
    expect(ds().filter).toBeUndefined();
  });
});

describe("the guard changes nothing for a dataset that is NOT pending", () => {
  it("toggleRowExcluded still excludes, with one undo entry", () => {
    useApp.getState().toggleRowExcluded("d1", 2);
    expect(ds().excludedRows).toEqual([2]);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(ds().excludedRows).toBeUndefined();
  });

  it("toggleRowExcluded is a toggle — a second call removes the row", () => {
    useApp.getState().toggleRowExcluded("d1", 2);
    useApp.getState().toggleRowExcluded("d1", 2);
    expect(ds().excludedRows).toBeUndefined();
  });

  it("setRowsExcluded sanitizes out-of-range and duplicate rows", () => {
    useApp.getState().setRowsExcluded("d1", [3, 3, 1, -1, 99]);
    expect(ds().excludedRows).toEqual([1, 3]);
  });

  it("excludeSelectedRows merges into any existing exclusions and clears the selection", () => {
    useApp.setState({ datasets: [dataset({ excludedRows: [0] })], activeId: "d1", selection: { datasetId: "d1", rows: [2] } });
    useApp.getState().excludeSelectedRows();
    expect(ds().excludedRows).toEqual([0, 2]);
    expect(useApp.getState().selection).toBeNull();
  });

  it("keepOnlySelectedRows excludes the complement over the real row count", () => {
    useApp.setState({ selection: { datasetId: "d1", rows: [1, 2] } });
    useApp.getState().keepOnlySelectedRows();
    expect(ds().excludedRows).toEqual([0, 3]);
  });

  it("setDatasetFilter stores only ACTIVE predicates, and drops to undefined when none are", () => {
    useApp.getState().setDatasetFilter("d1", [{ col: 0, kind: "range", min: 15, max: 35 }]);
    expect(ds().filter).toHaveLength(1);
    useApp.getState().setDatasetFilter("d1", [{ col: 0, kind: "range" }]);
    expect(ds().filter).toBeUndefined();
  });
});

describe("selection actions (transient, never written into a dataset)", () => {
  it("toggleRowSelected adds then removes, and empties to null", () => {
    useApp.getState().toggleRowSelected(2);
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [2] });
    useApp.getState().toggleRowSelected(2);
    expect(useApp.getState().selection).toBeNull();
  });

  it("setRowSelection de-duplicates and sorts", () => {
    useApp.getState().setRowSelection([3, 1, 1]);
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [1, 3] });
  });

  it("a selection is not guarded while pending — it writes no dataset state", () => {
    useApp.setState({ datasets: [pendingDataset()], activeId: "d1", selection: null, status: "" });
    useApp.getState().setRowSelection([1, 2]);
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [1, 2] });
    expect(useApp.getState().status).toBe("");
  });
});

describe("an id that resolves to no dataset aborts before recording anything", () => {
  it("leaves no undo entry and no loading message", () => {
    // Review round L3: the first version of this test asserted only `status`
    // and `excludedRows`, and BOTH are unchanged whichever way the missing-id
    // branch decides — so inverting that decision left it green. The real
    // observable is the HISTORY: falling through to the `datasets.map` (which
    // matches nothing) still ran `recordHistory`, leaving a dead undo entry —
    // the same wart this commit fixes for the pending case. It now aborts.
    useApp.getState().toggleRowExcluded("nope", 0);
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().status).toBe("");
    expect(ds().excludedRows).toBeUndefined();
  });
});

describe("a refusal PRESERVES existing row state (review L6)", () => {
  it("does not clear exclusions or the filter it declined to change", () => {
    // Every refusal test above starts from a dataset with no row state, so an
    // implementation that CLEARED it on refusal passed all of them —
    // `undefined` on both sides. Seed it, so the assertion has something to
    // lose.
    useApp.setState({
      datasets: [pendingDataset({ excludedRows: [0], filter: [{ col: 0, kind: "range", min: 5, max: 25 }] })],
      activeId: "d1",
      history: [],
    });
    useApp.getState().toggleRowExcluded("d1", 2);
    useApp.getState().setDatasetFilter("d1", [{ col: 0, kind: "range", min: 100, max: 200 }]);
    expect(ds().excludedRows).toEqual([0]);
    expect(ds().filter).toEqual([{ col: 0, kind: "range", min: 5, max: 25 }]);
  });
});

describe("the windowId (MDI worksheet) route is guarded too (review L5)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [pendingDataset()],
      activeId: "d1",
      selection: null,
      history: [],
      status: "",
      worksheetSelections: { ws1: { datasetId: "d1", rows: [1, 2] } },
    });
  });

  it("excludeSelectedRows(windowId) refuses, and leaves that window's selection intact", () => {
    useApp.getState().excludeSelectedRows("ws1");
    expect(ds().excludedRows).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(0);
    // The refusal returns BEFORE clearWorksheetRowSelection, so the retry the
    // message suggests still has a selection to act on.
    expect(useApp.getState().worksheetSelections.ws1).toEqual({ datasetId: "d1", rows: [1, 2] });
  });

  it("keepOnlySelectedRows(windowId) refuses the same way", () => {
    useApp.getState().keepOnlySelectedRows("ws1");
    expect(ds().excludedRows).toBeUndefined();
    expect(useApp.getState().worksheetSelections.ws1).toEqual({ datasetId: "d1", rows: [1, 2] });
  });

  it("and both still work through that route on a non-pending dataset", () => {
    useApp.setState({ datasets: [dataset()], worksheetSelections: { ws1: { datasetId: "d1", rows: [1, 2] } } });
    useApp.getState().excludeSelectedRows("ws1");
    expect(ds().excludedRows).toEqual([1, 2]);
    expect(useApp.getState().worksheetSelections.ws1).toBeUndefined();
  });
});
