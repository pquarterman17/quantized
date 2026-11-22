// Lane RL2: Resample, Average curves and the ROI cuts workshop commit through the
// shared contract. Fail-before: each wrote its output with a raw addDataset, so
// a repeat click made a second identical worksheet, the output was not one undo
// step with a Library result, and nothing marked it stale when its source changed.

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResampleRequest, ResampleResult } from "../../../lib/api/resample";
import type { DataStruct } from "../../../lib/types";
import { useResampleDialog } from "../../../store/resampleDialog";
import { useApp } from "../../../store/useApp";
import DatasetMathPanel from "../datasetmath/DatasetMathPanel";
import { useRoiBatch } from "../roicuts/useRoiBatch";
import { useRoiCuts } from "../roicuts/useRoiCuts";
import { useResample } from "../resample/useResample";

vi.mock("../../../lib/api/curveAverage", () => ({ averageCurves: vi.fn() }));
vi.mock("../../../lib/api/resample", () => ({ resampleDataset: vi.fn() }));
vi.mock("../../../lib/api/rsm", () => ({ rsmBoxCut: vi.fn(), rsmBoxStats: vi.fn(), rsmSector: vi.fn(), rsmChiProfile: vi.fn() }));
vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
const { averageCurves } = await import("../../../lib/api/curveAverage");
const { resampleDataset } = await import("../../../lib/api/resample");
const { rsmBoxCut } = await import("../../../lib/api/rsm");

const scan = (k: number): DataStruct => ({
  time: [0, 1, 2], values: [[k], [k + 1], [k + 2]], labels: ["I"], units: ["cps"], metadata: {},
});
const AVG: DataStruct = {
  time: [0, 1, 2], values: [[2, 1, 0.5, 2], [3, 1, 0.5, 2], [4, 1, 0.5, 2]],
  labels: ["I mean", "I SD", "I SEM", "N"], units: ["cps", "cps", "cps", ""], metadata: {},
};
const changeSource = (id: string): void => {
  act(() => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === id ? { ...d, data: { ...d.data, time: [0, 1, 9] } } : d) }));
    useApp.getState().touchDataset(id);
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan1.xy", data: scan(1) }, { id: "d2", name: "scan2.xy", data: scan(3) }],
    folders: [], activeId: "d1", selectedIds: ["d1", "d2"], analysisResults: [], staleDatasets: [], staleFits: [],
    history: [], future: [], macroRecording: true, macroSteps: [], recalcMode: "manual",
    datasetMathOpen: true, datasetMathMode: "average",
  });
});

describe("Average curves", () => {
  async function average(): Promise<void> {
    vi.mocked(averageCurves).mockResolvedValue({ dataset: AVG, warnings: [], overlap: [0, 2], channels: ["I", "I"] });
    fireEvent.click(screen.getByRole("button", { name: /Average → new dataset/ }));
  }

  it("a repeat click creates no duplicate and says so", async () => {
    render(<DatasetMathPanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Y column to average" }), { target: { value: "I" } });
    await average();
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    await average();
    expect(await screen.findByText(/Already added as/)).toBeInTheDocument();
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().macroSteps.filter((m) => m.kind === "transform")).toHaveLength(1);
  });

  it("is one undo step with its Library result, and the output goes stale when ANY input changes", async () => {
    render(<DatasetMathPanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Y column to average" }), { target: { value: "I" } });
    await average();
    await waitFor(() => expect(useApp.getState().datasets).toHaveLength(3));
    expect(useApp.getState().history).toHaveLength(1);
    const outputId = useApp.getState().datasets[2].id;
    expect(useApp.getState().datasets[2].errorRoles).toHaveLength(1); // SEM binding kept
    changeSource("d2"); // the SECOND curve, not the primary one
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
    act(() => { useApp.setState({ staleDatasets: [] }); useApp.getState().undo(); });
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });
});

describe("Resample", () => {
  beforeEach(() => {
    vi.mocked(resampleDataset).mockImplementation((body: ResampleRequest) => Promise.resolve({
      dataset: { ...body.dataset, values: body.dataset.time.map(() => [1]) },
      warnings: [], source_range: [0, 2], rows_in: 3, rows_out: 3,
    } as ResampleResult));
    useResampleDialog.setState({ seed: ["d1"] });
  });

  async function ready() {
    const hook = renderHook(() => useResample());
    await waitFor(() => expect(hook.result.current.canCreate).toBe(true));
    return hook;
  }

  it("a repeat Create adds nothing, keeps the pick and says why", async () => {
    const { result } = await ready();
    await act(async () => { await result.current.create(); });
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
    expect(useApp.getState().macroSteps).toHaveLength(1);
    useResampleDialog.setState({ seed: ["d1"] }); // Create closed the dialog
    const again = await ready();
    await act(async () => { await again.result.current.create(); });
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().macroSteps).toHaveLength(1);
    expect(again.result.current.error).toMatch(/already added as/);
    expect(again.result.current.picks).toEqual(["d1"]);
  });

  it("Undo removes the output with its result, and it goes stale when the source changes", async () => {
    const { result } = await ready();
    await act(async () => { await result.current.create(); });
    const outputId = useApp.getState().datasets[2].id;
    changeSource("d1");
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
    act(() => { useApp.setState({ staleDatasets: [] }); useApp.getState().undo(); });
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().analysisResults).toHaveLength(0);
  });
});

