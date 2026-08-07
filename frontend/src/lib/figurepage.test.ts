// Pure slot-model tests for the figure page composer (GOTO #4).

import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import type { FigureDoc } from "./figuredoc";
import {
  assignSlot,
  clearSlot,
  emptySlots,
  filledCount,
  panelLabel,
  patchSlot,
  resizeSlots,
  resolvePanelSource,
  slotLabels,
  type PanelSource,
} from "./figurepage";
import { defaultPlotView, type PlotWindow } from "./plotview";
import type { DataStruct } from "./types";

const winA: PanelSource = { kind: "window", id: "w1", name: "Graph 1" };
const winB: PanelSource = { kind: "window", id: "w2", name: "Graph 2" };
const doc: PanelSource = { kind: "figdoc", id: "f1", name: "MvsH fig" };

describe("panelLabel", () => {
  it("mirrors the backend formats", () => {
    expect(panelLabel(0, "(a)")).toBe("(a)");
    expect(panelLabel(1, "(a)")).toBe("(b)");
    expect(panelLabel(2, "A)")).toBe("C)");
    expect(panelLabel(3, "a.")).toBe("d.");
    expect(panelLabel(0, "(A)")).toBe("(A)");
    expect(panelLabel(1, "A.")).toBe("B.");
    expect(panelLabel(4, "a)")).toBe("e)");
    expect(panelLabel(9, "none")).toBe("");
  });

  it("rolls over spreadsheet-style past z", () => {
    expect(panelLabel(25, "(a)")).toBe("(z)");
    expect(panelLabel(26, "(a)")).toBe("(aa)");
    expect(panelLabel(27, "(A)")).toBe("(AB)");
  });
});

describe("slot model", () => {
  it("builds an empty rows x cols grid", () => {
    const slots = emptySlots(2, 3);
    expect(slots).toHaveLength(6);
    expect(filledCount(slots)).toBe(0);
  });

  it("assigns a source and moves it when re-assigned elsewhere", () => {
    let slots = emptySlots(2, 2);
    slots = assignSlot(slots, 0, winA);
    slots = assignSlot(slots, 3, winB);
    expect(slots[0].source?.id).toBe("w1");
    expect(slots[3].source?.id).toBe("w2");
    // Re-assigning winA into slot 1 empties slot 0 (a plot appears once).
    slots = assignSlot(slots, 1, winA);
    expect(slots[0].source).toBeNull();
    expect(slots[1].source?.id).toBe("w1");
    expect(filledCount(slots)).toBe(2);
  });

  it("does not conflate a window and a figdoc with the same id", () => {
    let slots = emptySlots(1, 2);
    slots = assignSlot(slots, 0, { ...winA, id: "same" });
    slots = assignSlot(slots, 1, { ...doc, id: "same" });
    expect(slots[0].source?.kind).toBe("window");
    expect(slots[1].source?.kind).toBe("figdoc");
  });

  it("clears a slot including its overrides", () => {
    let slots = emptySlots(1, 1);
    slots = assignSlot(slots, 0, winA);
    slots = patchSlot(slots, 0, { label: "(x)", title: "T" });
    slots = clearSlot(slots, 0);
    expect(slots[0]).toEqual({ source: null, label: null, title: null });
  });

  it("preserves slots by (row, col) position across a grid resize", () => {
    let slots = emptySlots(2, 2);
    slots = assignSlot(slots, 0, winA); // (0,0)
    slots = assignSlot(slots, 3, winB); // (1,1)
    // Grow 2x2 -> 2x3: (0,0) stays index 0, (1,1) becomes index 4.
    const grown = resizeSlots(slots, 2, 2, 3);
    expect(grown).toHaveLength(6);
    expect(grown[0].source?.id).toBe("w1");
    expect(grown[4].source?.id).toBe("w2");
    // Shrink 2x2 -> 1x2: row 1 falls off, winB is dropped.
    const shrunk = resizeSlots(slots, 2, 1, 2);
    expect(shrunk).toHaveLength(2);
    expect(shrunk[0].source?.id).toBe("w1");
    expect(filledCount(shrunk)).toBe(1);
  });
});

describe("slotLabels", () => {
  it("auto-numbers only filled slots, in row-major order", () => {
    let slots = emptySlots(2, 2);
    slots = assignSlot(slots, 1, winA);
    slots = assignSlot(slots, 3, winB);
    expect(slotLabels(slots, "(a)")).toEqual(["", "(a)", "", "(b)"]);
  });

  it("lets an explicit override win without consuming the sequence position", () => {
    let slots = emptySlots(1, 3);
    slots = assignSlot(slots, 0, winA);
    slots = assignSlot(slots, 1, winB);
    slots = assignSlot(slots, 2, doc);
    slots = patchSlot(slots, 1, { label: "(ii)" });
    // The override replaces "(b)"; the third panel still previews "(c)" —
    // matching the backend, where the auto index counts panels, not labels.
    expect(slotLabels(slots, "(a)")).toEqual(["(a)", "(ii)", "(c)"]);
  });

  it("suppresses everything under the none format", () => {
    let slots = emptySlots(1, 2);
    slots = assignSlot(slots, 0, winA);
    expect(slotLabels(slots, "none")).toEqual(["", ""]);
  });
});

