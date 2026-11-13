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
import { retainFitted } from "../../../store/curveFitSession";

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
    analysisResults: [],
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

  it("Undo of Remove fit restores the curve and the panel's result at once; Redo removes them again", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    await fitOnce();
    const curve = useApp.getState().fitOverlay;
    fireEvent.click(screen.getByRole("button", { name: "Remove fit" }));
    await waitFor(() => expect(useApp.getState().datasets[0]!.fitSpec).toBeUndefined());
    act(() => useApp.getState().undo());
    // Before the fix the FitSpec came back but the curve stayed gone and the
    // panel stayed empty until the Library result was reopened.
    expect(useApp.getState().fitOverlay).toEqual(curve);
    expect(await screen.findByText("0.98")).toBeInTheDocument();
    act(() => useApp.getState().redo());
    expect(useApp.getState().datasets[0]!.fitSpec).toBeUndefined();
    expect(useApp.getState().fitOverlay).toBeNull();
    await waitFor(() => expect(screen.queryByText("0.98")).toBeNull());
    act(() => useApp.getState().undo());
    expect(useApp.getState().fitOverlay).toEqual(curve);
    expect(await screen.findByText("0.98")).toBeInTheDocument();
  });

  it("Undo of Remove fit restores the curve while the window is closed; reopening shows the result", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    const unmount = await fitOnce();
    const curve = useApp.getState().fitOverlay;
    fireEvent.click(screen.getByRole("button", { name: "Remove fit" }));
    await waitFor(() => expect(useApp.getState().datasets[0]!.fitSpec).toBeUndefined());
    unmount();
    act(() => useApp.getState().undo());
    expect(useApp.getState().fitOverlay).toEqual(curve);
    render(<CurveFitPanel />);
    expect(await screen.findByText("0.98")).toBeInTheDocument();
  });

  it("Remove fit deletes the fit's Library result, as its confirmation says, and Undo restores it", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    await fitOnce();
    const results = useApp.getState().analysisResults;
    expect(results).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove fit" }));
    await waitFor(() => expect(useApp.getState().datasets[0]!.fitSpec).toBeUndefined());
    // Before the fix the result stayed in the Library as "Incomplete".
    expect(useApp.getState().analysisResults).toEqual([]);
    act(() => useApp.getState().undo());
    expect(useApp.getState().analysisResults).toEqual(results);
  });
});

describe("CurveFitPanel — one retained fit per worksheet", () => {
  const SECOND = { ...DATA, values: [[2], [4], [6], [8], [10]] };

  it("going back to a worksheet fitted earlier shows its result and draws its curve again", async () => {
    await fitOnce();
    const first = useApp.getState().fitOverlay;
    // A second worksheet, fitted in the same panel.
    act(() => useApp.setState((s) => ({ datasets: [...s.datasets, { id: "d2", name: "second.dat", data: SECOND }], activeId: "d2", fitOverlay: null })));
    vi.mocked(fitModel).mockResolvedValueOnce({
      params: [2, 2], errors: [0.1, 0.2], R2: 0.55, RMSE: 0.5, chiSqRed: 0.3, nPoints: 5, nFree: 2,
      yFit: [2, 4, 6, 8, 10], residuals: [0, 0, 0, 0, 0],
    });
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(await screen.findByText("0.55")).toBeInTheDocument();
    // Back to the first (a dataset switch clears the drawn curve).
    act(() => useApp.setState({ activeId: "d1", fitOverlay: null }));
    // Before the fix: an empty panel and no curve — the second fit had
    // replaced the only retained result.
    expect(await screen.findByText("0.98")).toBeInTheDocument();
    expect(screen.queryByText("0.55")).toBeNull();
    await waitFor(() => expect(useApp.getState().fitOverlay).toEqual(first));
    // And the second worksheet's is still there.
    act(() => useApp.setState({ activeId: "d2", fitOverlay: null }));
    expect(await screen.findByText("0.55")).toBeInTheDocument();
    await waitFor(() => expect(useApp.getState().fitOverlay?.datasetId).toBe("d2"));
  });

  it("does not draw a retained curve the data has moved away from", async () => {
    await fitOnce();
    const before = useApp.getState().datasets[0]!;
    const edited = { ...before, data: { ...before.data, values: before.data.values.map((r, i) => (i === 2 ? [50] : r)) } };
    act(() => useApp.setState({ datasets: [edited], fitOverlay: null }));
    expect(screen.getByText(/The data selected for fitting changed after this fit/)).toBeInTheDocument();
    expect(useApp.getState().fitOverlay).toBeNull();
  });
});

