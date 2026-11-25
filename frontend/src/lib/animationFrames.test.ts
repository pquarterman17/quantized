import { describe, expect, it, vi } from "vitest";

import { exportFigureAnimation } from "./api/figureAnimation";
import {
  downloadAnimation,
  frameWires,
  MAX_ANIMATION_FRAMES,
  planByLevelFrames,
  planDatasetFrames,
} from "./animationFrames";
import { createFigureDocument } from "./figureDocument";
import { defaultPlotView } from "./plotview";
import type { Dataset } from "./types";

vi.mock("./api/figureAnimation", () => ({ exportFigureAnimation: vi.fn() }));

// Three temperatures (levels of channel 1), two rows each; channel 0 is the signal.
const byData: Dataset = {
  id: "d1",
  name: "RSM series",
  data: {
    time: [0, 1, 0, 1, 0, 1],
    values: [[1, 30], [2, 30], [3, 10], [4, 10], [5, 20], [6, 20]],
    labels: ["signal", "T"],
    units: ["a.u.", "K"],
    metadata: {},
  },
  excludedRows: [1],
};

const doc = (groupKey: number | null, datasetId = "d1") =>
  createFigureDocument({
    id: "f1",
    name: "Sweep",
    datasetId,
    view: { ...defaultPlotView(), xKey: null, yKeys: [0] },
    groupKey,
  });

describe("planByLevelFrames", () => {
  it("makes one frame per level in ascending order, labelled with the By value and unit", () => {
    const { frames } = planByLevelFrames(doc(1), byData);
    expect(frames.map((f) => f.label)).toEqual(["T = 10 K", "T = 20 K", "T = 30 K"]);
    // Row state is applied before partitioning (row 1 is excluded) and not twice.
    expect(frames.map((f) => f.dataset.data.values.map((r) => r[0]))).toEqual([[3, 4], [5, 6], [1]]);
    expect(frames.every((f) => f.doc.bindings.groupKey === null)).toBe(true);
    expect(frames.every((f) => f.dataset.excludedRows === undefined)).toBe(true);
  });

  it("builds a PNG spec per frame whose data is that level only", () => {
    const wires = frameWires(planByLevelFrames(doc(1), byData), { format: "gif", frameMs: 200, loop: true, fixedAxes: true, filename: "a", dpi: 90 });
    expect(wires).toHaveLength(3);
    expect(wires[0].figure).toMatchObject({ fmt: "png", dpi: 90, y_keys: [0] });
    expect(wires[0].figure.dataset?.values).toEqual([[3, 10], [4, 10]]);
    expect(wires[2].label).toBe("T = 30 K");
  });

  it("refuses a figure without a By column, saying why", () => {
    expect(() => planByLevelFrames(doc(null), byData)).toThrow("no By column");
  });

  it("refuses more levels than the frame limit instead of truncating", () => {
    const n = MAX_ANIMATION_FRAMES + 1;
    const big: Dataset = {
      ...byData,
      excludedRows: undefined,
      data: { ...byData.data, time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, (_, i) => [i, i]) },
    };
    expect(() => planByLevelFrames(doc(1), big)).toThrow(`exceeds the limit of ${MAX_ANIMATION_FRAMES}`);
  });
});

describe("planDatasetFrames", () => {
  const ds = (id: string): Dataset => ({ ...byData, id, name: `${id}.csv`, excludedRows: undefined });

  it("binds the template to each dataset in order, labelled by name", () => {
    const { frames } = planDatasetFrames(doc(null), [ds("a"), ds("b"), ds("c")]);
    expect(frames.map((f) => f.label)).toEqual(["a.csv", "b.csv", "c.csv"]);
    expect(frames.map((f) => f.doc.bindings.datasetId)).toEqual(["a", "b", "c"]);
    expect(frameWires({ frames, totalLevels: 3 }, { format: "zip", frameMs: 100, loop: false, fixedAxes: false, filename: "x", dpi: 50 })).toHaveLength(3);
  });

  it("refuses an empty selection and an oversized one", () => {
    expect(() => planDatasetFrames(doc(null), [])).toThrow("at least one");
    const many = Array.from({ length: MAX_ANIMATION_FRAMES + 1 }, (_, i) => ds(`d${i}`));
    expect(() => planDatasetFrames(doc(null), many)).toThrow("exceeds the limit");
  });
});

describe("downloadAnimation", () => {
  it("sends the frames with the options to the animation route", async () => {
    const signal = new AbortController().signal;
    const options = { format: "apng" as const, frameMs: 300, loop: false, fixedAxes: true, filename: "talk", dpi: 80 };
    await downloadAnimation(planByLevelFrames(doc(1), byData), options, signal);
    const [frames, sent, sentSignal] = vi.mocked(exportFigureAnimation).mock.calls[0];
    expect(frames.map((f) => f.label)).toEqual(["T = 10 K", "T = 20 K", "T = 30 K"]);
    expect(sent).toMatchObject({ format: "apng", frameMs: 300, loop: false, fixedAxes: true });
    expect(sentSignal).toBe(signal);
  });
});
