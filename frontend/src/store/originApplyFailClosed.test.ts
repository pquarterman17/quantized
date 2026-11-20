// A3 (visual sweep vs Origin's own images): an Origin figure that RECORDS
// curves, none of which resolves to a column with data, must apply as an
// EMPTY plot with a note -- never fall back to every channel of the book.
// The fallback drew phantom curves: Moke.opj Graph2 (one curve on an empty
// column; Origin draws an empty graph) showed 11 channels, hc2convert.opj
// Graph1/4/6/7..11 (three curves on an X that did not decode) 31-33.
// Negative control: a figure with NO curve evidence keeps the dataset-default
// view, as before.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_RESOLVED_CURVES_REASON } from "../lib/linkedCurvesLite";
import { figureHasCurveEvidence, figureSelectionState } from "../lib/originFigureSelection";
import type { Dataset, DataStruct } from "../lib/types";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

beforeAll(async () => {
  await loadOriginApplyLibs();
});

// Columns A(X) B C D(all NaN, a formula column that never computed).
const book: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 100, NaN],
    [11, 101, NaN],
    [12, 102, NaN],
  ],
  labels: ["b", "c", "d"],
  units: ["", "", ""],
  metadata: { origin_book: "Book1", x_column_name: "A", origin_column_names: ["B", "C", "D"] },
};
const ds: Dataset = { id: "d1", name: "Book1", data: book };

const base = {
  name: "Graph2",
  x_from: 0, x_to: 4, x_log: false, y_from: 0, y_to: 200, y_log: false,
  n_curves: 1,
  annotations: [] as string[],
};
const entry = (id: string, figure: Record<string, unknown>) => ({
  id, stem: "Moke", datasetId: "d1", siblingIds: ["d1"], figure: { ...base, ...figure },
});

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [ds], activeId: "d1", history: [], future: [], macroSteps: [],
    xKey: 1, yKeys: [0], hiddenChannels: [],
    originFigures: [
      entry("empty-col", { curves: [{ book: "Book1", x: "A", y: "D" }] }),
      entry("bad-x", { curves: [{ book: "Book1", x: "Q", y: "B" }, { book: "Book1", x: "Q", y: "C" }] }),
      entry("omitted", { curves: [], curve_sheet_omitted: [{ book: "Book1", x: "", y: "B", recorded: "", reason: "x_not_a_column" }] }),
      entry("no-evidence", { curves: [] }),
      entry("resolves", { curves: [{ book: "Book1", x: "A", y: "C" }] }),
    ],
  });
});

describe("applyOriginFigure fails closed when no recorded curve resolves (A3)", () => {
  it.each(["empty-col", "bad-x", "omitted"])("%s: an empty plot plus a note, never every channel", (id) => {
    useApp.getState().applyOriginFigure(id);
    const s = useApp.getState();
    expect(s.yKeys).toEqual([]);
    expect(s.xKey).toBeNull();
    expect(useToasts.getState().toasts.map((t) => t.msg).join("\n")).toContain(id === "omitted" ? "left out of the import" : "none of its curves resolved");
  });

  it("a layer whose only evidence is left-out curves never claims 'none resolved'", () => {
    useApp.getState().applyOriginFigure("omitted");
    const msg = useToasts.getState().toasts.map((t) => t.msg).join("\n");
    expect(msg).not.toContain("none of its curves resolved");
    expect(msg).toContain("Recover");
  });

  it("negative control: a figure with no curve evidence keeps the dataset-default view", () => {
    useApp.getState().applyOriginFigure("no-evidence");
    expect(useApp.getState().yKeys).toBeNull();
    expect(useToasts.getState().toasts.map((t) => t.msg).join("\n")).not.toContain("none of its curves resolved");
  });

  it("positive control: a resolving curve is drawn as before", () => {
    useApp.getState().applyOriginFigure("resolves");
    expect(useApp.getState().yKeys).toEqual([1]);
  });

  it("a fail-closed apply followed by a resolving one draws again", () => {
    useApp.getState().applyOriginFigure("empty-col");
    useApp.getState().applyOriginFigure("resolves");
    expect(useApp.getState().yKeys).toEqual([1]);
  });
});

describe("figureSelectionState / figureHasCurveEvidence", () => {
  it("fails closed only for a figure with curve evidence", () => {
    expect(figureSelectionState(null, { curves: [{ book: "B", x: "A", y: "B" }] }).yKeys).toEqual([]);
    expect(figureSelectionState(null, { curves: [] }).yKeys).toBeNull();
    expect(figureSelectionState(null).yKeys).toBeNull();
  });

  it("a heatmap or ternary layer opens its own stage, so it is not a fail-closed XY case", () => {
    const curves = [{ book: "B", x: "A", y: "B" }];
    expect(figureHasCurveEvidence({ curves })).toBe(true);
    expect(figureHasCurveEvidence({ curves, map: { book: "B", kind: "heatmap" } as never })).toBe(false);
    expect(figureHasCurveEvidence({ curves, ternary: { book: "B", a: "A", b: "B", c: "C" } as never })).toBe(false);
  });

  it("the stage note says why the plot is empty", () => {
    expect(NO_RESOLVED_CURVES_REASON).toMatch(/^No curves: /);
  });
});
