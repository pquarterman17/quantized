// Outlier screening By (lane BY) and the shared "Save By result" it opts into.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsGrubbs } from "../../../lib/api";
import { snapshotResultState } from "../../../lib/analysisResultFreshness";
import type { DataStruct } from "../../../lib/types";
import { useOutlierScreeningStore } from "../../../store/outlierScreening";
import { useApp } from "../../../store/useApp";
import OutlierScreeningPanel from "./OutlierScreeningPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsGrubbs: vi.fn(),
}));

// Column 0 = Group (A: rows 0-3, B: rows 4-5), column 1 = y.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[0, 10], [0, 11], [0, 99], [0, 12], [1, 5], [1, 6]],
  labels: ["Group", "y"],
  units: ["", ""],
  metadata: { x_column_name: "T" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsGrubbs).mockImplementation(async (x: number[]) => {
    const max = x.indexOf(Math.max(...x));
    const flagged = x[max]! > 50;
    return {
      G: 2, G_critical: 1.5, flagged, flagged_indices: flagged ? [max] : [], index: max, value: x[max]!,
      tail: "two-sided", alpha: 0.05, N: x.length, excluded_indices: [], method: "Grubbs",
    };
  });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA, channelTypes: { 0: "nominal" } }], activeId: "d1",
    status: "", selection: null, analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
  useOutlierScreeningStore.setState({ open: true });
});

const pickGroup = () => fireEvent.change(screen.getByLabelText("Outlier screening By (optional)"), { target: { value: "0" } });
const byTable = () => within(screen.getByRole("region", { name: "Outlier screening by level" })).getByRole("table");

describe("Outlier screening By", () => {
  it("keeps the single run's default (Grubbs on the first continuous channel) and offers no By rows until a column is picked", async () => {
    render(<OutlierScreeningPanel />);
    expect(await screen.findByText(/G = 2/)).toBeInTheDocument();
    expect(vi.mocked(statsGrubbs).mock.calls[0]![0]).toEqual([10, 11, 99, 12, 5, 6]);
    expect(screen.queryByRole("button", { name: "Save By result" })).toBeNull();
  });

  it("screens each level against its own values; a too-small level is an error row", async () => {
    render(<OutlierScreeningPanel />);
    await screen.findByText(/G = 2/);
    pickGroup();
    await waitFor(() => expect(within(byTable()).getAllByRole("row")).toHaveLength(3));
    const [a, b] = within(byTable()).getAllByRole("row").slice(1);
    expect(within(a!).getAllByRole("cell").map((c) => c.textContent)).toEqual(["0", "4", "4", "1", "99"]);
    expect(b!.textContent).toContain("not enough data (n=2)");
    // Never selects rows by itself.
    expect(useApp.getState().selection).toBeNull();
  });

  it("drops the By column when it becomes the screened channel", async () => {
    render(<OutlierScreeningPanel />);
    await screen.findByText(/G = 2/);
    pickGroup();
    await waitFor(() => expect(within(byTable()).getAllByRole("row")).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "0" } });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Outlier screening by level" })).toBeNull());
    // Back on y, the By pick was reset rather than kept as the channel's column.
    fireEvent.change(screen.getByLabelText("Channel"), { target: { value: "1" } });
    expect(await screen.findByLabelText("Outlier screening By (optional)")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Save By result" })).toBeNull();
  });

  it("says why Save is unavailable when the By column has no levels left", async () => {
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0]!, data: { ...DATA, values: DATA.values.map(([, y]) => [Number.NaN, y!]) } }] });
    render(<OutlierScreeningPanel />);
    await screen.findByText(/G = 2/);
    pickGroup();
    expect(await screen.findByText("This By column has no levels in the analysis view.")).toBeInTheDocument();
  });

  it("saves one By result per run, refuses a duplicate, and allows saving again after Undo", async () => {
    render(<OutlierScreeningPanel />);
    await screen.findByText(/G = 2/);
    pickGroup();
    const save = await screen.findByRole("button", { name: "Save By result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    fireEvent.click(save); // a second click in the same tick saves nothing more
    const results = useApp.getState().analysisResults;
    expect(results).toHaveLength(1);
    expect(results[0]!.producer.id).toBe("analysis-batch");
    expect(results[0]!.parameters).toMatchObject({ toolId: "outlier-screening", byColumn: "Group", channel: "y", method: "grubbs" });
    expect(results[0]!.tables![0]!.rows[0]).toEqual(["0", "Completed", 4, 4, 1, "99", null]);
    expect(snapshotResultState(results[0]!, useApp.getState().datasets)).toBe("current");
    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.getByText("This By result is already saved.")).toBeInTheDocument();

    useApp.getState().undo();
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save By result" })).toBeEnabled());
  });

  it("marks the saved By result out of date once the worksheet changes", async () => {
    render(<OutlierScreeningPanel />);
    await screen.findByText(/G = 2/);
    pickGroup();
    const save = await screen.findByRole("button", { name: "Save By result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    const [saved] = useApp.getState().analysisResults;
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0]!, excludedRows: [2] }] });
    expect(snapshotResultState(saved!, useApp.getState().datasets)).toBe("out-of-date");
  });
});
