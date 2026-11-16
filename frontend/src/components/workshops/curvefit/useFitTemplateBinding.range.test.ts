// A fit template saves a range the user CHOSE (dragged, a Live-fit band, a
// template's own), never the automatic visible-x range -- that is only where
// the plot happened to be zoomed when the template was saved (UX8-D review).

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureAnalysisSelection, type AnalysisRangeSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useFitTemplateBinding } from "./useFitTemplateBinding";

const DS: Dataset = {
  id: "d1",
  name: "run",
  data: { time: [1, 2, 3], values: [[1], [2], [3]], labels: ["y"], units: [""], metadata: {} },
};

function withRange(range: AnalysisRangeSelection | null) {
  const selection = captureAnalysisSelection(
    { datasets: [DS], activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null, range },
    "tool-default",
  );
  useAnalysisSelection.setState({ toolId: "curvefit", selection });
}

const settings = () => ({
  active: DS, models: [], modelName: "Linear", setModelName: vi.fn(), weightMode: "none" as const, setWeightMode: vi.fn(),
  manualKey: null, setManualKey: vi.fn(), scaleErrors: true, setScaleErrors: vi.fn(), paramRows: [], replaceParamRows: vi.fn(),
});

beforeEach(() => useAnalysisSelection.getState().clear());

describe("fit templates and the automatic fit range", () => {
  it("do not capture the visible-x range", () => {
    withRange({ lo: 1, hi: 2, source: "visible x range" });
    const { result } = renderHook(() => useFitTemplateBinding(settings()));
    expect(result.current.current.range).toBeUndefined();
  });

  it("capture a range the user chose", () => {
    for (const source of ["dragged", "gadget region", "manual"] as const) {
      withRange({ lo: 1, hi: 2, source });
      const { result } = renderHook(() => useFitTemplateBinding(settings()));
      expect(result.current.current.range).toEqual({ lo: 1, hi: 2 });
    }
  });
});
