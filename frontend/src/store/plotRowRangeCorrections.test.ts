// The production path of "a row-count change from outside": a correction trim through the real `applyCorrections` clears
// the plot's row window and the status line says so, after the guard's own message (never replacing it).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi } from "../lib/api";
import type { DataStruct } from "../lib/types";
import { setPlotRowRange } from "./plotRowRangeSet";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({ applyCorrections: vi.fn() }));
vi.mock("../lib/download", () => ({ saveBlob: vi.fn() }));

const raw: DataStruct = { time: [1, 2, 3, 4], values: [[10], [20], [30], [40]], labels: ["m"], units: ["emu"], metadata: {} };

beforeEach(() => {
  vi.resetAllMocks();
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw, excludedRows: [3] }], activeId: "d1", history: [], future: [], status: "" });
});

describe("plot row window through a correction trim", () => {
  it("is cleared when the trim changes the row count, with both messages on the status line", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...raw, time: [3, 4], values: [[30], [40]] });
    setPlotRowRange({ from: 1, to: 2 });
    await useApp.getState().applyCorrections("d1", { xTrimMin: 2.5 });
    expect(useApp.getState().rowRange).toBeUndefined();
    const status = useApp.getState().status;
    expect(status).toContain("Row exclusions cleared");
    expect(status).toContain("The plot row range (rows 2-3) was cleared");
  });

  it("keeps the window when the correction leaves the row count alone", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...raw, values: [[15], [25], [35], [45]] });
    setPlotRowRange({ from: 1, to: 2 });
    await useApp.getState().applyCorrections("d1", { yOff: 5 });
    expect(useApp.getState().rowRange).toEqual({ from: 1, to: 2 });
  });
});
