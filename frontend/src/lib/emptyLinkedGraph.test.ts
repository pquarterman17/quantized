// A live graph with no resolvable curve (deleted sources, a cycle, all -1) has
// labels but no rows. The server answers that with 422, so the client must not
// send it: the plot fetch uses the offline builder, the export refuses with the
// reason, and the stage says why it is empty.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildStageFigureSpec } from "./figureSpecStage";
import { emptyGraphReason, NO_CURVES_REASON } from "./linkedCurves";
import { fetchPlot } from "./plotdata";
import type { Dataset } from "./types";
import { useApp } from "../store/useApp";

const post = vi.hoisted(() => vi.fn());
vi.mock("./api/plot", async (orig) => ({ ...(await orig<typeof import("./api/plot")>()), plotSeries: post }));

const empty: Dataset = {
  id: "g",
  name: "Graph1",
  data: { time: [], values: [], labels: ["A", "B"], units: ["", ""], metadata: {} },
  linkedCurves: [
    { datasetId: "", xKey: null, yKey: -1, label: "A" },
    { datasetId: "gone", xKey: null, yKey: -1, label: "B" },
  ],
};

beforeEach(() => {
  post.mockReset().mockRejectedValue(new Error("422"));
});

describe("an empty live graph", () => {
  it("fetchPlot never calls /api/plot/series and returns an empty payload", async () => {
    const p = await fetchPlot(empty.data, false);
    expect(post).not.toHaveBeenCalled();
    expect(p.data[0]).toEqual([]);
  });
  it("names why it is empty (and only for a graph)", () => {
    expect(emptyGraphReason(empty)).toBe(NO_CURVES_REASON);
    expect(emptyGraphReason({ data: empty.data })).toBeNull();
    expect(emptyGraphReason({ ...empty, data: { ...empty.data, time: [1], values: [[1, 2]] } })).toBeNull();
  });
  it("figure export refuses with the reason instead of building a request", () => {
    useApp.setState({ datasets: [empty] });
    expect(() => buildStageFigureSpec(useApp.getState, empty, "g", {} as never)).toThrow(NO_CURVES_REASON);
  });
});
