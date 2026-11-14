// store/panelInsets (#15): the panel-inset array + selection, exercised
// through the composed useApp store (same convention as shapes.test.ts).

import { afterEach, describe, expect, it } from "vitest";

import { useApp } from "./useApp";

const ORIGINAL = useApp.getState();

afterEach(() => {
  useApp.setState(ORIGINAL, true);
});

describe("panelInsets (#15)", () => {
  it("starts empty", () => {
    expect(useApp.getState().panelInsets).toEqual([]);
  });

  it("addPanelInset appends an entry with a fresh id and returns it", () => {
    const content = { kind: "table" as const, rows: [["1"]] };
    const id = useApp.getState().addPanelInset(content);
    expect(typeof id).toBe("string");
    expect(useApp.getState().panelInsets).toHaveLength(1);
    expect(useApp.getState().panelInsets[0]).toMatchObject({ id, content });
    expect(useApp.getState().panelInsets[0].at).toHaveLength(4);
  });

  it("addPanelInset honours an explicit placement", () => {
    const id = useApp.getState().addPanelInset({ kind: "table", rows: [["1"]] }, [0.5, 0.5, 0.2, 0.2]);
    expect(useApp.getState().panelInsets.find((p) => p.id === id)?.at).toEqual([0.5, 0.5, 0.2, 0.2]);
  });

  it("addPanelInset never reuses an id across calls", () => {
    const id1 = useApp.getState().addPanelInset({ kind: "table", rows: [["1"]] });
    const id2 = useApp.getState().addPanelInset({ kind: "table", rows: [["1"]] });
    expect(id1).not.toBe(id2);
  });

  it("updatePanelInset patches the matching entry, leaving others untouched", () => {
    useApp.setState({
      panelInsets: [
        { id: "p1", at: [0, 0, 0.3, 0.3], content: { kind: "table", rows: [["1"]] } },
        { id: "p2", at: [0.5, 0.5, 0.3, 0.3], content: { kind: "table", rows: [["2"]] } },
      ],
    });
    useApp.getState().updatePanelInset("p1", { at: [0.1, 0.1, 0.4, 0.4] });
    const [p1, p2] = useApp.getState().panelInsets;
    expect(p1.at).toEqual([0.1, 0.1, 0.4, 0.4]);
    expect(p2.at).toEqual([0.5, 0.5, 0.3, 0.3]);
  });

  it("updatePanelInset is a no-op for an unknown id", () => {
    useApp.setState({
      panelInsets: [{ id: "p1", at: [0, 0, 0.3, 0.3], content: { kind: "table", rows: [["1"]] } }],
    });
    useApp.getState().updatePanelInset("ghost", { at: [0.9, 0.9, 0.1, 0.1] });
    expect(useApp.getState().panelInsets[0].at).toEqual([0, 0, 0.3, 0.3]);
  });

  it("removePanelInset drops only the matching entry and clears its selection", () => {
    useApp.setState({
      panelInsets: [
        { id: "p1", at: [0, 0, 0.3, 0.3], content: { kind: "table", rows: [["1"]] } },
        { id: "p2", at: [0.5, 0.5, 0.3, 0.3], content: { kind: "table", rows: [["2"]] } },
      ],
      selectedPanelInsetId: "p1",
    });
    useApp.getState().removePanelInset("p1");
    expect(useApp.getState().panelInsets.map((p) => p.id)).toEqual(["p2"]);
    expect(useApp.getState().selectedPanelInsetId).toBeNull();
  });

  it("clearPanelInsets empties the list and deselects", () => {
    useApp.setState({
      panelInsets: [{ id: "p1", at: [0, 0, 0.3, 0.3], content: { kind: "table", rows: [["1"]] } }],
      selectedPanelInsetId: "p1",
    });
    useApp.getState().clearPanelInsets();
    expect(useApp.getState().panelInsets).toEqual([]);
    expect(useApp.getState().selectedPanelInsetId).toBeNull();
  });

  it("selectedPanelInsetId defaults to null and round-trips through the setter", () => {
    expect(useApp.getState().selectedPanelInsetId).toBeNull();
    useApp.getState().setSelectedPanelInsetId("p9");
    expect(useApp.getState().selectedPanelInsetId).toBe("p9");
    useApp.getState().setSelectedPanelInsetId(null);
    expect(useApp.getState().selectedPanelInsetId).toBeNull();
  });

  it("addPanelInset/removePanelInset ride the generic undo/redo stack", () => {
    const id = useApp.getState().addPanelInset({ kind: "table", rows: [["1"]] });
    expect(useApp.getState().panelInsets).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().panelInsets).toEqual([]);
    useApp.getState().redo();
    expect(useApp.getState().panelInsets.map((p) => p.id)).toEqual([id]);
  });
});
