// The Region tab's batch over selected profiles, end to end through the shared
// StatsBatchSection / AnalysisBatchControls and commitBatchTable: one table row
// per profile, the summary worksheet on the result-lifecycle contract (one undo
// step, linked to every profile), and every refusal failing closed.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimsRegionRequest, SimsRegionResult } from "../../../lib/api/sims";
import type { AnalysisResult } from "../../../lib/analysisResult";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import SimsRegionBatchSection from "./SimsRegionBatchSection";
import type { RegionForm } from "./useSimsRegion";

vi.mock("../../../lib/api/sims", () => ({ measureSimsRegion: vi.fn() }));
const { measureSimsRegion } = await import("../../../lib/api/sims");

const profile = (over: Partial<DataStruct> = {}): DataStruct => ({
  time: [0, 10, 20, 30], values: [[1, 5], [3, 5], [5, 5], [3, 5]], labels: ["B", "Si"], units: ["atoms/cm3", "atoms/cm3"],
  metadata: { x_column_name: "Depth", x_column_unit: "nm" }, ...over,
});
const sheet = (id: string, data: DataStruct): Dataset => ({ id, name: `${id}.csv`, data });
const form: RegionForm = { lo: "0", hi: "30", species: ["B"], mode: "fraction", threshold: "50" };

/** The backend's answer, with the peak scaled by the profile's own first value so rows differ. */
function fake(body: SimsRegionRequest): Promise<SimsRegionResult> {
  const k = body.dataset.values[0]![0]!;
  return Promise.resolve({
    region: [body.lo, body.hi], x_name: "Depth", x_unit: String(body.dataset.metadata?.["x_column_unit"] ?? ""),
    rows_in_region: 4, method: {}, csv: "", warnings: [],
    species: (body.columns ?? []).map((c) => ({
      name: body.dataset.labels[c]!, unit: "atoms/cm3", points: 4, blank: 0, integral: k * 1e-4, integral_unit: "atoms/cm^2",
      integral_kind: "areal-dose" as const, integrated_from: 0, integrated_to: 30, peak: 5 * k, peak_depth: 20, mean: 3,
      threshold: 2.5, crossings: [], junction_depth: 25 + k, junction_direction: "falling" as const,
    })),
  } as SimsRegionResult);
}

function setup(datasets: Dataset[]) {
  useApp.setState({
    datasets, activeId: datasets[0]!.id, selectedIds: datasets.map((d) => d.id), xKey: null, yKeys: [0], seriesOrder: null,
    errKeys: {}, selection: null, analysisResults: [], history: [], future: [], status: "", staleDatasets: [], staleFits: [],
    recalcMode: "manual",
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
  return render(<SimsRegionBatchSection form={form} species={["B"]} xUnit="nm" formError={null} />);
}
const openBatch = () => fireEvent.click(screen.getByRole("button", { name: /Batch over selected worksheets/ }));
const run = () => fireEvent.click(screen.getByRole("button", { name: "Run SIMS region batch" }));
const finished = () => waitFor(() => expect(useApp.getState().status).toMatch(/batch finished/));
const tableRows = () => useApp.getState().analysisResults[0]!.tables![0]!.rows as (string | number | null)[][];
const derived = (ids: string[]) => useApp.getState().datasets.filter((d) => !ids.includes(d.id));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(measureSimsRegion).mockImplementation(fake);
  useAnalysisSelection.setState({ toolId: null, selection: null });
  usePendingOps.setState({ ops: [] });
});

