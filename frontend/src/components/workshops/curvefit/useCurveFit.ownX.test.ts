// Fitting R2 on a T1,R1,T2,R2 sheet fits against T2 AND records T2 as the fit's
// X: the recorded xKey is what the fit bands, the output worksheet's X column
// and "open fitted plot" later read, so a recorded T1 would evaluate the model
// at the wrong abscissae.
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import { R2, T2, t1r1t2r2 } from "../../../test/ownXFixture";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { useCurveFit } from "./useCurveFit";

vi.mock("../../../lib/api", () => ({ fitModel: vi.fn(), fetchBookData: vi.fn() }));
vi.mock("../../../lib/api/curvefit", () => ({ autoGuess: vi.fn(), listFitModels: vi.fn(), bootstrapFit: vi.fn() }));
vi.mock("../../../lib/api/figures", () => ({ exportCornerFigure: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [] });
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({
    datasets: [t1r1t2r2()], activeId: "own", xKey: null, yKeys: [2], seriesOrder: null, errKeys: {},
    analysisResults: [], fitOverlay: null,
  });
});

describe("useCurveFit on a secondary-X Y", () => {
  it("fits R2 against T2 and records T2 (channel 1) in the result and the FitSpec", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [1], yFit: R2 });
    const { result } = renderHook(() => useCurveFit());
    await act(async () => {
      await result.current.run("fit");
    });
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: T2, y: R2 });
    expect(useApp.getState().datasets[0].fitSpec).toMatchObject({ xKey: 1, yKey: 2 });
    // The shown result still matches the live plot (R2 against its own X).
    expect(result.current.fitData).toMatchObject({ xKey: 1, yKey: 2, x: T2 });
  });
});
