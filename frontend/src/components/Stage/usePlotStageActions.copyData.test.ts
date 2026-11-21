// "Copy data" with a display fit / lean baseline loads lib/copyPlotData; a
// failure inside it reports a danger status instead of an unhandled rejection.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import type { BaselineOverlay } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { SINGLE_X } from "../../test/overlayBinding";
import { usePlotStageActions } from "./usePlotStageActions";

vi.mock("../../lib/copyPlotData", () => ({ plotDataTSV: () => Promise.reject(new Error("fetch failed")) }));

const PAYLOAD = { data: [[0, 1], [1, 2]], series: [{ label: "y", unit: "" }], xLabel: "x", xUnit: "" } as unknown as PlotPayload;

beforeEach(() => useApp.setState({ status: "", fitOverlay: null, baselineOverlay: null }));

describe("copyData", () => {
  it("reports a failure of the full-curve copy instead of rejecting unhandled", async () => {
    const lean: BaselineOverlay = { datasetId: "d1", binding: SINGLE_X, y: [1, 2], lean: true };
    useApp.setState({ baselineOverlay: lean });
    const a = renderHook(() => usePlotStageActions({ current: null }, PAYLOAD, null)).result.current;
    a.copyData();
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/copy data failed: fetch failed/));
  });
});
