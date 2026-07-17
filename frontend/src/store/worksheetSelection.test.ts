// Unit tests for the per-worksheet-window selection slice (GUI_INTERACTION
// #14). Exercised directly against the composed `useApp` store (the slice is
// spread into it) rather than a standalone store instance, matching every
// other slice test in this directory (see store/panels.test.ts etc.).

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";

beforeEach(() => {
  useApp.setState({ worksheetSelections: {} });
});

describe("worksheetSelection slice (GUI_INTERACTION #14)", () => {
  it("toggleWorksheetRowSelected builds a selection scoped to one window", () => {
    useApp.getState().toggleWorksheetRowSelected("w1", "d1", 2);
    useApp.getState().toggleWorksheetRowSelected("w1", "d1", 0);
    expect(useApp.getState().worksheetSelections.w1).toEqual({ datasetId: "d1", rows: [0, 2] });
    useApp.getState().toggleWorksheetRowSelected("w1", "d1", 0);
    expect(useApp.getState().worksheetSelections.w1).toEqual({ datasetId: "d1", rows: [2] });
  });

  it("setWorksheetRowSelection replaces with a sorted unique set; empty drops the entry", () => {
    useApp.getState().setWorksheetRowSelection("w1", "d1", [2, 0, 2]);
    expect(useApp.getState().worksheetSelections.w1).toEqual({ datasetId: "d1", rows: [0, 2] });
    useApp.getState().setWorksheetRowSelection("w1", "d1", []);
    expect(useApp.getState().worksheetSelections.w1).toBeUndefined();
  });

  it("clearWorksheetRowSelection drops just that window's entry", () => {
    useApp.getState().setWorksheetRowSelection("w1", "d1", [1]);
    useApp.getState().setWorksheetRowSelection("w2", "d1", [2]);
    useApp.getState().clearWorksheetRowSelection("w1");
    expect(useApp.getState().worksheetSelections.w1).toBeUndefined();
    expect(useApp.getState().worksheetSelections.w2).toEqual({ datasetId: "d1", rows: [2] });
  });

  it("two windows on the SAME dataset select fully independently", () => {
    useApp.getState().toggleWorksheetRowSelected("w1", "d1", 0);
    useApp.getState().toggleWorksheetRowSelected("w2", "d1", 5);
    expect(useApp.getState().worksheetSelections.w1).toEqual({ datasetId: "d1", rows: [0] });
    expect(useApp.getState().worksheetSelections.w2).toEqual({ datasetId: "d1", rows: [5] });
    // Mutating w1 further never touches w2's entry.
    useApp.getState().toggleWorksheetRowSelected("w1", "d1", 1);
    expect(useApp.getState().worksheetSelections.w1).toEqual({ datasetId: "d1", rows: [0, 1] });
    expect(useApp.getState().worksheetSelections.w2).toEqual({ datasetId: "d1", rows: [5] });
  });

  it("a stale entry from a rebound window is overwritten by a fresh datasetId, not merged", () => {
    useApp.getState().setWorksheetRowSelection("w1", "d1", [3]);
    useApp.getState().setWorksheetRowSelection("w1", "d2", [7]); // window rebound to a new dataset
    expect(useApp.getState().worksheetSelections.w1).toEqual({ datasetId: "d2", rows: [7] });
  });

  it("toggling against a stale datasetId starts fresh rather than reusing the old rows", () => {
    useApp.setState({ worksheetSelections: { w1: { datasetId: "d1", rows: [0, 1, 2] } } });
    useApp.getState().toggleWorksheetRowSelected("w1", "d2", 9); // now bound to d2
    expect(useApp.getState().worksheetSelections.w1).toEqual({ datasetId: "d2", rows: [9] });
  });
});
