// Roadmap row 23 — the SIMS workshop's Align tab: previews the aligned
// worksheet (provisional, nothing created), Create records one `simsalign`
// step, Close/unmount mid-Create adds nothing, and a refusal shows its message.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimsCompareRequest, SimsCompareResult, SimsRegionRequest, SimsRegionResult } from "../../../lib/api/sims";
import type { DataStruct } from "../../../lib/types";
import { useSimsDialog } from "../../../store/simsDialog";
import { useApp } from "../../../store/useApp";
import SimsPanel from "./SimsPanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/sims", () => ({ processSims: vi.fn(), compareSims: vi.fn(), measureSimsRegion: vi.fn() }));
const { compareSims, measureSimsRegion } = await import("../../../lib/api/sims");

function fakeRegion(body: SimsRegionRequest): Promise<SimsRegionResult> {
  const c = body.columns?.[0] ?? 0;
  const y = body.dataset.values.map((r) => r[c]);
  const k = y.indexOf(Math.max(...y));
  const sp = { name: body.dataset.labels[c], unit: "c/s", points: y.length, blank: 0, peak: y[k], peak_depth: body.dataset.time[k], junction_depth: null, crossings: [] };
  return Promise.resolve({ x_unit: "nm", species: [sp], warnings: [] } as unknown as SimsRegionResult);
}

function fakeCompare(body: SimsCompareRequest): Promise<SimsCompareResult> {
  const time = body.profiles.flatMap((p) => p.dataset.time);
  return Promise.resolve({
    dataset: { time, values: time.map(() => [1]), labels: ["B"], units: ["c/s"], metadata: { technique: "sims", x_column_unit: "nm" } },
    warnings: [], traces: [{ label: "B" }],
  });
}

const prof = (peak: number, unit = "nm"): DataStruct => ({
  time: [0, 10, 20], values: [0, 1, 2].map((i) => [i === peak ? 9 : 1, 5]), labels: ["B", "Si"], units: ["c/s", "c/s"],
  metadata: { x_column_name: "Depth", x_column_unit: unit, technique: "sims" },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(measureSimsRegion).mockImplementation(fakeRegion);
  vi.mocked(compareSims).mockImplementation(fakeCompare);
  useApp.setState({
    datasets: [{ id: "s1", name: "a.csv", data: prof(0) }, { id: "s2", name: "b.csv", data: prof(2) }],
    folders: [], activeId: "s1", selectedIds: ["s1", "s2"], macroRecording: true, macroSteps: [], history: [], future: [],
    analysisResults: [], staleDatasets: [],
  });
  useSimsDialog.setState({ seed: "s1", opened: 1 });
});

const store = useApp.getState;
const openAlign = () => {
  const view = render(<SimsPanel />);
  fireEvent.click(screen.getByRole("radio", { name: "Align" }));
  return view;
};

describe("SIMS Align tab", () => {
  it("previews provisionally, then Create records one aligned worksheet", async () => {
    openAlign();
    const preview = await screen.findByRole("group", { name: "Alignment preview" });
    expect(preview.closest("[data-provisional]")).toHaveTextContent("Preview (not saved)");
    expect(within(preview).getByLabelText("Depth shifts")).toHaveTextContent("b.csv: peak at 20, shifted by -20");
    expect(store().datasets).toHaveLength(2);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create aligned worksheet" })));
    await waitFor(() => expect(store().datasets).toHaveLength(3));
    expect(store().datasets[2].name).toBe("a + 1 (SIMS aligned)");
    expect(store().macroSteps.map((s) => (s.params as { op?: string }).op)).toEqual(["simsalign"]);
    expect(store().history).toHaveLength(1);
  });

  it("needs two profiles", () => {
    useApp.setState({ selectedIds: ["s1"] });
    openAlign();
    expect(screen.getByText("Pick at least 2 profiles to align.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create aligned worksheet" })).toBeDisabled();
  });

  it("shows a refusal (mixed depth units) and creates nothing", async () => {
    useApp.setState({ datasets: [{ id: "s1", name: "a.csv", data: prof(0) }, { id: "s2", name: "b.csv", data: prof(2, "um") }] });
    openAlign();
    expect(await screen.findByText(/depth units differ/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create aligned worksheet" })).toBeDisabled();
    expect(store().datasets).toHaveLength(2);
  });

  it("forces the Close race: unmounting while Create resolves its inputs adds nothing", async () => {
    const view = openAlign();
    await screen.findByRole("group", { name: "Alignment preview" });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const real = store().resolveDatasets;
    useApp.setState({ resolveDatasets: async (ids: string[]) => { await gate; return real(ids); } });
    fireEvent.click(screen.getByRole("button", { name: "Create aligned worksheet" }));
    view.unmount();
    await act(async () => { release(); await gate; });
    expect(store().datasets).toHaveLength(2);
    expect(store().macroSteps).toHaveLength(0);
  });

  it("Close leaves no dataset or recorded step", async () => {
    openAlign();
    await screen.findByRole("group", { name: "Alignment preview" });
    act(() => useSimsDialog.getState().close());
    expect(store().datasets).toHaveLength(2);
    expect(store().history).toHaveLength(0);
    expect(store().macroSteps).toEqual([]);
  });
});
