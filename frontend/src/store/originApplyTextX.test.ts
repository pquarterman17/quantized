// A text (Month) column RECORDED as a curve's X that is NOT the book's own X
// draws at category positions 1..N with the text as tick labels, as Origin
// does (Catchment A-E Graph1/2: recorded X = the Month text column; Origin's
// preview shows Jan..Dec under a 0.5..12.5 axis). Before, such a figure failed
// closed to an empty plot. Controls: a layer mixing a text X with a numeric-X
// curve is not one axis (text curves left out, with a toast); an X that is not
// recorded (`xRecorded` false) is no evidence and fails closed as before.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { textXLetter } from "../lib/originRecordedX";
import type { Dataset, DataStruct } from "../lib/types";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

beforeAll(async () => {
  await loadOriginApplyLibs();
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "", ""]; // 4 used rows, 2 blank
// Book1: A = Month (text, designated X), D = Year (X, decoded as the book's X), B, C = Y.
const book: DataStruct = {
  time: [1947, 1948, 1949, 1950, 1951, 1952],
  values: [
    [10, 1],
    [20, 2],
    [30, 3],
    [40, 4],
    [50, 5],
    [60, 6],
  ],
  labels: ["Precip", "Flow"],
  units: ["mm", "mm"],
  metadata: {
    origin_book: "Book1",
    x_column_name: "D",
    origin_column_names: ["B", "C"],
    column_designations: { A: "X", B: "Y", C: "Y", D: "X" },
    origin_text_columns: { A: MONTHS },
    origin_text_column_labels: { A: { long_name: "Month", unit: "" } },
  },
};
const ds: Dataset = { id: "d1", name: "C:Book1", data: book };

const entry = (id: string, curves: { book: string; x: string; y: string; xRecorded?: boolean }[]) => ({
  id, stem: "C", datasetId: "d1", siblingIds: ["d1"],
  figure: {
    name: id, x_from: 0.5, x_to: 4.5, x_log: false, y_from: 0, y_to: 100, y_log: false,
    n_curves: curves.length, annotations: [] as string[], curves,
  },
});

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [ds], activeId: null, history: [], future: [], macroSteps: [],
    xKey: null, yKeys: null, hiddenChannels: [],
    originFigures: [
      entry("Graph1", [{ book: "Book1", x: "A", y: "B", xRecorded: true }]),
      entry("mixed", [{ book: "Book1", x: "A", y: "B", xRecorded: true }, { book: "Book1", x: "D", y: "C", xRecorded: true }]),
      entry("inferred", [{ book: "Book1", x: "A", y: "B" }]),
    ],
  });
});

describe("applyOriginFigure: a recorded text X draws over the categories", () => {
  it("textXLetter finds the one text column and refuses the mixed and unrecorded cases", () => {
    const [g1, mixed, inferred] = useApp.getState().originFigures.map((e) => e.figure);
    expect(textXLetter(g1, ds)).toBe("A");
    expect(textXLetter(mixed, ds)).toBeNull();
    expect(textXLetter(inferred, ds)).toBeNull();
  });

  it("builds a category overlay: x = 1..N for the used rows, the cells as labels", () => {
    useApp.getState().applyOriginFigure("Graph1");
    const s = useApp.getState();
    const shown = s.datasets.find((d) => d.id === s.activeId)!;
    expect(shown.id).not.toBe("d1"); // the overlay, not the book
    expect(s.xKey).toBeNull();
    expect(shown.data.metadata?.x_category_labels).toEqual(["Jan", "Feb", "Mar", "Apr"]);
    expect(shown.data.time.slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(Number.isNaN(shown.data.time[4])).toBe(true); // the blank rows have no category
    expect(shown.data.values.slice(0, 4).map((r) => r[0])).toEqual([10, 20, 30, 40]);
    expect(shown.data.metadata?.x_column_long).toBe("Month");
    expect(s.xLim).toEqual([0.5, 4.5]);
  });

  it("control: a layer mixing a text X with a numeric X draws the numeric curve and says what it left out", () => {
    useApp.getState().applyOriginFigure("mixed");
    const s = useApp.getState();
    const shown = s.datasets.find((d) => d.id === s.activeId)!;
    expect(shown.data.metadata?.x_category_labels).toBeUndefined();
    expect(useToasts.getState().toasts.map((t) => t.msg).join("\n")).toMatch(/Book1 column B \(X A\)/);
  });

  it("control: an unrecorded (inferred) text X is no evidence -- the figure stays empty", () => {
    useApp.getState().applyOriginFigure("inferred");
    const s = useApp.getState();
    expect(s.yKeys).toEqual([]);
  });
});
