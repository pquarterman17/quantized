// The wizard's working segment reads its rows through the shared resolver
// (lib/analysisInputs), not on its own.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as analysisInputs from "../../../lib/analysisInputs";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { usePeakWizard } from "./usePeakWizard";

vi.mock("../../../lib/analysisInputs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/analysisInputs")>();
  return { ...actual, resolveAnalysisInputs: vi.fn((request: Parameters<typeof actual.resolveAnalysisInputs>[0]) => actual.resolveAnalysisInputs(request)) };
});

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5], values: [[1], [2], [3], [4], [5], [6]], labels: ["I"], units: [""], metadata: {},
};
const reset = (extra: Record<string, unknown> = {}) => {
  localStorage.clear();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan", data: DATA, ...extra }], activeId: "d1",
    xKey: null, yKeys: null, seriesOrder: null, peakOverlay: null, baselineOverlay: null, fitOverlay: null, peakWizardEdit: null,
  });
};

beforeEach(() => {
  vi.mocked(analysisInputs.resolveAnalysisInputs).mockClear();
  reset();
});

describe("usePeakWizard segment on the shared resolver", () => {
  it("reads the analysis rows through resolveAnalysisInputs", () => {
    const { result } = renderHook(() => usePeakWizard());
    expect(result.current.points).toBe(6);
    expect(analysisInputs.resolveAnalysisInputs).toHaveBeenCalled();
  });

  it("drops excluded rows (same rows as before)", () => {
    reset({ excludedRows: [1, 4] });
    const { result } = renderHook(() => usePeakWizard());
    expect(result.current.points).toBe(4);
  });

  it("drops Data Filter rows (same rows as before)", () => {
    reset({ filter: [{ col: 0, kind: "range", min: 3 }] });
    const { result } = renderHook(() => usePeakWizard());
    expect(result.current.points).toBe(4);
  });

  it("has no segment when every row is excluded (fail closed)", () => {
    reset({ excludedRows: [0, 1, 2, 3, 4, 5] });
    const { result } = renderHook(() => usePeakWizard());
    expect(result.current.points).toBe(0);
    expect(result.current.binding).toBeNull();
  });

  it("has no segment on a lazy preview", () => {
    reset({ pending: { kind: "upload", bookId: "b", rows: 6, cols: 1, previewSampled: true } });
    const { result } = renderHook(() => usePeakWizard());
    expect(result.current.points).toBe(0);
  });
});