describe("ROI cuts", () => {
  const MAP: DataStruct = {
    time: [0, 1, 2, 3], values: [[60, 30, 1], [61, 30, 2], [60, 31, 3], [61, 31, 4]],
    labels: ["2Theta", "Omega", "Intensity"], units: ["deg", "deg", "cps"],
    metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
  };
  const CUT: DataStruct = { time: [0, 1], values: [[1], [2]], labels: ["Intensity"], units: ["cps"], metadata: { cut_label: "box cut" } };
  const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

  beforeEach(() => {
    vi.mocked(rsmBoxCut).mockResolvedValue(CUT);
    useApp.setState({ datasets: [{ id: "m", name: "map", data: MAP }, { id: "m2", name: "map2", data: MAP }], activeId: "m", selectedIds: ["m", "m2"] });
    useApp.setState({ mapRoi: { space: "angular", x0: 60, x1: 61, y0: 30, y1: 31 } });
  });

  it("a repeat box cut creates no duplicate; one undo step with a result; stale when the map changes", async () => {
    const { result } = renderHook(() => useRoiCuts());
    act(() => result.current.runBox());
    await flush();
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
    act(() => useApp.getState().setActive("m")); // the cut became active: back to the map
    act(() => result.current.runBox());
    await flush();
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().status).toMatch(/already added/);
    const outputId = useApp.getState().datasets[2].id;
    act(() => {
      useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "m" ? { ...d, data: { ...d.data, values: [[60, 30, 9], ...d.data.values.slice(1)] } } : d) }));
      useApp.getState().touchDataset("m");
    });
    expect(useApp.getState().staleDatasets).toEqual([outputId]);
  });

  it("a different box is a new computation", async () => {
    const { result } = renderHook(() => useRoiCuts());
    act(() => result.current.runBox());
    await flush();
    act(() => useApp.getState().setActive("m"));
    act(() => result.current.setBoxX1(60.5));
    act(() => result.current.runBox());
    await flush();
    expect(useApp.getState().datasets).toHaveLength(4);
  });

  it("a batch repeat reports the cuts already added instead of counting them new", async () => {
    const { result } = renderHook(() => useRoiBatch());
    act(() => { result.current.setSummaryTable(false); result.current.setPlotTogether(false); });
    const rect = { space: "angular" as const, x0: 60, x1: 61, y0: 30, y1: 31 };
    await act(async () => { await result.current.applyToSelected(rect, { collapse: "x", reduce: "sum", nBins: 10 }); });
    expect(result.current.outcome?.appliedCount).toBe(2);
    const after = useApp.getState().datasets.length;
    act(() => useApp.setState({ selectedIds: ["m", "m2"], activeId: "m" }));
    await act(async () => { await result.current.applyToSelected(rect, { collapse: "x", reduce: "sum", nBins: 10 }); });
    expect(useApp.getState().datasets).toHaveLength(after);
    expect(result.current.outcome?.appliedCount).toBe(0);
    expect(result.current.outcome?.skipped.map((s) => s.reason).join()).toMatch(/already in the Library/);
  });
});
