// paletteContextActions — the GUI_INTERACTION #8 residual's Command Palette
// bridge: merges the active dataset / selected annotation / selected shape's
// registry actions into ⌘K. Store-seeded like the sibling registry test
// files (annotationShapeActions.test.ts, windowMenu.test.ts) — a minimal
// DataStruct is enough since these actions never read dataset.data.

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { contextPaletteActions } from "./paletteContextActions";
import type { Dataset } from "./types";

function makeDataset(id: string, name: string, over: Partial<Dataset> = {}): Dataset {
  return {
    id,
    name,
    data: { time: [1], values: [[1]], labels: ["m"], units: [""], metadata: {} },
    ...over,
  };
}

beforeEach(() => {
  useApp.setState({
    datasets: [makeDataset("d1", "Alpha"), makeDataset("d2", "Beta")],
    activeId: "d1",
    selectedIds: [],
    selectedAnnotationId: null,
    annotations: [],
    selectedShapeId: null,
    shapes: [],
  });
});

describe("contextPaletteActions — active dataset", () => {
  it("includes the dataset's core actions grouped under 'Active dataset — <name>'", () => {
    const actions = contextPaletteActions();
    const dup = actions.find((a) => a.label === "Duplicate");
    expect(dup).toBeTruthy();
    expect(dup!.group).toBe("Active dataset — Alpha");
    expect(actions.some((a) => a.label === "Split by column value…")).toBe(true);
  });

  it("omits 'Show in folder' when the dataset has no folderId", () => {
    const actions = contextPaletteActions();
    expect(actions.some((a) => a.label === "Show in folder")).toBe(false);
  });

  it("includes 'Show in folder' when the dataset IS foldered", () => {
    useApp.setState({ datasets: [makeDataset("d1", "Alpha", { folderId: "f1" }), makeDataset("d2", "Beta")] });
    const actions = contextPaletteActions();
    expect(actions.some((a) => a.label === "Show in folder")).toBe(true);
  });

  it("omits 'Plot (make active)' for the already-active dataset (enabled: false)", () => {
    const actions = contextPaletteActions();
    expect(actions.some((a) => a.label === "Plot (make active)")).toBe(false);
  });

  it("ids are prefixed 'ctx.dataset.' so they can't collide with other groups", () => {
    const actions = contextPaletteActions();
    const dup = actions.find((a) => a.label === "Duplicate")!;
    expect(dup.id).toBe("ctx.dataset.dataset.duplicate");
  });

  it("returns [] with no active dataset and nothing else selected", () => {
    useApp.setState({ activeId: null });
    expect(contextPaletteActions()).toEqual([]);
  });
});

describe("contextPaletteActions — selected annotation", () => {
  beforeEach(() => {
    useApp.setState({ activeId: null, datasets: [] }); // isolate to just the annotation group
  });

  it("includes Edit text…/Delete but not the conv-gated pin toggle", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }], selectedAnnotationId: "a1" });
    const actions = contextPaletteActions();
    expect(actions.some((a) => a.label === "Edit text…")).toBe(true);
    expect(actions.some((a) => a.label === "Delete")).toBe(true);
    expect(actions.some((a) => a.label.startsWith("Pin to"))).toBe(false);
  });

  it("groups annotation entries under 'Selected annotation'", () => {
    useApp.setState({ annotations: [{ id: "a1", x: 1, y: 2, text: "Tc" }], selectedAnnotationId: "a1" });
    const del = contextPaletteActions().find((a) => a.label === "Delete")!;
    expect(del.group).toBe("Selected annotation");
  });

  it("is absent when the selected id no longer matches a live annotation", () => {
    useApp.setState({ annotations: [], selectedAnnotationId: "stale" });
    expect(contextPaletteActions()).toEqual([]);
  });
});

describe("contextPaletteActions — selected shape", () => {
  beforeEach(() => {
    useApp.setState({ activeId: null, datasets: [] });
  });

  it("includes Dashed/Delete grouped under 'Selected shape'", () => {
    useApp.setState({
      shapes: [{ id: "s1", kind: "rect", x1: 1, y1: 2, x2: 3, y2: 4 }],
      selectedShapeId: "s1",
    });
    const actions = contextPaletteActions();
    const dashed = actions.find((a) => a.label === "Dashed");
    expect(dashed?.group).toBe("Selected shape");
    expect(actions.some((a) => a.label === "Delete")).toBe(true);
  });

  it("is absent when the selected id no longer matches a live shape", () => {
    useApp.setState({ shapes: [], selectedShapeId: "stale" });
    expect(contextPaletteActions()).toEqual([]);
  });
});
