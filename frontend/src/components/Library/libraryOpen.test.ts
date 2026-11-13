import { describe, expect, it } from "vitest";

import { isSelected, originFigureOpenOpts } from "./libraryOpen";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import type { OriginFigureEntry } from "../../lib/originFigures";
import { useApp } from "../../store/useApp";

// Figures audit B1: opening an Origin graph from the Library replaces the
// target window's whole view, so it must not land on a window the user styled
// for other data.
describe("originFigureOpenOpts", () => {
  const data = { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} };
  const entry = { id: "fig", stem: "P", datasetId: "book", siblingIds: ["book", "book2"], figure: { name: "Graph1" } } as unknown as OriginFigureEntry;
  const seed = (bound: string, styled: boolean) => {
    useApp.setState(useApp.getInitialState(), true);
    useApp.setState({ datasets: ["mt", "book", "book2"].map((id) => ({ id, name: id, data })), originFigures: [entry] });
    useApp.getState().setActive(bound);
    if (styled) useApp.getState().setPlotTitle("Sample A");
  };

  it("opens in a NEW window over a window styled for other data", () => {
    seed("mt", true);
    expect(originFigureOpenOpts("fig")).toEqual({ newWindow: true });
  });

  it("applies in place onto an unstyled window, or onto the window already showing the graph's data", () => {
    seed("mt", false);
    expect(originFigureOpenOpts("fig")).toBeUndefined();
    seed("book2", true);
    expect(originFigureOpenOpts("fig")).toBeUndefined();
  });
});

const worksheet = (id: string): LibraryNode =>
  ({ key: `worksheet:${id}`, entityId: id, kind: "worksheet" }) as LibraryNode;
const workbook = (id: string): LibraryNode =>
  ({ key: `workbook:${id}`, entityId: id, kind: "workbook" }) as LibraryNode;

describe("isSelected", () => {
  it("a worksheet is selected through the selectedIds set", () => {
    const set = new Set(["a", "b"]);
    expect(isSelected(worksheet("a"), set, null)).toBe(true);
    expect(isSelected(worksheet("z"), set, null)).toBe(false);
  });

  it("every other kind is selected through librarySelection, ignoring selectedIds", () => {
    const set = new Set(["w1"]); // even present in selectedIds, a workbook never reads it
    expect(isSelected(workbook("w1"), set, { kind: "workbook", id: "w1" })).toBe(true);
    expect(isSelected(workbook("w1"), set, { kind: "workbook", id: "w2" })).toBe(false);
    expect(isSelected(workbook("w1"), set, { kind: "folder", id: "w1" })).toBe(false); // kind must also match
  });

  // E-c3 "keep selection operations indexed" (LIBRARY_WORKBOOK_UX_PLAN):
  // LibraryTree/LibraryDetails call isSelected once PER RENDERED ROW. An
  // Array.includes selection test would rescan the whole live selection on
  // every one of those calls — O(rendered rows × selection size) per render.
  // Counting fake: a large selection, `isSelected` called many times, and
  // Set.has must be touched AT MOST ONCE per call — never scaling with the
  // selection's own size.
  it("counting fake: membership is O(1) per call, never proportional to selection size", () => {
    const selectionSize = 5000;
    const selectedIds = new Set(Array.from({ length: selectionSize }, (_, i) => `d${i}`));
    let hasCalls = 0;
    const countingSet = new Proxy(selectedIds, {
      get(target, prop, receiver) {
        if (prop === "has") {
          hasCalls++;
          return Reflect.get(target, prop, receiver).bind(target);
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const rowCount = 200; // a virtualized render window, not the whole library
    for (let i = 0; i < rowCount; i++) isSelected(worksheet(`d${i}`), countingSet, null);

    expect(hasCalls).toBe(rowCount); // exactly one Set lookup per call
  });
});
