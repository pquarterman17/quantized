// The stage's exporter as the app's figure commands call it (lib/statStageBridge.ts):
// the caller's style / DPI ride the request, `out.deliver` receives it instead
// of a download, and a caller's own signal replaces the stage's StatusBar op.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportStatplotFigure } from "../../lib/api/figures";
import type { StatStageRequest } from "../../lib/statStageBridge";
import type { DataStruct } from "../../lib/types";
import { usePendingOps } from "../../store/pendingOps";
import type { StatStageExportInputs } from "./statStageExport";
import { useStatStageExport } from "./useStatStageExport";

vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3], values: [[1], [2], [3], [5]], labels: ["y"], units: [""], metadata: {},
};
const INPUTS: StatStageExportInputs = {
  data: DATA, mode: "qq", draw: null, drawFacets: null, groups: [], indexedGroups: [], valueCol: 0,
  valueLabel: "y", groupLabel: "", barValueLabel: "y", barStack: false, dist: "norm", bins: "auto", fit: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  usePendingOps.setState({ ops: [] });
});

describe("useStatStageExport for the app's figure commands", () => {
  it("delivers the request with the caller's style and DPI instead of downloading it", async () => {
    const { result } = renderHook(() => useStatStageExport(false, INPUTS));
    const got: StatStageRequest[] = [];
    const done = await result.current("png", { style: "aps", dpi: 300, deliver: async (r) => void got.push(r) });
    expect(done).toBe(true);
    expect(exportStatplotFigure).not.toHaveBeenCalled();
    expect(got).toHaveLength(1);
    expect(got[0].route).toBe("statplot");
    expect(got[0].spec).toMatchObject({ kind: "qq", fmt: "png", style: "aps", dpi: 300 });
  });

  it("with no `out`, downloads the request as the stage's own button does", async () => {
    const { result } = renderHook(() => useStatStageExport(false, INPUTS));
    await result.current("pdf");
    expect(exportStatplotFigure).toHaveBeenCalledTimes(1);
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec).toMatchObject({ kind: "qq", fmt: "pdf" });
    expect(spec).not.toHaveProperty("style");
    expect(spec).not.toHaveProperty("dpi");
  });

  it("runs under the caller's signal, opening no StatusBar op of its own", async () => {
    const { result } = renderHook(() => useStatStageExport(false, INPUTS));
    let opsWhileRendering = -1;
    await result.current("png", {
      signal: new AbortController().signal,
      deliver: async () => {
        opsWhileRendering = usePendingOps.getState().ops.length;
      },
    });
    expect(opsWhileRendering).toBe(0);
  });
});
