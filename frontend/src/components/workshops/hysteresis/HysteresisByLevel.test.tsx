// Hysteresis By (lane BY3): the loop analysis once per level of a categorical
// column, with the single run's H / M, Save By result, and fail-closed cases.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotResultState } from "../../../lib/analysisResultFreshness";
import { hysteresisAnalysis } from "../../../lib/api/magnetometry";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import HysteresisPanel from "./HysteresisPanel";

vi.mock("../../../lib/api/magnetometry", () => ({ hysteresisAnalysis: vi.fn(), subtractHysteresisBackground: vi.fn() }));

// Level "up" has 30 rows, level "dn" only 5. Moment is column 0, Sweep column 1.
const rows = [
  ...Array.from({ length: 30 }, (_v, i) => [i, 0]),
  ...Array.from({ length: 5 }, (_v, i) => [100 + i, 1]),
];
const DATA: DataStruct = {
  time: rows.map((_r, i) => -1000 + 50 * i),
  values: rows,
  labels: ["Moment", "Sweep"],
  units: ["emu", ""],
  metadata: { x_column_name: "Magnetic Field", x_column_unit: "Oe" },
};
const sheet = (data = DATA) => ({ id: "d1", name: "vsm.dat", data, channelTypes: { 1: "nominal" as const } });

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisSelection.getState().clear();
  vi.mocked(hysteresisAnalysis).mockResolvedValue({
    HcMean: 721.3, MrMean: 7.5e-5, MsMean: 2e-3, squareness: 0.04, loopArea: 0.97, SFD: { peakH: 2446, fwhm: 390 }, warnings: [],
  });
  useApp.setState({
    datasets: [sheet()], activeId: "d1", xKey: null, yKeys: null, seriesOrder: null,
    selection: null, analysisResults: [], history: [], future: [], status: "",
  });
});

const pickSweep = () => fireEvent.change(screen.getByLabelText("Hysteresis By (optional)"), { target: { value: "1" } });
const byTable = () => within(screen.getByRole("region", { name: "Hysteresis by level" })).getByRole("table");

describe("Hysteresis By", () => {
  it("keeps the single run on the whole loop and shows no By rows until a column is picked", async () => {
    render(<HysteresisPanel />);
    await screen.findByText("Hc (mean)");
    expect(vi.mocked(hysteresisAnalysis).mock.calls[0]![0].h).toHaveLength(35);
    expect(screen.queryByRole("table", { name: /by level/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save By result" })).toBeNull();
  });

  it("analyses each level as its own loop with units in the headers; a short level is an error row", async () => {
    render(<HysteresisPanel />);
    await screen.findByText("Hc (mean)");
    pickSweep();
    await waitFor(() => expect(within(byTable()).getAllByRole("row")).toHaveLength(3));
    const [up, dn] = within(byTable()).getAllByRole("row").slice(1);
    expect(within(up!).getAllByRole("cell")[1]!.textContent).toBe("30");
    expect(dn!.textContent).toContain("only 5 finite field/moment pairs");
    const levelCall = vi.mocked(hysteresisAnalysis).mock.calls.find(([body]) => body.h.length === 30)!;
    expect(levelCall[0].m).toEqual(Array.from({ length: 30 }, (_v, i) => i));
    expect(screen.getByText("Mean |Hc| (Oe)")).toBeInTheDocument();
    expect(screen.getByText("Loop area (Oe·emu)")).toBeInTheDocument();
  });

  it("fails closed when the plotted X is not a magnetic field", async () => {
    useApp.setState({ datasets: [sheet({ ...DATA, metadata: { x_column_name: "Time", x_column_unit: "s" } })] });
    render(<HysteresisPanel />);
    pickSweep();
    expect((await screen.findAllByText(/not a declared magnetic field/)).length).toBeGreaterThan(0);
    expect(vi.mocked(hysteresisAnalysis)).not.toHaveBeenCalled();
  });

  it("saves one By result, refuses a duplicate, allows it again after Undo, and goes out of date with the worksheet", async () => {
    render(<HysteresisPanel />);
    await screen.findByText("Hc (mean)");
    pickSweep();
    const save = await screen.findByRole("button", { name: "Save By result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    fireEvent.click(save);
    const results = useApp.getState().analysisResults;
    expect(results).toHaveLength(1);
    expect(results[0]!.parameters).toMatchObject({ toolId: "hysteresis", byColumn: "Sweep", hUnit: "Oe", mUnit: "emu" });
    expect(results[0]!.tables![0]!.rows[0]!.slice(0, 5)).toEqual(["0", "Completed", 30, 721.3, 7.5e-5]);
    expect(snapshotResultState(results[0]!, useApp.getState().datasets)).toBe("current");
    await waitFor(() => expect(save).toBeDisabled());
    useApp.getState().undo();
    await waitFor(() => expect(useApp.getState().analysisResults).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save By result" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save By result" }));
    const [saved] = useApp.getState().analysisResults;
    useApp.setState({ datasets: [{ ...useApp.getState().datasets[0]!, excludedRows: [2] }] });
    expect(snapshotResultState(saved!, useApp.getState().datasets)).toBe("out-of-date");
  });
});
