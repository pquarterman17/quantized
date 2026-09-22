import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StatsChooserPanel from "./StatsChooserPanel";
import { resetBookTransportForTests } from "../../../lib/bookData";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

const { recommendMock, runTestMock, emitMock, fetchBookDataMock } = vi.hoisted(() => ({
  recommendMock: vi.fn(),
  runTestMock: vi.fn(),
  emitMock: vi.fn(),
  fetchBookDataMock: vi.fn(),
}));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsRecommend: recommendMock,
  statsRunTest: runTestMock,
  reportEmit: emitMock,
  fetchBookData: fetchBookDataMock,
}));

// Two continuous channels — columns mode groups.
const ds: Dataset = {
  id: "d1",
  name: "growth",
  data: {
    time: [1, 2, 3, 4, 5],
    values: [
      [10, 20],
      [11, 21],
      [12, 22],
      [13, 23],
      [14, 24],
    ],
    labels: ["A", "B"],
    units: ["", ""],
    metadata: {},
  },
};

const REC = {
  recommendation: "Welch two-sample t-test",
  endpoint: "/api/stats/ttest",
  parametric: true,
  n_groups: 2,
  paired: false,
  checks: { alpha: 0.05, shapiro_p: [0.5, 0.6], levene_p: 0.7 },
  reasons: ["normality not rejected for any group (Shapiro-Wilk)"],
};

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  fetchBookDataMock.mockReset().mockReturnValue(new Promise(() => {}));
  useApp.setState({
    datasets: [ds],
    activeId: "d1",
    statsChooserOpen: true,
    reports: [],
    openReportId: null,
  });
});

