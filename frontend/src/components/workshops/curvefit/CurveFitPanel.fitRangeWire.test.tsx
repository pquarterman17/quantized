// Acceptance defect D1: the panel said "60 of 101 rows" and "(visible x range)"
// while the request fitted all 101. Through the REAL path (panel + stores + the
// by-handle request the app sends once the server holds the worksheet), the
// rows on the wire must be the rows the summary states, for a visible, a
// dragged and an Axes-limits range alike.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rememberHandle } from "../../../lib/api/datasetCache";
import { listFitModels } from "../../../lib/api/curvefit";
import type { Dataset } from "../../../lib/types";
import { gatherRows } from "../../../test/gatherRows";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { registerLayoutTool, resetLayoutToolsForTests } from "../../../store/layoutTools";
import { toolBusyChanged } from "../../../store/layoutToolActions";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
}));

const X = Array.from({ length: 101 }, (_, i) => i / 10); // 0..10
const Y = X.map((x) => 2 + 1.5 * x + (x > 8 ? 5 : 0));
const DS: Dataset = {
  id: "d1", name: "fitj.csv",
  data: { time: X, values: Y.map((y) => [y]), labels: ["y"], units: [""], metadata: {} },
};

let fetchMock: ReturnType<typeof vi.fn>;
const fitCalls = () => fetchMock.mock.calls.filter(([p]) => p === "/api/fitting/fit");
const fitBody = (): Record<string, unknown> => JSON.parse(String(fitCalls().at(-1)![1].body));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({
    models: [
      { name: "Linear", category: "Linear", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] },
      { name: "Lorentzian", category: "Peak", paramNames: ["A", "x0", "g"], nParams: 3, p0: [1, 0, 1], lb: [], ub: [] },
    ],
  });
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ params: [1.5, 2], yFit: [] }), {
    status: 200, headers: { "Content-Type": "application/json", "X-Dataset-Handle": "h1" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  useAnalysisSelection.getState().clear();
  useApp.setState({
    datasets: [DS], activeId: "d1", xKey: null, yKeys: [0], seriesOrder: null, errKeys: {},
    fitOverlay: null, curveFitOpen: true, xLim: null, plotTool: "pointer", regionPicked: null,
    qfitRoi: null, integral: null, selection: null,
  });
  rememberHandle(DS.data, "h1");
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetLayoutToolsForTests();
});

const wantRows = (lo: number, hi: number): number[] => X.flatMap((x, i) => (x >= lo && x <= hi ? [i] : []));
const sentRows = (): number[] => {
  const body = fitBody();
  expect(body).not.toHaveProperty("x");
  return gatherRows(useApp.getState().datasets[0]!.data, body as Parameters<typeof gatherRows>[1]).x
    .map((x) => X.indexOf(x as number));
};
async function fit(): Promise<void> {
  const before = fitCalls().length;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Fit" })); });
  await waitFor(() => expect(fitCalls().length).toBeGreaterThan(before));
}

describe("Curve Fit sends the rows its range line states (D1)", () => {
  it("the visible x range, zoomed before opening", async () => {
    useApp.setState({ xLim: [0.99, 6.99] });
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: "Linear" });
    expect(await screen.findByTestId("cf-fit-range")).toHaveTextContent("visible x range");
    await fit();
    expect(sentRows()).toEqual(wantRows(0.99, 6.99));
    expect(sentRows()).toHaveLength(60);
    expect(screen.getByTestId("cf-fit-range")).toHaveTextContent("visible x range"); // no flip to whole range
  });

  // The window layout pins a pinnable tool to its dataset while it runs
  // (store/layoutToolActions toolBusyChanged), which re-labels the selection as
  // a frozen "plot" capture. The bar must keep the range it set, not clear it.
  it("the layout's auto-pin for the run keeps the visible range, on the wire and in the line", async () => {
    useApp.setState({ xLim: [0.99, 6.99] });
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: "Linear" });
    expect(await screen.findByTestId("cf-fit-range")).toHaveTextContent("visible x range");
    registerLayoutTool({ id: "curvefit", title: "Curve fit", width: 340, head: null, body: document.createElement("div"), busy: false, pinRestored: true, autoPin: null });
    await act(async () => { toolBusyChanged("curvefit", true); }); // what the host does when the run starts
    expect(useAnalysisSelection.getState().selection?.source).toBe("plot");
    await fit();
    expect(sentRows()).toEqual(wantRows(0.99, 6.99));
    await act(async () => { toolBusyChanged("curvefit", false); });
    expect(screen.getByTestId("cf-fit-range")).toHaveTextContent("visible x range");
    expect(useAnalysisSelection.getState().selection?.items[0]?.range).toMatchObject({ lo: 0.99, hi: 6.99 });
  });

  it("a dragged range survives the run's auto-pin too", async () => {
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: /^Lorentzian/ });
    fireEvent.change(screen.getByRole("combobox", { name: /model/i }), { target: { value: "Lorentzian" } });
    fireEvent.click(await screen.findByRole("button", { name: "Fit range: drag on plot" }));
    act(() => {
      useApp.getState().setRegionPicked({ x: [0.99, 6.99] });
      useApp.getState().setPlotTool("zoom");
    });
    registerLayoutTool({ id: "curvefit", title: "Curve fit", width: 340, head: null, body: document.createElement("div"), busy: false, pinRestored: true, autoPin: null });
    await act(async () => { toolBusyChanged("curvefit", true); });
    await fit();
    expect(sentRows()).toEqual(wantRows(0.99, 6.99));
    await act(async () => { toolBusyChanged("curvefit", false); });
    expect(screen.getByTestId("cf-fit-range")).toHaveTextContent("dragged");
  });

  it("Use visible range, then refit", async () => {
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: "Linear" });
    await fit();
    expect(sentRows()).toHaveLength(101);
    act(() => useApp.getState().setXLim([0.99, 6.99])); // the Axes limits box's own action
    fireEvent.click(await screen.findByRole("button", { name: "Use visible range" }));
    await fit();
    expect(sentRows()).toEqual(wantRows(0.99, 6.99));
  });

  it("a dragged range", async () => {
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: /^Lorentzian/ });
    fireEvent.change(screen.getByRole("combobox", { name: /model/i }), { target: { value: "Lorentzian" } });
    fireEvent.click(await screen.findByRole("button", { name: "Fit range: drag on plot" }));
    act(() => {
      useApp.getState().setRegionPicked({ x: [6.99, 0.99] });
      useApp.getState().setPlotTool("zoom");
    });
    expect(screen.getByTestId("cf-fit-range")).toHaveTextContent("dragged");
    await fit();
    expect(sentRows()).toEqual(wantRows(0.99, 6.99));
  });
});
