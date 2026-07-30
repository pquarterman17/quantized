// OutlierScreeningPanel — component tests for the channel/method pick,
// per-method result summary, the flagged-rows table, and "Select flagged
// rows" writing the shared selection. Mirrors FitYByXPanel.test.tsx's
// fetch-mocking style.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import { useApp } from "../../../store/useApp";
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
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", status: "", selection: null });
  useOutlierScreeningStore.setState({ open: true });
});

describe("OutlierScreeningPanel", () => {
  it("defaults to Grubbs and renders the statistic summary + flagged row", async () => {
    render(<OutlierScreeningPanel />);
    await waitFor(() => expect(grubbsMock).toHaveBeenCalled());
    expect(await screen.findByText(/G = 3\.5/)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument(); // flagged row index
    expect(screen.getByText("999")).toBeInTheDocument(); // flagged value
  });

  it("switches methods and calls the matching endpoint", async () => {
    rosnerMock.mockResolvedValue({
      num_outliers: 1, flagged_indices: [4], flagged_values: [999], table: [], k: 2, alpha: 0.05,
      N: 7, excluded_indices: [], method: "generalized ESD (Rosner)",
    });
    render(<OutlierScreeningPanel />);
    await waitFor(() => expect(grubbsMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "rosner" } });
    await waitFor(() => expect(rosnerMock).toHaveBeenCalled());
    expect(await screen.findByText(/1 of up to 2 tested/)).toBeInTheDocument();
  });

  it("'Select flagged rows' writes the shared selection without excluding anything", async () => {
    render(<OutlierScreeningPanel />);
    await waitFor(() => expect(grubbsMock).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Select flagged rows" }));
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [4] });
    expect(useApp.getState().datasets[0].excludedRows ?? []).toEqual([]);
  });

  it("disables 'Select flagged rows' when nothing is flagged", async () => {
    grubbsMock.mockResolvedValue({ ...GRUBBS_RESULT, flagged: false, flagged_indices: [] });
    render(<OutlierScreeningPanel />);
    await waitFor(() => expect(grubbsMock).toHaveBeenCalled());
    expect(await screen.findByText("none flagged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select flagged rows" })).toBeDisabled();
  });
});
