// BaselinePanel batch apply (UX9-E): the header names the dataset, and
// "Apply to N selected" writes N grouped outputs as ONE undo entry.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { baselineRegion } from "../../../lib/api/baseline";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import BaselinePanel from "./BaselinePanel";

vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(),
  baselineAnchor: vi.fn(),
  baselineEstimate: vi.fn(),
  baselineModPoly: vi.fn(),
  baselineRegion: vi.fn(),
  baselineRollingBall: vi.fn(),
  baselineShirley: vi.fn(),
  baselineXrdLowAngle: vi.fn(),
}));

const raw: DataStruct = {
  time: [1, 2, 3, 4],
  values: [[10], [12], [11], [13]],
  labels: ["Intensity"],
  units: ["cps"],
  metadata: {},
};
const spectrum = (name: string, id: string) => ({ id, name, data: raw });

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [spectrum("Raman_A.txt", "a"), spectrum("Raman_B.txt", "b"), spectrum("Raman_C.txt", "c")],
    workbooks: [],
    folders: [],
    history: [],
    future: [],
    activeId: "a",
    selectedIds: ["a", "b", "c"],
    baselineOpen: true,
    baselineOverlay: null,
    baselineAnchorEdit: null,
    xKey: null,
    yKeys: null,
    seriesOrder: null,
  });
});

describe("BaselinePanel batch apply (UX9-E)", () => {
  it("names the dataset in the header", () => {
    render(<BaselinePanel />);
    // The header is now the shared input line (lib/analysisInputs); same facts, new wording.
    expect(screen.getByText(/^Input: Raman_A\.txt · X: .* · Y: Intensity \(cps\)/)).toBeInTheDocument();
  });

  it("Apply to 3 selected writes 3 grouped outputs as ONE undo entry, then offers Overlay", async () => {
    vi.mocked(baselineRegion).mockResolvedValue({
      background: [1, 1, 1, 1], coeffs: [0, 1], n_points: 4, mean: 1, std: 0, min: 1, max: 1, order: 1,
    });
    render(<BaselinePanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Baseline method" }), { target: { value: "linear" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply to 3 selected" }));
    });
    const s = useApp.getState();
    expect(vi.mocked(baselineRegion)).toHaveBeenCalledTimes(3);
    const out = s.datasets.filter((d) => d.name.endsWith("(bg-sub)"));
    expect(out.map((d) => d.name)).toEqual(["Raman_A (bg-sub)", "Raman_B (bg-sub)", "Raman_C (bg-sub)"]);
    expect(s.folders).toHaveLength(1);
    expect(out.every((d) => d.folderId === s.folders[0].id)).toBe(true);
    expect(s.history).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Overlay these 3/ })).toBeInTheDocument();
    act(() => useApp.getState().undo());
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().folders).toHaveLength(0);
  });

  it("binds each dataset's channel by label, not by the plot's column index; a missing column fails the whole batch", async () => {
    vi.mocked(baselineRegion).mockResolvedValue({
      background: [1, 1, 1, 1], coeffs: [0, 1], n_points: 4, mean: 1, std: 0, min: 1, max: 1, order: 1,
    });
    const swapped: DataStruct = { ...raw, values: raw.values.map((r) => [99, r[0]]), labels: ["Temp", "Intensity"], units: ["K", "cps"] };
    useApp.setState({ datasets: [spectrum("A.txt", "a"), { id: "b", name: "B.txt", data: swapped }], selectedIds: ["a", "b"] });
    render(<BaselinePanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Baseline method" }), { target: { value: "linear" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply to 2 selected" }));
    });
    expect(vi.mocked(baselineRegion).mock.calls.map((c) => c[0].y)).toEqual([[10, 12, 11, 13], [10, 12, 11, 13]]);
    const bOut = useApp.getState().datasets.find((d) => d.name === "B (bg-sub)");
    expect(bOut?.data.values.map((r) => r[0])).toEqual([99, 99, 99, 99]); // Temp untouched

    const other: DataStruct = { ...raw, labels: ["Counts"] };
    act(() => useApp.setState({ datasets: [spectrum("A.txt", "a"), { id: "c", name: "C.txt", data: other }], selectedIds: ["a", "c"], activeId: "a", history: [], folders: [] }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply to 2 selected" }));
    });
    expect(screen.getByText(/C\.txt: no "Intensity" column/)).toBeInTheDocument();
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().folders).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("each batch output is a linked result with recorded inputs; a repeat Apply adds nothing; a source edit marks it out of date", async () => {
    vi.mocked(baselineRegion).mockResolvedValue({
      background: [1, 1, 1, 1], coeffs: [0, 1], n_points: 4, mean: 1, std: 0, min: 1, max: 1, order: 1,
    });
    useApp.setState({ analysisResults: [], staleDatasets: [], staleFits: [], recalcMode: "manual" });
    render(<BaselinePanel />);
    fireEvent.change(screen.getByRole("combobox", { name: "Baseline method" }), { target: { value: "linear" } });
    const apply = async () => {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Apply to 3 selected" }));
      });
    };
    await apply();
    const results = useApp.getState().analysisResults;
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.sources[0]!.datasetId)).toEqual(["a", "b", "c"]);
    expect(results[0]!.producer).toEqual({ id: "baseline-batch", label: "Baseline subtract (batch)", version: 1 });
    expect(results[0]!.parameters?.["settings"]).toMatchObject({ method: "linear" });
    expect(results[0]!.parameters?.["inputs"]).toMatchObject({ total: 1, items: [{ datasetId: "a", rows: 4, includedRows: 4, channels: [{ label: "Intensity", unit: "cps" }] }] });
    // Repeat: nothing new, no empty folder, no extra undo entry.
    await apply();
    expect(useApp.getState().datasets).toHaveLength(6);
    expect(useApp.getState().analysisResults).toHaveLength(3);
    expect(useApp.getState().folders).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
    // A source edit marks that source's output out of date.
    const outputOfA = results[0]!.outputs[0]!.datasetId;
    act(() => useApp.getState().touchDataset("a"));
    expect(useApp.getState().staleDatasets).toEqual([outputOfA]);
  });
});
