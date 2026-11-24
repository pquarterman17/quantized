// Statistical tests workshop — GAP_AUDIT_9 J14 panel behaviour: the control
// chart is drawn with its signals marked, capability refuses without a
// specification limit (no default), and a run is saved as a result.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetBookTransportForTests } from "../../../lib/bookData";
import type { Dataset } from "../../../lib/types";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "./StatsTestsPanel";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));

const ds: Dataset = {
  id: "d1", name: "line",
  data: {
    time: [1, 2, 3, 4, 5, 6], values: [[10], [11], [10], [30], [10], [11]],
    labels: ["thickness"], units: [""], metadata: {},
  },
};

function pickTest(label: RegExp): void {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => label.test(o.text));
  if (!option) throw new Error(`no test option matching ${label}`);
  fireEvent.change(select, { target: { value: option.value } });
}

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  useApp.setState({
    datasets: [ds], activeId: "d1", status: "", reports: [], openReportId: null,
    analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
  useStatsTestsStore.setState({ open: true, request: null });
});

const panel = (flagged: number[]) => ({
  name: "Individuals", values: [10, 11, 10, 30, 10, 11], center: 13.7, ucl: Array(6).fill(40), lcl: Array(6).fill(-12),
  beyond_limits: flagged, flagged, violations: [],
});

describe("SPC tests in the Statistical tests panel", () => {
  it("draws the control chart, marks the signalling point and saves the run", async () => {
    runMock.mockResolvedValue({
      id: "control-chart",
      data: { chart: "imr", n_subgroups: 6, subgroup_size: 1, panels: [panel([3]), { ...panel([]), name: "Moving range" }],
        sigma_within: 9, grand_mean: 13.7, dispersion_mean: 10, constants: null, out_of_control: 1 },
    });
    render(<StatsTestsPanel />);
    pickTest(/Control chart/);
    fireEvent.click(screen.getByRole("checkbox", { name: /1 point beyond 3σ/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/Individuals chart point 4/)).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledWith({
      id: "control-chart", body: { chart: "imr", rules: ["we1"], run_length: 8, values: [10, 11, 10, 30, 10, 11] },
    });
    expect(screen.getByRole("img", { name: "Individuals control chart" })).toBeInTheDocument();
    expect(document.querySelectorAll("circle[data-flagged]")).toHaveLength(1);
    expect(useApp.getState().analysisResults).toHaveLength(1);
  });

  it("refuses capability without a specification limit, then sends one", async () => {
    runMock.mockResolvedValue({
      id: "capability",
      data: {
        n: 6, mean: 13.7, lsl: null, usl: 40, target: null, alpha: 0.05,
        within: { sigma: 9, cpk: 0.97, cpu: 0.97, ci: { cp: null, cpk: [0.3, 1.6] } },
        overall: { sigma: 7.7, ppk: 1.1, ppu: 1.1, ci: { pp: null, ppk: [0.4, 1.8] } }, cpm: null, within_method: "MR-bar / d2",
        ppm_within: { below: null, above: 1000, total: 1000 }, ppm_overall: { below: null, above: 500, total: 500 },
        histogram: { edges: [10, 20, 30], counts: [5, 1] }, normality_p: 0.01, ci_note: "approx",
      },
    });
    render(<StatsTestsPanel />);
    pickTest(/Process capability/);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/no default/)).toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("USL"), { target: { value: "40" } });
    fireEvent.blur(screen.getByLabelText("USL"));
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/Cpk = 0.97 \(within\), Ppk = 1.1/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Capability histogram" })).toBeInTheDocument();
    expect(screen.getByText(/look non-normal/)).toBeInTheDocument();
  });
});
