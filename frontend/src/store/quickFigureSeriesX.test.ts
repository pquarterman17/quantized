// Per-series X, store layer: a created figure binds to a derived overlay
// dataset (lib/quickFigureSeriesX.ts) with each series on its own X, as ONE
// undoable gesture that never touches the source worksheet; the overlay and
// the per-Y X mapping survive `.dwk`; Quick Plot templates carry, re-key and
// refuse per-Y X; and templates saved before per-Y X existed still parse and
// apply unchanged.
import { beforeEach, describe, expect, it } from "vitest";

import type { QuickFigureMapping } from "../lib/quickFigureMapping";
import { sanitizeQuickPlotTemplates } from "../lib/quickPlotTemplatesSanitize";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";

// X1 is `.time`; values are Y1(0) X2(1) Y2(2) X3(3) Y3(4); X3 is a loop.
function sheet(id: string): Dataset {
  const X1 = [0, 1, 2, 3];
  const X2 = [10, 20, 30, 40];
  const X3 = [0, 2, 0, -2];
  return {
    id,
    name: `${id}.csv`,
    data: {
      time: X1,
      values: X1.map((_, r) => [r + 1, X2[r], 100 * (r + 1), X3[r], -r]),
      labels: ["Y1", "X2", "Y2", "X3", "Y3"],
      units: ["V", "Oe", "V", "Oe", "V"],
      metadata: { technique: "generic", x_column_long: "X1" },
    },
  };
}

const ownX: QuickFigureMapping = { xKey: null, xKeyByY: { 2: 1, 4: 3 }, yKeys: [0, 2, 4], errorBindings: [], ignoredKeys: [] };