describe("SIMS region batch", () => {
  it("claims no selection until opened, then records one row per profile with the measures", async () => {
    setup([sheet("a", profile()), sheet("b", profile({ values: [[2, 5], [3, 5], [5, 5], [3, 5]] }))]);
    expect(useAnalysisSelection.getState().toolId).toBeNull();
    openBatch();
    expect(useAnalysisSelection.getState().toolId).toBe("sims-region");
    run();
    await finished();
    const result = useApp.getState().analysisResults[0] as AnalysisResult;
    expect(result.tables![0]!.columns.slice(3, -1)).toEqual([
      "Depth unit", "B integral", "B integral unit", "B peak", "B peak depth", "B mean", "B value unit", "B junction depth",
    ]);
    expect(tableRows().map((r) => [r[0], r[1], r[2], r[4], r[6], r[8], r[10]])).toEqual([
      ["a.csv", "Completed", 4, 1e-4, 5, 3, 26],
      ["b.csv", "Completed", 4, 2e-4, 10, 3, 27],
    ]);
    expect(result.parameters).toMatchObject({ toolId: "sims-region", xUnit: "nm", allowBlanks: false });
  });

  it("refuses to run when a selected profile is in another depth unit", () => {
    setup([sheet("a", profile()), sheet("b", profile({ metadata: { x_column_unit: "A" } }))]);
    openBatch();
    expect(screen.getByText(/b\.csv \(A\)/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Run SIMS region batch" }) as HTMLButtonElement).disabled).toBe(true);
    expect(measureSimsRegion).not.toHaveBeenCalled();
  });

  it("fails a profile missing the species, and one with infinite data, without posting them", async () => {
    setup([
      sheet("a", profile()), sheet("nob", profile({ labels: ["P", "Si"] })),
      sheet("inf", profile({ values: [[1, 5], [Infinity, 5], [5, 5], [3, 5]] })),
    ]);
    openBatch();
    run();
    await finished();
    const byName = Object.fromEntries(tableRows().map((r) => [r[0], r]));
    expect(byName["a.csv"]![1]).toBe("Completed");
    expect(byName["nob.csv"]![1]).toBe("Failed");
    expect(String(byName["nob.csv"]![byName["nob.csv"]!.length - 1])).toContain('no species "B"');
    expect(byName["inf.csv"]![1]).toBe("Failed");
    expect(String(byName["inf.csv"]![byName["inf.csv"]!.length - 1])).toContain("infinite");
    expect(measureSimsRegion).toHaveBeenCalledTimes(1);
  });

  it("commits the summary worksheet as one undo step, linked to every profile (repeat-click dedupe: resultLifecycleContract)", async () => {
    const a = sheet("a", profile());
    const b = sheet("b", profile({ values: [[2, 5], [3, 5], [5, 5], [3, 5]] }));
    setup([a, b]);
    openBatch();
    run();
    await finished();
    const before = useApp.getState().history.length;
    const create = () => fireEvent.click(screen.getByRole("button", { name: "Create summary worksheet" }));
    create();
    const [out] = derived(["a", "b"]);
    expect(out!.data.units).toEqual(["atoms/cm^2", "atoms/cm3", "nm", "atoms/cm3", "nm"]);
    expect(out!.data.values[1]![0]).toBe(2e-4);
    expect(useApp.getState().history.length).toBe(before + 1);
    expect(useApp.getState().datasets.find((d) => d.id === "a")).toBe(a); // raw source untouched
    const summary = useApp.getState().analysisResults.find((r) => r.producer.id === "sims-region-batch-summary")!;
    expect(summary.sources.map((s) => s.datasetId)).toEqual(["a", "b"]);
  });

  it("refuses the summary worksheet while any profile failed", async () => {
    setup([sheet("a", profile()), sheet("nob", profile({ labels: ["P", "Si"] }))]);
    openBatch();
    run();
    await finished();
    fireEvent.click(screen.getByRole("button", { name: "Create summary worksheet" }));
    expect(derived(["a", "nob"])).toHaveLength(0);
    expect(useApp.getState().status).toMatch(/nob\.csv \(failed/);
  });

  it("fails a profile with blank samples in the region unless bridging is opted in", async () => {
    vi.mocked(measureSimsRegion).mockImplementation(async (body) => {
      const r = await fake(body);
      return { ...r, species: r.species.map((s) => ({ ...s, blank: 1 })) };
    });
    setup([sheet("a", profile())]);
    openBatch();
    run();
    await finished();
    expect(tableRows()[0]![1]).toBe("Failed");
    fireEvent.click(screen.getByRole("checkbox", { name: /Bridge blank samples/ }));
    run();
    await waitFor(() => expect(useApp.getState().analysisResults.length).toBe(2));
    expect(useApp.getState().analysisResults[1]!.tables![0]!.rows[0]![1]).toBe("Completed");
  });
});
