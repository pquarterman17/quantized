// Curve Fit window lifecycle (fitting-workflow audit #5, #17): closing the
// window only HIDES it — the fit's curve, its FitSpec (auto re-fit) and the
// result survive, and reopening shows the result again — while deleting a fit
// is the explicit, confirmed, undoable "Remove fit". The window opens docked
// at the right edge, clear of the plot's Y axis.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import type { DataStruct } from "../../../lib/types";
import { askConfirm } from "../../../store/confirmDialog";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";
import { retainFitted } from "./curveFitSession";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
}));
vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4],
  values: [[1], [3], [5], [7], [9]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  retainFitted(null, null);
  vi.mocked(listFitModels).mockResolvedValue({
    models: [{ name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] }],
  });
  vi.mocked(fitModel).mockResolvedValue({
    params: [2, 1], errors: [0.1, 0.2], R2: 0.98, RMSE: 0.5, chiSqRed: 0.3, nPoints: 5, nFree: 2,
    yFit: [1, 3, 5, 7, 9], residuals: [0, 0, 0, 0, 0],
  });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: [0],
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
    curveFitOpen: true,
    toolWindowLayout: {},
  });
});

async function fitOnce(): Promise<() => void> {
  const { unmount } = render(<CurveFitPanel />);
  fireEvent.click(await screen.findByRole("button", { name: "Fit" }));
  await screen.findByText("0.98");
  return unmount;
}

describe("CurveFitPanel — closing hides, Remove fit deletes", () => {
  it("closing keeps the curve, the FitSpec and the result; reopening shows the result", async () => {
    const unmount = await fitOnce();
    expect(useApp.getState().fitOverlay?.datasetId).toBe("d1");
    fireEvent.click(screen.getByRole("button", { name: "Close Curve Fit" }));
    expect(useApp.getState().curveFitOpen).toBe(false);
    // Before the fix close() called clear(): overlay null, fitSpec undefined.
    expect(useApp.getState().fitOverlay?.datasetId).toBe("d1");
    expect(useApp.getState().datasets[0]!.fitSpec?.model).toBe("Linear");

    // A remount (the panel reopened) shows the same result again.
    unmount();
    render(<CurveFitPanel />);
    expect(await screen.findByText("0.98")).toBeInTheDocument();
  });

  it("Remove fit asks first; a declined confirm removes nothing", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    await fitOnce();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove fit" }));
      await Promise.resolve();
    });
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(useApp.getState().datasets[0]!.fitSpec?.model).toBe("Linear");
    expect(useApp.getState().fitOverlay).not.toBeNull();
  });

  it("a confirmed Remove fit clears curve and FitSpec, and Undo brings the fit back", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    await fitOnce();
    fireEvent.click(screen.getByRole("button", { name: "Remove fit" }));
    await waitFor(() => expect(useApp.getState().datasets[0]!.fitSpec).toBeUndefined());
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(screen.queryByText("0.98")).toBeNull();
    useApp.getState().undo();
    expect(useApp.getState().datasets[0]!.fitSpec?.model).toBe("Linear");
  });
});

describe("CurveFitPanel — window placement and key results", () => {
  it("opens docked at the right edge, not over the plot's Y axis", async () => {
    render(<CurveFitPanel />);
    const frame = await screen.findByRole("dialog");
    expect(parseFloat(frame.style.left)).toBe(window.innerWidth - 340 - 16);
  });

  it("shows N and reduced χ² with the headline statistics", async () => {
    await fitOnce();
    expect(screen.getByText("reduced χ²")).toBeInTheDocument();
    expect(screen.getByText("N")).toBeInTheDocument();
    expect(screen.getByText("0.3")).toBeInTheDocument();
  });
});
