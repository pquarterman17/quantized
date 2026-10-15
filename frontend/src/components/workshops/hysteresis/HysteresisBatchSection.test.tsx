import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hysteresisAnalysis } from "../../../lib/api/magnetometry";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { CalcResult, Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import HysteresisBatchSection from "./HysteresisBatchSection";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api/magnetometry", () => ({ hysteresisAnalysis: vi.fn() }));

function loop(id: string, fieldUnit: string, momentUnit: string, gap = false): Dataset {
  const field = Array.from({ length: 24 }, (_value, index) => index - 12);
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: field,
      values: field.map((h, index) => [gap && index === 3 ? Number.NaN : Math.tanh(h / 3)]),
      labels: ["Moment"],
      units: [momentUnit],
      metadata: {
        technique: "magnetometry.mvsh",
        x_column_name: "Magnetic Field",
        x_column_unit: fieldUnit,
        default_value_channels: [0],
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  register.mockReset();
  const datasets = [loop("room-temperature", "Oe", "emu", true), loop("cold", "T", "A·m²")];
  useApp.setState({
    datasets,
    activeId: datasets[0].id,
    selectedIds: datasets.map((dataset) => dataset.id),
    xKey: null,
    yKeys: [0],
    seriesOrder: null,
    errKeys: {},
    selection: null,
    analysisResults: [],
    openAnalysisResultId: null,
    history: [],
    future: [],
    resolveDataset: async (id: string) => datasets.find((dataset) => dataset.id === id),
  });
  useAnalysisSelection.getState().setSelection("hysteresis", captureAnalysisSelection({
    datasets,
    activeId: datasets[0].id,
    selectedIds: datasets.map((dataset) => dataset.id),
    xKey: null,
    yKeys: [0],
    seriesOrder: null,
    errKeys: {},
    selection: null,
    range: null,
  }, "library"));
  usePendingOps.setState({ ops: [] });
  vi.mocked(hysteresisAnalysis).mockResolvedValue({
    HcMean: 2,
    MrMean: 0.4,
    MsMean: 1.1,
    squareness: 0.36,
    loopArea: 5,
    SFD: { peakH: 1.5 },
    warnings: [],
  } as CalcResult);
});

describe("HysteresisBatchSection", () => {
  it("runs each reviewed loop, omits gaps, and preserves per-row units", async () => {
    render(<HysteresisBatchSection />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Hysteresis comparison batch" }));

    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(hysteresisAnalysis).toHaveBeenCalledTimes(2);
    expect(vi.mocked(hysteresisAnalysis).mock.calls[0][0].h).toHaveLength(23);
    expect(JSON.stringify(vi.mocked(hysteresisAnalysis).mock.calls[0][0])).not.toContain("null");
    expect(register).toHaveBeenCalledOnce();
    const result = register.mock.calls[0][0];
    expect(result.tables[0].rows).toEqual([
      ["room-temperature.dat", "Completed", 24, 2, "Oe", 0.4, 1.1, "emu", 0.36, 5, "Oe·emu", 1.5, "1 gap rows were omitted."],
      ["cold.dat", "Completed", 24, 2, "T", 0.4, 1.1, "A·m²", 0.36, 5, "T·A·m²", 1.5, null],
    ]);
    expect(result.warnings).toContain("room-temperature.dat: 1 gap rows were omitted.");
  });

  it("records a too-short loop as failed instead of aborting the comparison", async () => {
    const datasets = [loop("good", "Oe", "emu"), {
      ...loop("short", "Oe", "emu"),
      data: { ...loop("short", "Oe", "emu").data, time: [-1, 1], values: [[-1], [1]] },
    }];
    useApp.setState({
      datasets,
      activeId: "good",
      selectedIds: ["good", "short"],
      resolveDataset: async (id: string) => datasets.find((dataset) => dataset.id === id),
    });
    useAnalysisSelection.getState().setSelection("hysteresis", captureAnalysisSelection({
      datasets, activeId: "good", selectedIds: ["good", "short"], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"));

    render(<HysteresisBatchSection />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Hysteresis comparison batch" }));
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));

    expect(hysteresisAnalysis).toHaveBeenCalledTimes(1);
    const saved = register.mock.calls[0][0] as { tables: { rows: unknown[][] }[] };
    const row = saved.tables[0].rows[1];
    expect(row.slice(0, 3)).toEqual(["short.dat", "Failed", 2]);
    expect(row.slice(3, 12)).toEqual(Array(9).fill(null));
    expect(row[12]).toBe("Only 2 finite field/moment pairs remain; hysteresis analysis needs at least 20.");
  });

  it("fails closed when a batch item has no declared field axis", async () => {
    const unknown = loop("unknown", "Oe", "emu");
    unknown.data.metadata = { technique: "magnetometry.mvsh" };
    useApp.setState({
      datasets: [unknown], activeId: unknown.id, selectedIds: [unknown.id],
      resolveDataset: async () => unknown,
    });
    useAnalysisSelection.getState().setSelection("hysteresis", captureAnalysisSelection({
      datasets: [unknown], activeId: unknown.id, selectedIds: [unknown.id], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"));

    render(<HysteresisBatchSection />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Hysteresis comparison batch" }));
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));

    expect(hysteresisAnalysis).not.toHaveBeenCalled();
    const saved = register.mock.calls[0][0] as { tables: { rows: unknown[][] }[] };
    expect(saved.tables[0].rows[0].at(-1)).toContain("not a declared magnetic field");
  });
});
