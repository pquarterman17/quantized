// A2 owner decision (2026-11-20): a curve's RECORDED X column, when it
// decoded, wins over the plot's nearest-preceding-X rule (lib/perSeriesX).
// Corpus case: Catchment A..E .opju Graph6 records x=D (Year), y=I, in a book
// designated A(X) B C D(X) E F G(X) H I; nearest-preceding-X drew I against
// G (Annual Precipitation, ~1000), off the decoded 1947..2002 axis -- an empty
// plot. The rule needs an X the curve RECORD names (`xRecorded`, .opju);
// a .opj X is inferred by the reader and never wins. Controls: a curve whose
// recorded X IS its nearest preceding X (Moke-
// style X,Y,X,Y books) keeps the plain apply; a curve with no recorded X keeps
// the rule; a recorded X that did not import leaves the curve out with a
// diagnosis (fail closed), never redrawn against a nearby X.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { curveX } from "../lib/perSeriesX";
import type { Dataset, DataStruct } from "../lib/types";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

beforeAll(async () => {
  await loadOriginApplyLibs();
});

// .time = A (month index); channels B, D(X: year), G(X: annual), I (ΔS).
const book: DataStruct = {
  time: [1, 2, 3],
  values: [
    [5, 1950, 1000, 30],
    [6, 1951, 1100, 40],
    [7, 1952, 1200, 50],
  ],
  labels: ["b", "Year", "Annual", "dS"],
  units: ["", "", "", ""],
  metadata: {
    origin_book: "Book1",
    x_column_name: "A",
    origin_column_names: ["B", "D", "G", "I"],
    column_designations: { A: "X", B: "Y", D: "X", G: "X", I: "Y" },
  },
};
const ds: Dataset = { id: "d1", name: "C:Book1", data: book };

const entry = (id: string, curves: { book: string; x: string; y: string; xRecorded?: boolean }[]) => ({
  id, stem: "C", datasetId: "d1", siblingIds: ["d1"],
  figure: {
    name: id, x_from: 1947.5, x_to: 2002.5, x_log: false, y_from: -100, y_to: 500, y_log: false,
    n_curves: curves.length, annotations: [] as string[], curves,
  },
});

/** Every finite (x, y) point the applied view draws for channel `k`. */
function drawn(k: number): [number, number][] {
  const s = useApp.getState();
  const data = s.datasets.find((d) => d.id === s.activeId)!.data;
  const xs = s.xKey == null ? data.time : data.values.map((r) => r[s.xKey!]);
  return xs.flatMap((x, i) => (Number.isFinite(data.values[i][k]) && Number.isFinite(x) ? [[x, data.values[i][k]] as [number, number]] : []));
}

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [ds], activeId: null, history: [], future: [], macroSteps: [],
    xKey: null, yKeys: null, hiddenChannels: [],
    originFigures: [
      entry("Graph6", [{ book: "Book1", x: "D", y: "I", xRecorded: true }]),
      entry("inferred", [{ book: "Book1", x: "D", y: "I" }]),
      entry("nearest", [{ book: "Book1", x: "G", y: "I", xRecorded: true }]),
      entry("lost", [{ book: "Book1", x: "Q", y: "I", xRecorded: true }, { book: "Book1", x: "G", y: "I" }]),
    ],
  });
});

describe("applyOriginFigure: the recorded X wins (A2)", () => {
  it("precondition: nearest-preceding-X would draw I against G", () => {
    expect(curveX(ds, 1)[3]).toBe(2);
  });

  it("draws I against its recorded X (Year), not the nearest preceding X", () => {
    useApp.getState().applyOriginFigure("Graph6");
    const s = useApp.getState();
    const yk = s.yKeys ?? [];
    expect(yk).toHaveLength(1);
    expect(drawn(yk[0])).toEqual([[1950, 30], [1951, 40], [1952, 50]]);
    // ...and the X axis is titled by that column, not the book's first X.
    const shown = s.datasets.find((d) => d.id === s.activeId)!;
    expect(shown.data.metadata?.x_column_long).toBe("Year");
  });

  it("control: an INFERRED X (no xRecorded: every .opj curve) is no evidence -- the rule stands", () => {
    // Moke.opj Graph8/9: the reader infers x=E for y=B, Origin draws B vs A.
    useApp.getState().applyOriginFigure("inferred");
    const s = useApp.getState();
    expect(s.activeId).toBe("d1"); // no overlay dataset
    expect(s.xKey).toBe(1);
    expect(s.yKeys).toEqual([3]);
  });

  it("control: a recorded X equal to the nearest preceding X keeps the plain apply", () => {
    useApp.getState().applyOriginFigure("nearest");
    const s = useApp.getState();
    expect(s.activeId).toBe("d1"); // no overlay dataset
    expect(s.xKey).toBe(2);
    expect(s.yKeys).toEqual([3]);
  });

  it("a multi-layer window keeps its other layers (the double-Y partner is not dropped)", () => {
    // Layer 1's recorded X conflicts; the same-dataset double-Y apply must
    // still run, never a one-layer overlay that drops layer 2.
    const layer = (n: number, curves: { book: string; x: string; y: string; xRecorded?: boolean }[], y: [number, number]) => {
      const e = entry(`W-${n}`, curves);
      return { ...e, figure: { ...e.figure, name: "W", layer: n, y_from: y[0], y_to: y[1] } };
    };
    useApp.setState({
      originFigures: [
        layer(1, [{ book: "Book1", x: "D", y: "I", xRecorded: true }], [0, 60]),
        layer(2, [{ book: "Book1", x: "G", y: "B" }], [0, 10]),
      ],
    });
    useApp.getState().applyOriginFigure("W-1");
    const s = useApp.getState();
    expect(s.activeId).toBe("d1"); // no one-layer overlay dataset
    expect(s.y2Keys).toEqual([0]);
  });

  it("a recorded X that did not import leaves that curve out, with a diagnosis", () => {
    useApp.getState().applyOriginFigure("lost");
    const msgs = useToasts.getState().toasts.map((t) => t.msg).join("\n");
    expect(msgs).toContain("Book1 column I (X Q)");
    expect(useApp.getState().yKeys).toEqual([3]); // only the G-bound curve
    expect(useApp.getState().xKey).toBe(2);
  });
});
