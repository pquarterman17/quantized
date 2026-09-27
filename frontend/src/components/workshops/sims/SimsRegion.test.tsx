// P2.3 box 4 — the SIMS workshop's Region tab: the region defaults to the
// whole profile, is measured live (the request names the columns and the
// threshold rule), and the result exports as the backend's provenance CSV or
// lands in Reports tied to its dataset. Measuring creates and records nothing.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimsRegionRequest, SimsRegionResult } from "../../../lib/api/sims";
import type { DataStruct } from "../../../lib/types";
import { useSimsDialog } from "../../../store/simsDialog";
import { useApp } from "../../../store/useApp";
import SimsPanel from "./SimsPanel";
import { fmtNum } from "./SimsRegionView";
import { leftOut, regionRequest } from "./useSimsRegion";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/sims", () => ({ processSims: vi.fn(), compareSims: vi.fn(), measureSimsRegion: vi.fn() }));
vi.mock("../../../lib/api/report", () => ({ reportEmit: vi.fn() }));
vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));
const { measureSimsRegion } = await import("../../../lib/api/sims");
const { reportEmit } = await import("../../../lib/api/report");
const { saveBlob } = await import("../../../lib/download");

const profile: DataStruct = {
  time: [0, 10, 20, 30, 40],
  values: [[1e18, 5e22], [3e18, 5e22], [5e18, 5e22], [3e18, 5e22], [1e18, 5e22]],
  labels: ["B", "Si"],
  units: ["atoms/cm3", "atoms/cm3"],
  metadata: { x_column_name: "Depth", x_column_unit: "nm" },
};

function fakeRegion(body: SimsRegionRequest): Promise<SimsRegionResult> {
  const species = (body.columns ?? []).map((c) => ({
    name: body.dataset.labels[c], unit: "atoms/cm3", points: 5, blank: 0,
    integral: 1.2e13, integral_unit: "atoms/cm^2", integral_kind: "areal-dose" as const,
    integrated_from: 0, integrated_to: 40, peak: 5e18, peak_depth: 20, mean: 2.6e18,
    threshold: 2.5e18, crossings: [{ depth: 7.5, direction: "rising" as const }, { depth: 32.5, direction: "falling" as const }],
    junction_depth: 7.5, junction_direction: "rising" as const,
  }));
  return Promise.resolve({
    region: [body.lo, body.hi], x_name: "Depth", x_unit: "nm", rows_in_region: 5,
    method: { threshold_mode: body.threshold_mode, threshold: body.threshold }, species, warnings: [],
    csv: `# SIMS region measures\n# dataset: ${body.dataset_name}\n`,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(measureSimsRegion).mockImplementation(fakeRegion);
  vi.mocked(reportEmit).mockResolvedValue({ report: { title: "SIMS region", sections: [] } });
  useApp.setState({
    datasets: [{ id: "s1", name: "implant.csv", data: profile }],
    folders: [],
    activeId: "s1",
    selectedIds: ["s1"],
    macroRecording: true,
    macroSteps: [],
    reports: [],
  });
  useSimsDialog.setState({ seed: "s1", opened: 1 });
});

const store = useApp.getState;

describe("SIMS Region tab", () => {
  it("measures the whole profile by default, then exports the CSV and adds a report", async () => {
    render(<SimsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Region" }));
    expect((screen.getByRole("textbox", { name: "Region from" }) as HTMLInputElement).value).toBe("0");
    expect((screen.getByRole("textbox", { name: "Region to" }) as HTMLInputElement).value).toBe("40");
    fireEvent.click(within(screen.getByRole("group", { name: "Region species" })).getByRole("checkbox", { name: "Si" }));
    const table = await screen.findByRole("group", { name: "Region measures" });
    expect(table.textContent).toContain("1.200e+13 atoms/cm^2");
    expect(table.textContent).toContain("7.5");
    const body = vi.mocked(measureSimsRegion).mock.calls.at(-1)?.[0];
    expect(body).toMatchObject({ lo: 0, hi: 40, columns: [0], threshold_mode: "fraction", threshold: 0.5, dataset_name: "implant.csv" });
    // Measuring is a report, not derived data.
    expect(store().datasets).toHaveLength(1);
    expect(store().macroSteps).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const [blob, filename] = vi.mocked(saveBlob).mock.calls[0];
    expect(filename).toBe("implant_region_0_40_nm.csv");
    expect(await (blob as Blob).text()).toContain("# dataset: implant.csv");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add to Reports" })));
    await waitFor(() => expect(store().reports).toHaveLength(1));
    expect(vi.mocked(reportEmit).mock.calls[0][0]).toMatchObject({
      kind: "sims_region",
      source_refs: [{ kind: "dataset", id: "s1", name: "implant.csv" }],
    });
    expect(store().reports[0]).toMatchObject({ datasetId: "s1", name: "SIMS region 0–40 nm — implant.csv" });
  });

  it("an absolute threshold is sent as typed; the region form refuses what is missing", () => {
    expect(regionRequest({ lo: "0", hi: "", species: ["B"], mode: "fraction", threshold: "50" }, ["B"])).toBe(
      "Enter the region's two limits.",
    );
    expect(regionRequest({ lo: "0", hi: "1", species: [], mode: "fraction", threshold: "50" }, ["B"])).toBe(
      "Pick at least one species.",
    );
    expect(regionRequest({ lo: "0", hi: "1", species: ["B"], mode: "fraction", threshold: "100" }, ["B"])).toMatch(/strictly between/);
    expect(regionRequest({ lo: "5", hi: "1", species: ["B"], mode: "absolute", threshold: "1e17" }, ["Si", "B"])).toEqual({
      lo: 5, hi: 1, columns: [1], threshold_mode: "absolute", threshold: 1e17,
    });
  });

  it("measures the ANALYSIS rows and says so in the CSV provenance when rows were excluded", async () => {
    useApp.setState({ datasets: [{ id: "s1", name: "implant.csv", data: profile, excludedRows: [4] }] });
    render(<SimsPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Region" }));
    await screen.findByRole("group", { name: "Region measures" });
    const body = vi.mocked(measureSimsRegion).mock.calls.at(-1)?.[0];
    expect(body?.dataset.time).toEqual([0, 10, 20, 30]);
    expect(body?.dataset_name).toBe("implant.csv (analysis rows: 1 excluded or filtered row left out)");
    expect(leftOut(5, 5, "x.csv")).toBe("x.csv");
  });

  it("formats table numbers in mono-friendly significant digits", () => {
    expect([null, 7.5, 1.2e13, 0.0004, 0].map(fmtNum)).toEqual(["—", "7.5", "1.200e+13", "4.000e-4", "0"]);
  });
});
