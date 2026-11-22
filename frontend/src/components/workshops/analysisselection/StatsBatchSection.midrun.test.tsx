// Lane IR: a statistics batch whose settings change WHILE it runs. The section
// used to remount AnalysisBatchControls on a settings change (a `key`), so the
// running batch went on invisibly in the background and the fresh instance
// offered Run again: a second, concurrent batch over the same worksheets.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsShapiro } from "../../../lib/api";
import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import DistributionBatchSection from "../distribution/DistributionBatchSection";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsShapiro: vi.fn(),
}));
vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn() }));

const struct = (values: number[][]): DataStruct => ({
  time: values.map((_row, i) => i), values, labels: ["Signal", "Other"], units: ["", ""], metadata: { x_column_name: "T" },
});
const sheet = (id: string): Dataset => ({ id, name: `${id}.csv`, data: struct([[1, 5], [2, 6], [3, 7], [4, 8]]) });

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisSelection.setState({ toolId: null, selection: null });
  usePendingOps.setState({ ops: [] });
  const datasets = [sheet("a"), sheet("b")];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {},
    selection: null, analysisResults: [], history: [], future: [], status: "",
    resolveDataset: async (id: string) => useApp.getState().datasets.find((dataset) => dataset.id === id),
  });
  vi.mocked(statsShapiro).mockResolvedValue({ W: 0.9, p: 0.5, N: 4 });
});

describe("a settings change while a statistics batch runs", () => {
  it("does not offer Run again beside the batch still running (no second, concurrent batch)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(statsDescriptive).mockImplementation(async (v: number[]) => {
      await gate;
      return { N: v.length, mean: 1, median: 1, std: 1, min: 1, max: 1 };
    });
    const view = render(<DistributionBatchSection column="Signal" />);
    fireEvent.click(screen.getByRole("button", { name: /Batch over selected worksheets/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Distribution batch" }));
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));

    view.rerender(<DistributionBatchSection column="Other" />); // settings change mid-run
    // The running batch is still the one on screen; nothing offers a second run.
    expect(screen.queryByRole("button", { name: "Run Distribution batch" })?.hasAttribute("disabled") ?? true).toBe(true);
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();

    await act(async () => { release(); });
    await waitFor(() => expect(useApp.getState().status).toMatch(/batch finished/));
    expect(register).toHaveBeenCalledTimes(1);
    // The finished table belonged to the old column: it is not shown under the new one.
    expect(screen.queryByText("Completed")).toBeNull();
  });
});