// FIGURE_AUTHORING_WORKFLOW_PLAN F3.2: live-session liveness/lifecycle
// resolution for an assigned slot. Distinct from lib/pageDocument.ts's
// resolvePagePanel (which resolves a PERSISTED figureId) — this checks the
// SESSION reference (open window / legacy figdoc) using the exact same
// renderability rules windowSources/docSources already use to decide what's
// pickable, so "can I assign it" and "is it still valid" can never drift.
describe("resolvePanelSource", () => {
  const DATA: DataStruct = { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} };

  function win(over: Partial<PlotWindow> = {}): PlotWindow {
    return {
      id: "w1",
      kind: "plot",
      title: "",
      datasetId: "d1",
      geometry: { x: 0, y: 0, w: 400, h: 300 },
      z: 0,
      winState: "normal",
      view: defaultPlotView(),
      bg: "theme",
      linkGroup: null,
      pinned: false,
      ...over,
    };
  }

  function figDoc(over: Partial<FigureDoc> = {}): FigureDoc {
    return {
      id: "f1",
      name: "MvsH fig",
      datasetId: "d1",
      live: true,
      config: {
        xKey: null,
        yKeys: [0],
        xScale: "linear",
        yScale: "linear",
        title: "",
        xLabel: "",
        yLabel: "",
        style: "aps",
        fmt: "pdf",
        dpi: 300,
        overrides: null,
        seriesStyles: null,
      },
      ...over,
    };
  }

  const noDatasets = new Set<string>();
  const withD1 = new Set(["d1"]);

  it("reports empty for a null source", () => {
    expect(resolvePanelSource(null, [], [], noDatasets)).toEqual({ status: "empty" });
  });

  it("resolves a live, dataset-bound window as ok/live", () => {
    expect(resolvePanelSource(winA, [win()], [], withD1)).toEqual({ status: "ok", lifecycle: "live" });
  });

  it("resolves a window carrying a FROZEN FigureDocument as ok/frozen — inherited, not a second mechanism", () => {
    const frozen = createFigureDocument({
      id: "fd1",
      name: "frozen",
      datasetId: null,
      view: defaultPlotView(),
      data: { mode: "frozen", snapshot: DATA },
    });
    expect(
      resolvePanelSource(winA, [win({ document: frozen })], [], withD1),
    ).toEqual({ status: "ok", lifecycle: "frozen" });
  });

  it("reports missing when the assigned window no longer exists (closed)", () => {
    expect(resolvePanelSource(winA, [], [], withD1)).toEqual({ status: "missing" });
  });

  it("reports missing when the assigned window lost its dataset binding", () => {
    expect(resolvePanelSource(winA, [win({ datasetId: null })], [], withD1)).toEqual({ status: "missing" });
  });

  it("reports missing when the assigned window is no longer a plot (e.g. became a worksheet)", () => {
    expect(resolvePanelSource(winA, [win({ kind: "worksheet" })], [], withD1)).toEqual({ status: "missing" });
  });

  it("resolves a live figdoc with its dataset present as ok/live", () => {
    expect(resolvePanelSource(doc, [], [figDoc()], withD1)).toEqual({ status: "ok", lifecycle: "live" });
  });

  it("resolves a frozen figdoc with its snapshot present as ok/frozen", () => {
    const frozen = figDoc({ live: false, datasetId: null, dataSnapshot: DATA });
    expect(resolvePanelSource(doc, [], [frozen], noDatasets)).toEqual({ status: "ok", lifecycle: "frozen" });
  });

  it("reports missing when the assigned figdoc was deleted from the library", () => {
    expect(resolvePanelSource(doc, [], [], withD1)).toEqual({ status: "missing" });
  });

  it("reports missing when a live figdoc's source dataset was removed (doc still exists, unrenderable)", () => {
    expect(resolvePanelSource(doc, [], [figDoc()], noDatasets)).toEqual({ status: "missing" });
  });

  // F3.3: the "figure" source kind — a saved canonical editableFigures entry
  // picked directly (or a reopened page's hydrated panel). `editableFigures`
  // is the 5th, defaulted (`= []`) param — every call above omits it and
  // keeps behaving identically, since none of them ever assign a "figure".
  describe("figure source kind (F3.3)", () => {
    const figureSrc: PanelSource = { kind: "figure", id: "fig1", name: "Loop A" };

    it("defaults to missing when editableFigures is omitted entirely", () => {
      expect(resolvePanelSource(figureSrc, [], [], withD1)).toEqual({ status: "missing" });
    });

    it("resolves a live figure with its dataset present as ok/live", () => {
      const live = createFigureDocument({
        id: "fig1", name: "Loop A", datasetId: "d1", view: defaultPlotView(),
      });
      expect(resolvePanelSource(figureSrc, [], [], withD1, [live])).toEqual({
        status: "ok",
        lifecycle: "live",
      });
    });

    it("resolves a frozen figure with its snapshot present as ok/frozen", () => {
      const frozen = createFigureDocument({
        id: "fig1", name: "Loop A", datasetId: null, view: defaultPlotView(),
        data: { mode: "frozen", snapshot: DATA },
      });
      expect(resolvePanelSource(figureSrc, [], [], noDatasets, [frozen])).toEqual({
        status: "ok",
        lifecycle: "frozen",
      });
    });

    it("reports missing when the figure was deleted from editableFigures", () => {
      expect(resolvePanelSource(figureSrc, [], [], withD1, [])).toEqual({ status: "missing" });
    });

    it("reports missing when a live figure's source dataset was removed", () => {
      const live = createFigureDocument({
        id: "fig1", name: "Loop A", datasetId: "d1", view: defaultPlotView(),
      });
      expect(resolvePanelSource(figureSrc, [], [], noDatasets, [live])).toEqual({ status: "missing" });
    });
  });
});