describe("CurveFitPanel — a result whose data changed", () => {
  const NOTE = /The data selected for fitting changed after this fit/;

  it("is marked until it is re-fitted, and an added column alone does not mark it", async () => {
    await fitOnce();
    expect(screen.queryByText(NOTE)).toBeNull();
    // A new column (the fit's own linked output, say) replaces the data object
    // but not the fitted pairs.
    const before = useApp.getState().datasets[0]!;
    const widened = { ...before.data, values: before.data.values.map((r) => [...r, 0]), labels: ["y", "y fit"], units: ["", ""] };
    act(() => useApp.setState({ datasets: [{ ...before, data: widened }] }));
    expect(screen.queryByText(NOTE)).toBeNull();
    // An edited value: the numbers shown are for the earlier data (recalc may
    // be off, or the re-fit may have failed) — say so.
    const edited = { ...widened, values: widened.values.map((r, i) => (i === 2 ? [50, 0] : r)) };
    act(() => useApp.setState({ datasets: [{ ...before, data: edited }] }));
    expect(screen.getByText(NOTE)).toBeInTheDocument();
  });

  it("comes back on reopen after a column was added to the worksheet", async () => {
    const unmount = await fitOnce();
    unmount();
    const before = useApp.getState().datasets[0]!;
    const widened = { ...before.data, values: before.data.values.map((r) => [...r, 0]), labels: ["y", "y fit"], units: ["", ""] };
    act(() => useApp.setState({ datasets: [{ ...before, data: widened }] }));
    render(<CurveFitPanel />);
    // Before the fix: an empty panel beside the curve (the data object changed).
    expect(await screen.findByText("0.98")).toBeInTheDocument();
  });
});

describe("CurveFitPanel — a background re-fit", () => {
  const REFIT = {
    params: [3, 0.5], errors: [0.3, 0.4], R2: 0.75, RMSE: 0.9, chiSqRed: 0.6, nPoints: 5, nFree: 2,
    yFit: [0.5, 3.5, 6.5, 9.5, 12.5], residuals: [0.5, -0.5, 0.5, -0.5, 0.5],
  };
  /** Edit the worksheet, then land the recalc graph's re-fit of its saved fit. */
  async function refitAfterEdit(): Promise<void> {
    const { commitRecomputedFit } = await import("../../../lib/fitRecompute");
    const { dropGapRows } = await import("../../../lib/api/finitePairs");
    const before = useApp.getState().datasets[0]!;
    const edited = { ...before, data: { ...before.data, values: [[1], [3], [6], [10], [13]] } };
    act(() => useApp.setState({ datasets: [edited] }));
    const pairs = dropGapRows(edited.data.time, edited.data.values.map((r) => r[0]!));
    act(() => commitRecomputedFit(useApp.setState, useApp.getState, edited, edited.fitSpec!, pairs, REFIT));
  }

  it("is followed by the open panel: no original-fit numbers beside the re-fitted curve", async () => {
    await fitOnce();
    await refitAfterEdit();
    // Before the fix the panel kept showing R² 0.98 (the fit of the old data).
    expect(await screen.findByText("0.75")).toBeInTheDocument();
    expect(screen.queryByText("0.98")).toBeNull();
    expect(useApp.getState().fitOverlay?.y).toEqual(REFIT.yFit);
  });

  it("is what a reopened panel shows", async () => {
    const unmount = await fitOnce();
    unmount();
    await refitAfterEdit();
    render(<CurveFitPanel />);
    expect(await screen.findByText("0.75")).toBeInTheDocument();
  });

  it("of another tool's fit on the worksheet is not adopted", async () => {
    await fitOnce();
    const { commitRecomputedFit } = await import("../../../lib/fitRecompute");
    const { dropGapRows } = await import("../../../lib/api/finitePairs");
    const other = { ...useApp.getState().datasets[0]!, fitSpec: { model: "Linear", params: [9, 9] } };
    act(() => useApp.setState({ datasets: [other] }));
    const pairs = dropGapRows(other.data.time, other.data.values.map((r) => r[0]!));
    act(() => commitRecomputedFit(useApp.setState, useApp.getState, other, other.fitSpec, pairs, REFIT));
    expect(screen.queryByText("0.75")).toBeNull();
    expect(screen.getByText("0.98")).toBeInTheDocument();
  });
});

describe("CurveFitPanel — window placement and key results", () => {
  it("opens docked at the right edge, not over the plot's Y axis", async () => {
    render(<CurveFitPanel />);
    const frame = await screen.findByRole("dialog");
    expect(parseFloat(frame.style.left)).toBe(window.innerWidth - 340 - 16);
  });

  it("reports a finished fit in the status line", async () => {
    useApp.setState({ status: 'applied fit template "t" — press Fit to run it' });
    await fitOnce();
    // Before the fix the earlier message stayed after the fit had run.
    expect(useApp.getState().status).toBe("fitted Linear to run.dat");
  });

  it("shows N and reduced χ² with the headline statistics", async () => {
    await fitOnce();
    expect(screen.getByText("reduced χ²")).toBeInTheDocument();
    expect(screen.getByText("N")).toBeInTheDocument();
    expect(screen.getByText("0.3")).toBeInTheDocument();
  });
});
