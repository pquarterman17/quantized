// JMP_GAP J5 residual (closed 2026-09-29): the Graph Builder preview PAINTS
// the window's categorical marks. The canvases are invisible to jsdom, so the
// painters are stubbed and this pins what they are handed: the flat canvas'
// draw and every facet cell's draw carry the store's `statMarks` for the
// spec's mode and the points they need (`./previewMarks` pins the rows).

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { specToRender, type PlotSpec } from "../../../lib/plotspec";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import type { StatDrawData } from "../../Stage/statRender";
import GraphPreview from "./GraphPreview";

const cells: StatDrawData[] = [];
const flat: StatDrawData[] = [];
vi.mock("../../Stage/StatStageCanvas", () => ({
  default: ({ data }: { data: StatDrawData }) => {
    cells.push(data);
    return null;
  },
}));
vi.mock("../../Stage/statRender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../Stage/statRender")>()),
  draw: (_c: unknown, _h: unknown, d: StatDrawData) => flat.push(d),
}));

const ROWS = [[0, 0, 1], [0, 1, 2], [0, 0, 3], [1, 1, 10], [1, 0, 11], [1, 1, 12]];
const DS: Dataset = {
  id: "gm",
  name: "gm.csv",
  data: {
    time: ROWS.map((_, i) => i), values: ROWS, labels: ["lot", "wafer", "y"], units: ["", "", ""], metadata: {},
    cat_levels: { 0: ["L1", "L2"], 1: ["W1", "W2"] },
  },
};
const ref = (channel: number) => ({ datasetId: "gm", channel });
const spec = (mark: PlotSpec["mark"], facet: boolean): PlotSpec => ({
  version: 1,
  zones: { x: ref(0), y: [ref(2)], group: null, facet: facet ? ref(1) : null, yErr: [], xErr: null },
  mark,
});

beforeEach(() => {
  cells.length = 0;
  flat.length = 0;
  useApp.setState({ datasets: [DS], statMarks: { box: { points: "all", summary: "mean" }, bar: { points: "all" } } });
});

describe("GraphPreview — categorical marks reach the painters", () => {
  it("flat box: the canvas is handed the box marks and every point", () => {
    const s = spec("box", false);
    render(<GraphPreview render={specToRender(s, [DS])} spec={s} />);
    const d = flat.at(-1);
    if (d?.mode !== "box") throw new Error("expected a box draw");
    expect(d.marks).toMatchObject({ points: "all", summary: "mean" });
    expect(d.points?.map((g) => g.points.map((p) => p.rowIndex))).toEqual([[0, 1, 2], [3, 4, 5]]);
  });

  it("faceted bar: every cell is handed its own marked, raw-carrying draw", () => {
    const s = spec("bar", true);
    render(<GraphPreview render={specToRender(s, [DS])} spec={s} />);
    expect(cells).toHaveLength(2);
    for (const d of cells) {
      if (d.mode !== "bar") throw new Error("expected bar cells");
      expect(d.marks?.points).toBe("all");
      expect(d.data.groups.every((g) => g.series[0].raw != null)).toBe(true);
    }
  });

  it("without a spec the preview paints the unmarked draw it always did", () => {
    const s = spec("box", false);
    render(<GraphPreview render={specToRender(s, [DS])} />);
    const d = flat.at(-1);
    expect(d && "marks" in d ? d.marks : undefined).toBeUndefined();
  });
});
