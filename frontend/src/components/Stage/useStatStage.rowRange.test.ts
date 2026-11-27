// The statistics stage honours the plot's row window (ROW_RANGE_CONTRACT 3.3, item 31): it reads the analysis view
// narrowed to the window's SOURCE rows, on screen and in the export it sends.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import { statsBox, statsViolin } from "../../lib/api";
import type { DataStruct, Dataset } from "../../lib/types";
import type { StatDrawData } from "./statRender";
import { useStatStage, type UseStatStageParams } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
  statsViolin: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));

// Channel 0 a 2-level group, channel 1 the value: rows 0-2 and 6-8 are group 0, rows 3-5 and 9-11 group 1.
const DATA: DataStruct = {
  time: Array.from({ length: 12 }, (_, i) => i),
  values: [[0, 10], [0, 12], [0, 14], [1, 30], [1, 32], [1, 34], [0, 110], [0, 112], [0, 114], [1, 130], [1, 132], [1, 134]],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
};
const DS: Dataset = { id: "d1", name: "run.dat", data: DATA };
const params = (o: Partial<UseStatStageParams> = {}): UseStatStageParams => ({
  active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: vi.fn(), ...o,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  vi.mocked(statsViolin).mockImplementation(() => new Promise(() => {}));
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

const pointRows = (d: StatDrawData | null) => {
  if (d?.mode !== "box" && d?.mode !== "strip") throw new Error("expected a box/strip draw");
  return (d.points ?? []).map((g) => g.points.map((p) => p.rowIndex));
};

async function mount(over: Partial<UseStatStageParams>) {
  const hook = renderHook((p: UseStatStageParams) => useStatStage(p), { initialProps: params(over) });
  act(() => hook.result.current.setMode("box"));
  act(() => hook.result.current.setMarks({ points: "all" }));
  return hook;
}

describe("useStatStage under a plot row window", () => {
  it("draws only the window's rows, keeping their SOURCE row numbers, and exports the same rows", async () => {
    const { result } = await mount({ rowRange: { from: 6, to: 11 } });
    await waitFor(() => expect(pointRows(result.current.draw)).toEqual([[6, 7, 8], [9, 10, 11]]));
    await act(async () => { await result.current.exportFigure("svg"); });
    expect(vi.mocked(exportStatplotFigure).mock.calls[0][0].point_row_indices).toEqual([[6, 7, 8], [9, 10, 11]]);
  });

  it("applies the window first, then the exclusions: an excluded row inside it drops, with the others' rows unchanged", async () => {
    const { result } = await mount({ rowRange: { from: 3, to: 8 }, active: { ...DS, excludedRows: [4, 10] } });
    await waitFor(() => expect(pointRows(result.current.draw)).toEqual([[6, 7, 8], [3, 5]]));
  });

  it("draws every row without a window, and with one that does not fit the sheet (never clamped)", async () => {
    const all = [[0, 1, 2, 6, 7, 8], [3, 4, 5, 9, 10, 11]];
    const none = await mount({});
    await waitFor(() => expect(pointRows(none.result.current.draw)).toEqual(all));
    const unfit = await mount({ rowRange: { from: 6, to: 99 } });
    await waitFor(() => expect(pointRows(unfit.result.current.draw)).toEqual(all));
  });
});
