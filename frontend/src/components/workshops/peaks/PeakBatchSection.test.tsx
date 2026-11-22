// Find peaks batch: a settings change drops the finished table (rows run with
// other detector settings must not sit under the new ones).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks } from "../../../lib/api/peaks";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import PeakBatchSection from "./PeakBatchSection";
import { DEFAULT_PEAK_FIND } from "./peakFindParams";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn() }));

const sheet = (id: string): Dataset => ({
  id, name: `${id}.csv`,
  data: { time: [0, 1, 2, 3, 4], values: [[1], [5], [1], [4], [1]], labels: ["Y"], units: [""], metadata: {} },
});

beforeEach(() => {
  vi.clearAllMocks();
  const datasets = [sheet("a"), sheet("b")];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0], seriesOrder: null,
    analysisResults: [], history: [], future: [], resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "peaks",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
  usePendingOps.setState({ ops: [] });
  vi.mocked(findPeaks).mockResolvedValue({ peaks: [{ center: 1, prominence: 4, localSNR: 9 }], background: [] } as never);
});

describe("PeakBatchSection settings change", () => {
  it("drops the finished table when a detector setting changes, and keeps it when none does", async () => {
    const { rerender } = render(<PeakBatchSection params={{ ...DEFAULT_PEAK_FIND }} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Peak detection batch" }));
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    rerender(<PeakBatchSection params={{ ...DEFAULT_PEAK_FIND }} />);
    expect(screen.getAllByText("Completed")).toHaveLength(2);
    rerender(<PeakBatchSection params={{ ...DEFAULT_PEAK_FIND, snr_threshold: 9 }} />);
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(register).toHaveBeenCalledOnce();
  });
});
