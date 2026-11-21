import { describe, expect, it } from "vitest";

import { FIGURE_MARK_PREFIX, originDataMarkPatch, originDataMarkShapes } from "./originDataMarks";
import type { OriginFigure, Shape } from "./types";

const fig = (marks: OriginFigure["data_marks"]): OriginFigure => ({ name: "G", data_marks: marks }) as OriginFigure;
const own: Shape = { id: "shape-1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 };

describe("originDataMarkShapes", () => {
  it("turns marks into data-anchored shapes and keeps the user's own", () => {
    const out = originDataMarkShapes(
      [own],
      fig([
        { kind: "rect", x1: 0.8, y1: 0.9, x2: 1.2, y2: 1.1 },
        { kind: "arrow", x1: 0, y1: 1, x2: 2, y2: 1, stroke: "#000000", width: 0.5 },
      ]),
      "k",
    );
    expect(out[0]).toBe(own);
    expect(out.slice(1)).toEqual([
      { id: `${FIGURE_MARK_PREFIX}k-0`, kind: "rect", x1: 0.8, y1: 0.9, x2: 1.2, y2: 1.1, anchor: "data" },
      { id: `${FIGURE_MARK_PREFIX}k-1`, kind: "arrow", x1: 0, y1: 1, x2: 2, y2: 1, anchor: "data", stroke: "#000000", width: 0.5 },
    ]);
  });

  it("replaces an earlier figure's marks, and a figure with none clears them", () => {
    const first = originDataMarkShapes([own], fig([{ kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 }]), "a");
    expect(first).toHaveLength(2);
    const next = originDataMarkShapes(first, fig([{ kind: "rect", x1: 0, y1: 0, x2: 2, y2: 2 }]), "b");
    expect(next.map((s) => s.id)).toEqual(["shape-1", `${FIGURE_MARK_PREFIX}b-0`]);
    expect(originDataMarkShapes(first, fig(undefined), "c")).toEqual([own]);
  });

  it("adds no `shapes` key to the apply patch unless there is something to change", () => {
    expect(originDataMarkPatch([own], fig(undefined), "k")).toEqual({});
    const marked = originDataMarkPatch([own], fig([{ kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 }]), "k");
    expect(marked.shapes).toHaveLength(2);
    expect(originDataMarkPatch(marked.shapes ?? [], fig(undefined), "k")).toEqual({ shapes: [own] });
  });

  it("skips a mark with a non-finite end instead of guessing", () => {
    const out = originDataMarkShapes([], fig([{ kind: "arrow", x1: 0, y1: 0, x2: Number.NaN, y2: 1 }]), "k");
    expect(out).toEqual([]);
  });
});