beforeEach(() => {
  useApp.setState({
    datasets: [sheet("d1"), sheet("d2")],
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
  useApp.getState().createWindow(null); // the app's always-present base window
  useApp.setState({ history: [], future: [] });
});

describe("createQuickFigureFromMapping — per-series X", () => {
  it("binds the figure to a new overlay dataset, each series on its own X; the source is untouched", () => {
    const source = structuredClone(useApp.getState().datasets[0]);
    expect(useApp.getState().createQuickFigureFromMapping("d1", ownX, "line")).toBe(true);
    const state = useApp.getState();
    expect(state.datasets[0]).toEqual(source);
    expect(state.datasets).toHaveLength(3);
    const overlay = state.datasets[2];
    const doc = state.editableFigures[0];
    expect(doc.bindings).toMatchObject({ datasetId: overlay.id, xKey: null, yKeys: [0, 1, 2] });
    expect(overlay.data.metadata).toMatchObject({ quick_figure_source: "d1", source_format: "quick-figure-overlay" });
    expect(overlay.data.time).toEqual([0, 1, 2, 3, 10, 20, 30, 40, 0, 2, 0, -2]);
    const win = state.plotWindows.find((w) => w.document?.id === doc.id)!;
    expect(win.datasetId).toBe(overlay.id);
    expect(state.focusedWindowId).toBe(win.id);
    expect(state.activeId).toBe(overlay.id);
  });

  it("a shared-X mapping still binds straight to the source (no overlay)", () => {
    const shared: QuickFigureMapping = { xKey: 1, yKeys: [0, 2], errorBindings: [], ignoredKeys: [] };
    expect(useApp.getState().createQuickFigureFromMapping("d1", shared, "line")).toBe(true);
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().editableFigures[0].bindings).toMatchObject({ datasetId: "d1", xKey: 1, yKeys: [0, 2] });
  });

  it("is ONE undoable gesture: a single undo removes the figure, its window, AND the overlay", () => {
    const windowsBefore = useApp.getState().plotWindows.length;
    useApp.getState().createQuickFigureFromMapping("d1", ownX, "line");
    useApp.getState().undo();
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore);
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("rows the source hides stay hidden on every block of the overlay", () => {
    useApp.setState({ datasets: [{ ...sheet("d1"), excludedRows: [1] }] });
    useApp.getState().createQuickFigureFromMapping("d1", ownX, "line");
    expect(useApp.getState().datasets[1].excludedRows).toEqual([1, 5, 9]);
  });

  it("the overlay and the figure's binding to it survive a .dwk save/reload", () => {
    useApp.getState().createQuickFigureFromMapping("d1", ownX, "line");
    const state = useApp.getState();
    const loaded = parseWorkspace(serializeWorkspace(state));
    const doc = loaded.editableFigures.find((d) => d.id === state.editableFigures[0].id)!;
    const overlay = loaded.datasets.find((d) => d.id === doc.bindings.datasetId)!;
    expect(overlay.data.time).toEqual(state.datasets[2].data.time);
    expect(overlay.data.values.map((row) => row.map((v) => (Number.isNaN(v) ? null : v)))).toEqual(
      state.datasets[2].data.values.map((row) => row.map((v) => (Number.isNaN(v) ? null : v))),
    );
  });
});

describe("Quick Plot templates — per-series X", () => {
  it("save -> .dwk -> re-apply keeps each series' own X", () => {
    const templateId = useApp.getState().saveQuickPlotTemplate("d1", ownX, "line", "XYXY", { kind: "schema" })!;
    const loaded = parseWorkspace(serializeWorkspace(useApp.getState()));
    expect(loaded.quickPlotTemplates.find((t) => t.id === templateId)!.mapping.xKeyByY).toEqual({ 2: 1, 4: 3 });

    useApp.setState({ quickPlotTemplates: loaded.quickPlotTemplates });
    expect(useApp.getState().applyQuickPlotTemplate(templateId, "d2")).toBe(true);
    const doc = useApp.getState().editableFigures[0];
    const overlay = useApp.getState().datasets.find((d) => d.id === doc.bindings.datasetId)!;
    expect(overlay.data.metadata.quick_figure_source).toBe("d2");
    expect(overlay.data.time).toEqual([0, 1, 2, 3, 10, 20, 30, 40, 0, 2, 0, -2]);
  });

  it("refuses the WHOLE apply when a series' own X column is gone -- never a fallback onto the shared X", () => {
    const templateId = useApp.getState().saveQuickPlotTemplate("d1", ownX, "line", "XYXY", { kind: "schema" })!;
    const renamed = sheet("d3");
    renamed.data.labels = ["Y1", "X2", "Y2", "field", "Y3"];
    useApp.setState({ datasets: [...useApp.getState().datasets, renamed] });
    expect(useApp.getState().applyQuickPlotTemplate(templateId, "d3")).toBe(false);
    expect(useApp.getState().status).toContain('X for Y series 3 ("X3")');
    expect(useApp.getState().editableFigures).toEqual([]);
  });

  it("a template saved before per-series X parses byte-for-byte unchanged and still applies shared-X", () => {
    const legacy = {
      id: "qpt-old",
      name: "Old",
      createdAt: "2026-08-01T00:00:00.000Z",
      modifiedAt: "2026-08-01T00:00:00.000Z",
      scope: { kind: "schema" },
      technique: "generic",
      signature: { channels: sheet("x").data.labels.map((label, i) => ({ label: label.toLowerCase(), unit: sheet("x").data.units[i], errorRole: "value" })) },
      mapping: { xKey: 1, yKeys: [0, 2], errorBindings: [], ignoredKeys: [] },
      style: "scatter",
      labels: { 0: "Y1", 1: "X2", 2: "Y2" },
    };
    const [parsed] = sanitizeQuickPlotTemplates(JSON.parse(JSON.stringify([legacy])));
    expect(parsed).toEqual(legacy);
    expect(parsed.mapping).not.toHaveProperty("xKeyByY");
    useApp.setState({ quickPlotTemplates: [parsed] });
    expect(useApp.getState().applyQuickPlotTemplate("qpt-old", "d2")).toBe(true);
    expect(useApp.getState().datasets).toHaveLength(2); // no overlay
    expect(useApp.getState().editableFigures[0].bindings).toMatchObject({ datasetId: "d2", xKey: 1, yKeys: [0, 2] });
  });

  it("a malformed per-series X map drops the template rather than degrading to the shared X", () => {
    const base = { id: "t", name: "t", createdAt: "a", modifiedAt: "a", scope: { kind: "schema" }, technique: "generic", signature: { channels: [] }, style: "line", labels: {} };
    const mapping = { xKey: null, yKeys: [0, 2], errorBindings: [], ignoredKeys: [] };
    expect(sanitizeQuickPlotTemplates([{ ...base, mapping: { ...mapping, xKeyByY: { 2: "X2" } } }])).toEqual([]);
    expect(sanitizeQuickPlotTemplates([{ ...base, mapping: { ...mapping, xKeyByY: [1] } }])).toEqual([]);
    expect(sanitizeQuickPlotTemplates([{ ...base, mapping: { ...mapping, xKeyByY: { 2: null } } }])[0].mapping.xKeyByY).toEqual({ 2: null });
  });
});
