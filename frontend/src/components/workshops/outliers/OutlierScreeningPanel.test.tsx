// OutlierScreeningPanel — component tests for the channel/method pick,
// per-method result summary, the flagged-rows table, and "Select flagged
// rows" writing the shared selection. Mirrors FitYByXPanel.test.tsx's
// fetch-mocking style.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { openWorksheetRowRange } from "../../../store/worksheetAnalysisHandoff";
import OutlierScreeningPanel from "./OutlierScreeningPanel";

const { grubbsMock, rosnerMock, dixonMock, madMock } = vi.hoisted(() => ({
  grubbsMock: vi.fn(),
  rosnerMock: vi.fn(),
  dixonMock: vi.fn(),
  madMock: vi.fn(),
}));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsGrubbs: grubbsMock,
  statsRosner: rosnerMock,
  statsDixonQ: dixonMock,
  statsMadOutliers: madMock,
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6],
  values: [[10], [11], [12], [13], [999], [14], [15]],
  labels: ["y"],
  units: [""],
  metadata: { x_column_name: "T" },
};

const GRUBBS_RESULT = {
  G: 3.5, G_critical: 2.1, flagged: true, flagged_indices: [4], index: 4, value: 999,
  tail: "two-sided", alpha: 0.05, N: 7, excluded_indices: [], method: "Grubbs test (single outlier)",
};

beforeEach(() => {
  vi.clearAllMocks();
  grubbsMock.mockResolvedValue(GRUBBS_RESULT);
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", status: "", selection: null,
    analysisResults: [], history: [], future: [] });
  useOutlierScreeningStore.setState({ open: true });
  useAnalysisSelection.setState({ toolId: null, selection: null, offeredRanges: {} });
});

describe("OutlierScreeningPanel", () => {
  it("defaults to Grubbs and renders the statistic summary + flagged row", async () => {
    render(<OutlierScreeningPanel />);
    expect(await screen.findByText(/G = 3\.5/)).toBeInTheDocument();
    expect(grubbsMock).toHaveBeenCalled();
    expect(screen.getByText("5")).toBeInTheDocument(); // flagged source row, 1-based like the worksheet gutter (index 4)
    expect(screen.getByText("999")).toBeInTheDocument(); // flagged value
  });

  it("labels the flagged row with its 1-based worksheet row (row 33 reads 33, not 32)", async () => {
    const n = 48;
    const values = Array.from({ length: n }, (_, i) => [i === 32 ? 40 : 10 + (i % 3)]);
    useApp.setState({ datasets: [{ id: "d1", name: "st48.csv", data: { ...DATA, time: Array.from({ length: n }, (_, i) => i), values } }], activeId: "d1" });
    grubbsMock.mockResolvedValue({ ...GRUBBS_RESULT, flagged_indices: [32], index: 32, value: 40, N: n });
    render(<OutlierScreeningPanel />);
    const cell = await screen.findByText("40");
    expect(cell.previousElementSibling?.textContent).toBe("33");
    expect(screen.queryByText("32")).not.toBeInTheDocument();
  });

  it("switches methods and calls the matching endpoint", async () => {
    rosnerMock.mockResolvedValue({
      num_outliers: 1, flagged_indices: [4], flagged_values: [999], table: [], k: 2, alpha: 0.05,
      N: 7, excluded_indices: [], method: "generalized ESD (Rosner)",
    });
    render(<OutlierScreeningPanel />);
    await screen.findByText(/G = 3\.5/); // the default Grubbs result has landed
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "rosner" } });
    expect(await screen.findByText(/1 of up to 2 tested/)).toBeInTheDocument();
    expect(rosnerMock).toHaveBeenCalled();
  });

  it("'Select flagged rows' writes the shared selection without excluding anything", async () => {
    render(<OutlierScreeningPanel />);
    await screen.findByText(/G = 3\.5/); // the flagged result has landed
    fireEvent.click(screen.getByRole("button", { name: "Select flagged rows" }));
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [4] });
    expect(useApp.getState().datasets[0].excludedRows ?? []).toEqual([]);
  });

  it("disables 'Select flagged rows' when nothing is flagged", async () => {
    grubbsMock.mockResolvedValue({ ...GRUBBS_RESULT, flagged: false, flagged_indices: [] });
    render(<OutlierScreeningPanel />);
    expect(await screen.findByText("none flagged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select flagged rows" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save result" })).toBeEnabled();
  });

  it("saves an explicit result and explains why another copy is disabled", async () => {
    render(<OutlierScreeningPanel />);
    const save = await screen.findByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(save).toBeDisabled();
    expect(screen.getByText("This outlier-screening result is already saved.")).toBeInTheDocument();
  });

  it("a save under rows 2-6 reads Saved with its actions enabled; clearing the range reads Not saved", async () => {
    openWorksheetRowRange("d1", [1, 2, 3, 4, 5]);
    render(<OutlierScreeningPanel />);
    const save = await screen.findByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(useApp.getState().analysisResults[0]!.parameters?.rowRange).toEqual({ from: 1, to: 5, rows: 7 });
    expect(await screen.findByRole("button", { name: "Open saved result" })).toBeEnabled();
    expect(screen.getAllByText("Saved").length).toBeGreaterThan(0);
    act(() => useAnalysisSelection.getState().updateItem("d1", { rowRange: null }));
    await waitFor(() => expect(screen.getAllByText("Not saved").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save result" })).toBeEnabled());
  });

  it("shows the screen as a result book: Rosner sequence starts collapsed, table actions fail closed until saved", async () => {
    rosnerMock.mockResolvedValue({
      num_outliers: 1, flagged_indices: [4], flagged_values: [999], k: 2, alpha: 0.05, N: 7, excluded_indices: [],
      method: "generalized ESD (Rosner)",
      table: [{ i: 1, R: 2.3, lambda_critical: 2.0, index: 4, value: 999, exceeds: true }],
    });
    render(<OutlierScreeningPanel />);
    await screen.findByText(/G = 3\.5/);
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "rosner" } });
    await screen.findByText(/1 of up to 2 tested/);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Outlier screening: Rosner generalized ESD");
    expect(screen.getByRole("button", { name: "Rosner sequence", expanded: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy table: Rosner sequence" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Send to report: Flagged rows" })).toBeDisabled();
    const save = screen.getByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    expect(screen.getByRole("button", { name: "Send to report: Rosner sequence" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Open saved result" })).toBeEnabled();
  });
});
