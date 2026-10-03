// The Quick Figure Builder's setup panel reaches the CREATED figure: the
// materialized look (lib/quickFigureSetup.ts -> lib/quickFigureCommit.ts's
// `QuickFigureLook`) lands in the canonical document and its window, an
// untouched setup changes nothing, and a Quick Plot template carries the look
// through `.dwk` and re-applies it.
import { beforeEach, describe, expect, it } from "vitest";

import { PALETTES } from "../lib/palettes";
import { DEFAULT_QUICK_FIGURE_SETUP, quickFigureLook, type QuickFigureSetup } from "../lib/quickFigureSetup";
import type { QuickFigureMapping } from "../lib/quickFigureMapping";
import { sanitizeQuickPlotTemplates } from "../lib/quickPlotTemplatesSanitize";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";

function dataset(id: string): Dataset {
  return {
    id,
    name: `${id}.csv`,
    data: {
      time: [1, 2, 3],
      values: [[10, 1, 5, 0.5], [20, 2, 6, 0.6], [30, 3, 7, 0.7]],
      labels: ["R", "R_err", "S", "group"],
      units: ["", "", "", ""],
      metadata: { technique: "generic" },
      cat_levels: { 3: ["A"] },
    },
  };
}

const mapping: QuickFigureMapping = {
  xKey: null,
  yKeys: [0, 2],
  errorBindings: [{ channel: 1, target: 0, axis: "y", side: "both" }],
  ignoredKeys: [3],
};

const custom: QuickFigureSetup = {
  palette: "okabe-ito",
  lineWidth: 2,
  lineStyle: "dashed",
  markerShape: "square",
  markerSize: 7,
  xScale: "log",
  yScale: "log",
  showGrid: false,
  showLegend: true,
  legendPos: "sw",
  errorBars: false,
};

beforeEach(() => {
  useApp.setState({
    datasets: [dataset("d1"), dataset("d2")],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    quickPlotTemplates: [],
    techniqueViewMemory: {},
    history: [],
    future: [],
    status: "",
  });
});

const okabe = PALETTES.find((p) => p.value === "okabe-ito")!.colors!;

describe("createQuickFigureFromMapping honours the setup panel", () => {
  it("an untouched setup creates exactly the figure the builder made without one", () => {
    useApp.getState().createQuickFigureFromMapping("d1", mapping, "line-symbol");
    const look = quickFigureLook(DEFAULT_QUICK_FIGURE_SETUP, "line-symbol", false);
    useApp.getState().createQuickFigureFromMapping("d1", mapping, "line-symbol", look);
    const [plain, withLook] = useApp.getState().editableFigures;
    expect(withLook.plot.view).toEqual(plain.plot.view);
    expect(withLook.bindings.errors).toEqual(plain.bindings.errors);
  });

  it("colour preset, lines/markers, axes, legend, and error bars all land in the document and window", () => {
    const look = quickFigureLook(custom, "line-symbol", false);
    expect(useApp.getState().createQuickFigureFromMapping("d1", mapping, "line-symbol", look)).toBe(true);
    const doc = useApp.getState().editableFigures[0];
    const view = doc.plot.view;
    expect(view).toMatchObject({ xScale: "log", yScale: "log", showGrid: false, showLegend: true, legendPos: "sw" });
    const shared = { width: 2, line: "dashed", marker: true, markerShape: "square", markerSize: 7 };
    expect(view.seriesStyles[0]).toEqual({ ...shared, color: okabe[0] });
    expect(view.seriesStyles[2]).toEqual({ ...shared, color: okabe[1] });
    expect(doc.bindings.errors).toEqual([]);
    const win = useApp.getState().plotWindows.find((w) => w.document?.id === doc.id)!;
    expect(win.view).toMatchObject({ xScale: "log", yScale: "log", showGrid: false, legendPos: "sw" });
    expect(win.view.seriesStyles[2]).toEqual(view.seriesStyles[2]);
  });

  it("a scatter figure takes the marker settings but no line settings", () => {
    const look = quickFigureLook({ ...DEFAULT_QUICK_FIGURE_SETUP, lineWidth: 3, markerShape: "diamond" }, "scatter", false);
    useApp.getState().createQuickFigureFromMapping("d1", mapping, "scatter", look);
    expect(useApp.getState().editableFigures[0].plot.view.seriesStyles[0]).toEqual({ marker: true, markerShape: "diamond" });
  });

  it("a grouped figure keeps the theme colour cycle (one channel style would paint every level alike)", () => {
    const look = quickFigureLook(custom, "line", true);
    useApp.getState().createQuickFigureFromMapping("d1", { ...mapping, yKeys: [0], ignoredKeys: [2], groupKey: 3 }, "line", look);
    expect(useApp.getState().editableFigures[0].plot.view.seriesStyles[0]).toEqual({ width: 2, line: "dashed" });
  });
});

describe("Quick Plot templates carry the look", () => {
  it("save -> .dwk -> apply re-creates the same look on a matching worksheet", () => {
    const look = quickFigureLook(custom, "line-symbol", false);
    const id = useApp.getState().saveQuickPlotTemplate("d1", mapping, "line-symbol", "Styled", { kind: "schema" }, look)!;
    const loaded = parseWorkspace(serializeWorkspace(useApp.getState()));
    const persisted = loaded.quickPlotTemplates.find((t) => t.id === id)!;
    expect(persisted.look).toEqual(look);
    useApp.setState({ quickPlotTemplates: loaded.quickPlotTemplates });
    expect(useApp.getState().applyQuickPlotTemplate(id, "d2")).toBe(true);
    const view = useApp.getState().editableFigures[0].plot.view;
    expect(view.yScale).toBe("log");
    expect(view.seriesStyles[2].color).toBe(okabe[1]);
  });

  it("a template without a look parses unchanged, and a malformed look is repaired field by field", () => {
    const base = {
      id: "t", name: "T", createdAt: "x", modifiedAt: "x", scope: { kind: "schema" }, technique: "generic",
      signature: { channels: [] }, mapping, style: "line", labels: {},
    };
    const [plain] = sanitizeQuickPlotTemplates([base]);
    expect(plain.look).toBeUndefined();
    const [fixed] = sanitizeQuickPlotTemplates([{ ...base, look: { xScale: "banana", showGrid: "no", series: [3, { width: 2 }], errorBars: false } }]);
    expect(fixed.look).toEqual({ xScale: "linear", yScale: "linear", showGrid: true, showLegend: true, legendPos: "auto", series: [{ width: 2 }], errorBars: false });
  });
});
