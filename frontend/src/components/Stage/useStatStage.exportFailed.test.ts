// Export waits for a pending draw (useStatStageExport) — so the wait must also
// END when that compute fails, or when the current picks have no draw at all.
// Each test holds the stage's compute promise open, then REJECTS it mid-wait,
// and asserts the export settles with the stage's error and posts nothing.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox } from "../../lib/api";
import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import type { DataStruct, Dataset } from "../../lib/types";
import { usePendingOps } from "../../store/pendingOps";
import { useStatStage } from "./useStatStage";
import { computeBoxDraw, computeFacetGroupDraws } from "./useStatStageCompute";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));
vi.mock("./useStatStageCompute", async (importOriginal) => {
  const real = await importOriginal<typeof import("./useStatStageCompute")>();
  return { ...real, computeBoxDraw: vi.fn(real.computeBoxDraw), computeFacetGroupDraws: vi.fn(real.computeFacetGroupDraws) };
});

// grp: A/B, fac: X/Y, y: values, empty: all NaN (groups to nothing).
const N = Number.NaN;
const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[0, 0, 1, N], [0, 1, 2, N], [1, 0, 3, N], [1, 1, 4, N]],
  labels: ["grp", "fac", "y", "empty"],
  units: ["", "", "", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B"], 1: ["X", "Y"] },
};
const DS: Dataset = { id: "failed", name: "failed.csv", data: DATA };

let fail: (e: Error) => void = () => {};
function held<T>(): Promise<T> {
  return new Promise<T>((_, reject) => {
    fail = reject;
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const real = await vi.importActual<typeof import("./useStatStageCompute")>("./useStatStageCompute");
  vi.mocked(computeBoxDraw).mockImplementation(real.computeBoxDraw);
  vi.mocked(computeFacetGroupDraws).mockImplementation(real.computeFacetGroupDraws);
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

async function settledStage() {
  const hook = renderHook(() =>
    useStatStage({ active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} }),
  );
  await waitFor(() => {
    const d = hook.result.current.draw;
    expect(d?.mode === "box" && d.slots != null).toBe(true);
  });
  return hook;
}

function startExport(run: () => Promise<boolean>): Promise<boolean> {
  let p!: Promise<boolean>;
  act(() => {
    p = run();
  });
  return p;
}

describe("Stat Stage export when the pending compute fails", () => {
  it("box: a rejected compute ends the wait with the stage's error, exporting nothing", async () => {
    const { result } = await settledStage();
    vi.mocked(computeBoxDraw).mockImplementationOnce(() => held());
    act(() => result.current.setGroupCol(1));
    const p = startExport(() => result.current.exportFigure("svg"));
    const settled = p.then(() => "resolved", (e: Error) => e.message);
    await act(async () => fail(new Error("box stats exploded")));
    expect(await settled).toBe("box stats exploded");
    expect(result.current.error).toBe("box stats exploded");
    expect(result.current.draw).toBeNull();
    expect(exportStatplotFigure).not.toHaveBeenCalled();
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("faceted: a rejected facet compute ends the wait too", async () => {
    const { result } = await settledStage();
    vi.mocked(computeFacetGroupDraws).mockImplementationOnce(() => held());
    act(() => result.current.setFacetCol(1));
    const p = startExport(() => result.current.exportFigure("svg"));
    const settled = p.then(() => "resolved", (e: Error) => e.message);
    await act(async () => fail(new Error("facet stats exploded")));
    expect(await settled).toBe("facet stats exploded");
    expect(result.current.drawFacets).toBeNull();
    expect(exportStatplotFigure).not.toHaveBeenCalled();
  });

  it("no draw for the current picks (every group empty): settles with that error, exports nothing", async () => {
    const { result } = await settledStage();
    act(() => result.current.setValueCol(3));
    expect(result.current.error).toBe("no finite values to group");
    let msg = "";
    await act(async () => {
      msg = await result.current.exportFigure("svg").then(() => "resolved", (e: Error) => e.message);
    });
    expect(msg).toBe("no finite values to group");
    expect(exportStatplotFigure).not.toHaveBeenCalled();
  });
});