describe("StatsChooserPanel", () => {
  it("loads the full Origin book before recommending a test", async () => {
    recommendMock.mockResolvedValue(REC);
    fetchBookDataMock.mockResolvedValueOnce(ds.data);
    useApp.setState({
      datasets: [{ ...ds, data: { ...ds.data, time: [1, 2], values: ds.data.values.slice(0, 2) }, pending: { kind: "upload", bookId: "b1", rows: 5, cols: 2, previewSampled: true } }],
      activeId: "d1",
    });
    render(<StatsChooserPanel />);
    fireEvent.click(screen.getByText("B"));
    fireEvent.click(screen.getByRole("button", { name: "Which test?" }));

    await waitFor(() => expect(screen.getByText("Welch two-sample t-test")).toBeInTheDocument());
    expect(recommendMock).toHaveBeenCalledWith({
      groups: [[10, 11, 12, 13, 14], [20, 21, 22, 23, 24]],
      paired: false,
    });
  });

  it("skips a queued recommendation when the column selection changes", async () => {
    let finish!: (data: Dataset["data"]) => void;
    fetchBookDataMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    useApp.setState({
      datasets: [{ ...ds, data: { ...ds.data, time: [1, 2], values: ds.data.values.slice(0, 2) }, pending: { kind: "upload", bookId: "b1", rows: 5, cols: 2, previewSampled: true } }],
      activeId: "d1",
    });
    render(<StatsChooserPanel />);
    fireEvent.click(screen.getByText("B"));
    fireEvent.click(screen.getByRole("button", { name: "Which test?" }));
    fireEvent.click(screen.getByText("A"));
    act(() => finish(ds.data));

    await waitFor(() => expect(screen.getByText(/skipped because the selected columns changed/i)).toBeInTheDocument());
    expect(recommendMock).not.toHaveBeenCalled();
  });

  it("does not recommend from a same-ID replacement while the original book is loading", async () => {
    let finish!: (data: Dataset["data"]) => void;
    fetchBookDataMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    useApp.setState({ datasets: [{ ...ds, data: { ...ds.data, time: [1, 2], values: ds.data.values.slice(0, 2) }, pending: { kind: "upload", bookId: "b1", rows: 5, cols: 2, previewSampled: true } }] });
    render(<StatsChooserPanel />);
    fireEvent.click(screen.getByText("B"));
    fireEvent.click(screen.getByRole("button", { name: "Which test?" }));

    act(() => useApp.setState({ datasets: [{ ...ds, name: "replacement" }] }));
    expect(recommendMock).not.toHaveBeenCalled();
    await act(async () => { finish(ds.data); });
    expect(recommendMock).not.toHaveBeenCalled();
    expect(screen.getByText(/full dataset is unavailable/i)).toBeInTheDocument();
  });

  it("stops waiting when the user switches datasets during a stalled load", async () => {
    useApp.setState({ datasets: [{ ...ds, data: { ...ds.data, time: [1, 2], values: ds.data.values.slice(0, 2) }, pending: { kind: "upload", bookId: "b1", rows: 5, cols: 2, previewSampled: true } }, { ...ds, id: "d2", name: "other" }] });
    render(<StatsChooserPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Which test?" }));
    act(() => useApp.setState({ activeId: "d2" }));

    expect(screen.getByText(/active dataset changed while loading/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Which test?" })).toBeEnabled();
    expect(recommendMock).not.toHaveBeenCalled();
  });

  it("clears the queued busy state when the full group-by view has no groups", async () => {
    fetchBookDataMock.mockResolvedValueOnce({ ...ds.data, time: [], values: [] });
    useApp.setState({ datasets: [{ ...ds, data: { ...ds.data, time: [1, 2], values: ds.data.values.slice(0, 2) }, pending: { kind: "upload", bookId: "b1", rows: 5, cols: 2, previewSampled: true } }] });
    render(<StatsChooserPanel />);
    fireEvent.click(screen.getByText("Value by category"));
    fireEvent.click(screen.getByRole("button", { name: "Which test?" }));

    await waitFor(() => expect(screen.getByText(/No groups remain in the selected data/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Checking…" })).not.toBeInTheDocument();
    expect(recommendMock).not.toHaveBeenCalled();
  });

  it("recommends a test and shows the plain-language reasons", async () => {
    recommendMock.mockResolvedValue(REC);
    render(<StatsChooserPanel />);

    // pick the second column too (first channel is pre-selected)
    fireEvent.click(screen.getByText("B"));
    fireEvent.click(screen.getByRole("button", { name: "Which test?" }));

    await waitFor(() =>
      expect(screen.getByText("Welch two-sample t-test")).toBeInTheDocument(),
    );
    expect(recommendMock).toHaveBeenCalledWith({
      groups: [
        [10, 11, 12, 13, 14],
        [20, 21, 22, 23, 24],
      ],
      paired: false,
    });
    expect(screen.getByText(/normality not rejected/)).toBeInTheDocument();
  });

  it("runs the recommended test and can land it as a report", async () => {
    recommendMock.mockResolvedValue(REC);
    runTestMock.mockResolvedValue({ t: -15.8, p: 0.0001, df: 8 });
    emitMock.mockResolvedValue({
      report: { title: "t", sections: [] },
    });
    render(<StatsChooserPanel />);

    fireEvent.click(screen.getByText("B"));
    fireEvent.click(screen.getByRole("button", { name: "Which test?" }));
    await waitFor(() => screen.getByRole("button", { name: /Run Welch/ }));

    fireEvent.click(screen.getByRole("button", { name: /Run Welch/ }));
    await waitFor(() => expect(screen.getByText("t")).toBeInTheDocument());
    expect(runTestMock).toHaveBeenCalledWith(
      "/api/stats/ttest",
      expect.objectContaining({ paired: false }),
    );

    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "stats_table" }),
    );
    expect(useApp.getState().reports[0].datasetId).toBe("d1");
  });

  it("surfaces a backend rejection as an inline error", async () => {
    recommendMock.mockRejectedValue(new Error("every group needs at least 3 observations"));
    render(<StatsChooserPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Which test?" }));
    await waitFor(() =>
      expect(screen.getByText(/at least 3 observations/)).toBeInTheDocument(),
    );
  });

  it("prompts for a dataset when none is active", () => {
    useApp.setState({ datasets: [], activeId: null });
    render(<StatsChooserPanel />);
    expect(screen.getByText(/Select a dataset/)).toBeInTheDocument();
  });
});
