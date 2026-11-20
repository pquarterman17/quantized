// Origin error-bar plots beyond one symmetric Y column (io/origin_project/
// opju_error_bars.py): asymmetric Y halves (`yErrPlus`/`yErrMinus`), X bars
// (`xErr`) and a filled band (`errBand`). The apply writes the bindings into
// the focused window's document, so the canvas spans and the export's
// `error_spans` come from one list, and the band rides the curve's style.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildErrorSpans } from "../lib/errorbars";
import { buildFigureSpecFromDocument } from "../lib/figureSpec";
import type { Dataset, DataStruct, OriginCurve } from "../lib/types";
import { liveWindowDocument } from "./liveWindowDocument";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { useApp } from "./useApp";
import { mainWindow } from "./windowDefaults";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

beforeAll(async () => {
  await loadOriginApplyLibs();
});

// channels: B (Y), C (+err), D (-err), E (X err)
const book: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 1, 3, 0.5],
    [20, 2, 4, 0.5],
    [30, 1, 5, 0.5],
  ],
  labels: ["B", "C", "D", "E"],
  units: ["", "", "", ""],
  metadata: {
    origin_book: "Book1",
    x_column_name: "A",
    origin_column_names: ["B", "C", "D", "E"],
    column_designations: { A: "X", B: "Y", C: "Y", D: "Y", E: "Y" },
  },
};
const ds: Dataset = { id: "d1", name: "P:Book1", data: book };

const entry = (id: string, curves: OriginCurve[]) => ({
  id, stem: "P", datasetId: "d1", siblingIds: ["d1"],
  figure: {
    name: id, x_from: 0, x_to: 4, x_log: false, y_from: 0, y_to: 40, y_log: false,
    n_curves: curves.length, annotations: [] as string[], curves,
  },
});

const ASYM: OriginCurve = { book: "Book1", x: "A", y: "B", yErrPlus: "C", yErrMinus: "D", xErr: "E", errBand: true };

function liveDoc() {
  const s = useApp.getState();
  const win = s.plotWindows.find((w) => w.id === s.focusedWindowId)!;
  return liveWindowDocument(s, win)!;
}

beforeEach(() => {
  useApp.setState({
    datasets: [ds], activeId: null, history: [], future: [], macroSteps: [],
    xKey: null, yKeys: null, hiddenChannels: [], errKeys: {},
    plotWindows: [mainWindow(null, "w1")], focusedWindowId: "w1",
    originFigures: [
      entry("asym", [ASYM]),
      entry("plain", [{ book: "Book1", x: "A", y: "B", yErr: "C" }]),
    ],
  });
});

describe("applyOriginFigure: asymmetric and X error bars", () => {
  it("draws Origin's plus / minus halves and X bars, on screen and in the export", () => {
    useApp.getState().applyOriginFigure("asym");
    const s = useApp.getState();
    expect(s.yKeys).toEqual([0]);
    const errors = liveDoc().bindings.errors;
    expect(errors).toEqual(expect.arrayContaining([
      { channel: 1, target: 0, axis: "y", side: "+" },
      { channel: 2, target: 0, axis: "y", side: "-" },
      { channel: 3, target: 0, axis: "x", side: "both" },
    ]));
    // the canvas: up by C, down by D, sideways by E
    const spans = buildErrorSpans(book, [0], errors).get(1)!;
    expect(spans.find((e) => e.axis === "y")).toEqual({ axis: "y", plus: [1, 2, 1], minus: [3, 4, 5] });
    expect(spans.find((e) => e.axis === "x")).toEqual({ axis: "x", plus: [0.5, 0.5, 0.5], minus: [0.5, 0.5, 0.5] });
    // the band rides the curve's style
    expect(s.seriesStyles[0]?.errorBar).toEqual({ band: true });
    // the export draws the same spans
    const spec = buildFigureSpecFromDocument(liveDoc(), ds, "P");
    expect(spec.error_spans?.[0]?.y).toEqual({ plus: [1, 2, 1], minus: [3, 4, 5] });
    expect(spec.error_spans?.[0]?.x).toEqual({ plus: [0.5, 0.5, 0.5], minus: [0.5, 0.5, 0.5] });
  });

  it("a later figure on the same book does not keep them", () => {
    useApp.getState().applyOriginFigure("asym");
    useApp.getState().applyOriginFigure("plain");
    const errors = liveDoc().bindings.errors;
    expect(errors).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(useApp.getState().seriesStyles[0]?.errorBar).toBeUndefined();
  });
});
