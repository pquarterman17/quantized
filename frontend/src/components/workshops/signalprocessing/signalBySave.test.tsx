// Signal processing "Save By result": the per-level rows the By block shows are
// recorded as one analysis-batch result; a duplicate is refused, Undo allows
// saving again, and the result goes out of date when the worksheet changes.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotResultState } from "../../../lib/analysisResultFreshness";
import { applyCorrections } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { DEFAULT_SIGNAL_SETTINGS } from "./signalProcessingModel";
import SignalScopeAndBy from "./SignalScopeAndBy";
import { DEFAULT_SPECTRAL_SETTINGS } from "./spectralSettings";

vi.mock("../../../lib/api", () => ({ applyCorrections: vi.fn(), fetchBookData: vi.fn() }));

const out = (mean: number): DataStruct => ({ time: [0, 1], values: [[mean], [mean]], labels: ["Signal"], units: [""], metadata: {} });
// Column 0 = Group (two levels of six rows), column 1 = Signal.
const DATA: DataStruct = {
  time: Array.from({ length: 12 }, (_, i) => i),
  values: Array.from({ length: 12 }, (_, i) => [i < 6 ? 0 : 1, (i < 6 ? 1 : 11) + (i % 6)]),
  labels: ["Group", "Signal"], units: ["", "cps"], metadata: {},
};
const props = { secondary: null, settings: DEFAULT_SIGNAL_SETTINGS, spectral: DEFAULT_SPECTRAL_SETTINGS, channels: [1], sigopFilter: false, crossWorksheet: false, validation: "" };
const region = () => screen.getByRole("region", { name: "Signal processing by level" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(applyCorrections).mockImplementation(async ({ dataset }) => out(dataset.values[0]![1]!) as never);
  useApp.setState({
    datasets: [{ id: "a", name: "a.csv", data: DATA }], activeId: "a", selectedIds: ["a"], xKey: null, yKeys: [1], seriesOrder: null,
    status: "", selection: null, analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
  useAnalysisSelection.setState({ toolId: null, selection: null });
});

describe("Signal processing: Save By result", () => {
  const open = async () => {
    render(<SignalScopeAndBy source={useApp.getState().datasets[0]!} {...props} />);
    expect(screen.queryByRole("button", { name: "Save By result" })).toBeNull(); // opt-in, display-only until a By column
    fireEvent.change(screen.getByLabelText(/Signal processing By \(optional\)/), { target: { value: "0" } });
    const save = await screen.findByRole("button", { name: "Save By result" });
    await waitFor(() => expect(save).toBeEnabled());
    return save;
  };

  it("saves exactly the rows shown, refuses a duplicate, and saves again after Undo", async () => {
    const save = await open();
    const shown = within(region()).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    fireEvent.click(save);
    fireEvent.click(save);
    const results = useApp.getState().analysisResults;
    expect(results).toHaveLength(1);
    expect(results[0]!.producer).toEqual({ id: "analysis-batch", label: "Signal processing", version: 1 });
    expect(results[0]!.parameters).toMatchObject({ toolId: "signal-processing", byColumn: "Group" });
    expect(results[0]!.tables![0]!.rows.map((r) => [r[0], r[2]])).toEqual(shown.map((r) => [r[0], Number(r[1])]));
    await waitFor(() => expect(save).toBeDisabled());
    expect(screen.getByText("This By result is already saved.")).toBeInTheDocument();

    useApp.getState().undo();
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save By result" })).toBeEnabled());
  });

  it("goes out of date once the worksheet changes", async () => {
    const save = await open();
    fireEvent.click(save);
    const [saved] = useApp.getState().analysisResults;
    expect(snapshotResultState(saved!, useApp.getState().datasets)).toBe("current");
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0]!, excludedRows: [2] }] });
    expect(snapshotResultState(saved!, useApp.getState().datasets)).toBe("out-of-date");
  });
});
