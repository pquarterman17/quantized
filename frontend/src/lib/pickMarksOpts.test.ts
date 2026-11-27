// Item 22: which chart builds carry the Pick markers. Under the Pick tool the
// pick plugin draws them; under any other tool they ride along only while the
// pick list is non-empty (so a chart with no picks builds exactly as before).

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadToolPlugins } from "./axisExtrasHook";
import type { PlotPayload } from "./plotdata";
import { usePickedPoints } from "../store/pickedPoints";
import { buildOpts } from "./uplotOpts";

const payload: PlotPayload = { data: [[0, 1, 2], [10, 20, 30]], series: [{ label: "M", unit: "emu" }], xLabel: "Field", xUnit: "Oe" };
const base = { width: 600, height: 400, xScale: "linear" as const, yScale: "linear" as const, onReadout: vi.fn() };
const pt = { datasetId: "a", datasetName: "A", row: 1, xKey: null, yKey: 0, x: 1, y: 20, xLabel: "X", yLabel: "Y" };

afterEach(() => usePickedPoints.getState().clear());

describe("buildOpts and the Pick markers", () => {
  it("adds the markers under another tool only while something is picked", async () => {
    await loadToolPlugins();
    expect(buildOpts(payload, { ...base, tool: "zoom" }).plugins).toHaveLength(0);
    usePickedPoints.getState().add(pt);
    expect(buildOpts(payload, { ...base, tool: "zoom" }).plugins).toHaveLength(1);
    expect(buildOpts(payload, { ...base, tool: "lasso", onLasso: vi.fn() }).plugins).toHaveLength(2); // the lasso's own, plus the markers
    usePickedPoints.getState().clear();
    expect(buildOpts(payload, { ...base, tool: "zoom" }).plugins).toHaveLength(0);
  });
  it("gives the pick tool one plugin (it draws the markers itself), from its OWN callback, never the lasso's", async () => {
    await loadToolPlugins();
    usePickedPoints.getState().add(pt);
    const onLasso = vi.fn();
    const onPick = vi.fn();
    const plugins = buildOpts(payload, { ...base, tool: "pick", onLasso, onPick }).plugins ?? [];
    expect(plugins).toHaveLength(1);
    // Without its own callback the pick tool installs no click handler (only the markers): the lasso's is never borrowed.
    expect(buildOpts(payload, { ...base, tool: "pick", onLasso }).plugins ?? []).toHaveLength(1);
    usePickedPoints.getState().clear();
    expect(buildOpts(payload, { ...base, tool: "pick", onLasso }).plugins ?? []).toHaveLength(0);
    expect(onLasso).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
});
