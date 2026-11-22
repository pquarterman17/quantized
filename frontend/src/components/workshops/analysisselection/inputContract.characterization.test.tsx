// Characterization of how general analysis tools resolve their inputs, pinned
// BEFORE they moved onto the shared resolver (lib/analysisInputs). Each tool
// keeps these defaults; the shared summary only states them.
//
// Fixture: six rows, row 1 manually excluded, row 5 filtered out (time > 4.5),
// rows 0 and 2 selected, and a fit X range over the first half.

import type { ReactNode } from "react";
import { render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections, statsGrubbs, statsHistogram, statsShapiro } from "../../../lib/api";
import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useDistribution } from "../distribution/useDistribution";
import { useOutlierScreening } from "../outliers/useOutlierScreening";
import SignalProcessingPanel from "../signalprocessing/SignalProcessingPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsHistogram: vi.fn(),
  statsShapiro: vi.fn(),
  statsFitDistributions: vi.fn(),
  statsGrubbs: vi.fn(),
  applyCorrections: vi.fn(),
  fetchBookData: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
}));

const SHEET: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2, 3, 4, 5],
    values: [[10, 1], [20, 2], [30, 3], [40, 4], [50, 5], [60, 6]],
    labels: ["v", "w"],
    units: ["V", "A"],
    metadata: { x_column_name: "T" },
  },
  excludedRows: [1],
  filter: [{ col: -1, kind: "range", max: 4.5 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsHistogram).mockResolvedValue({ counts: [1], centers: [1], edges: [0, 2], n_bins: 1, n: 4 } as never);
  vi.mocked(statsShapiro).mockResolvedValue({ W: 1, p: 1, N: 4 } as never);
  vi.mocked(statsDescriptive).mockResolvedValue({ N: 4 } as never);
  vi.mocked(statsGrubbs).mockResolvedValue({
    G: 1, G_critical: 2, flagged: false, flagged_indices: [], index: 0, value: 0, tail: "two-sided",
    alpha: 0.05, N: 4, excluded_indices: [], method: "Grubbs",
  } as never);
  vi.mocked(applyCorrections).mockImplementation((async ({ dataset }: { dataset: Dataset["data"] }) => structuredClone(dataset)) as never);
  useApp.setState({
    datasets: [SHEET], activeId: "d1", selectedIds: [], xKey: null, yKeys: [0], seriesOrder: null,
    selection: { datasetId: "d1", rows: [0, 2] },
    qfitRoi: [0, 2.5], qfitRoiFor: "d1",
    status: "", reports: [], analysisResults: [], history: [], future: [],
    signalProcessingOpen: true,
  });
});

describe("input resolution today (characterization)", () => {
  it("Distribution: active worksheet, own column pick, exclusions + filters dropped, row selection and range ignored", async () => {
    renderHook(() => useDistribution());
    await waitFor(() => expect(vi.mocked(statsHistogram).mock.calls.length).toBeGreaterThan(0));
    expect(vi.mocked(statsHistogram).mock.calls.at(-1)![0]).toEqual([10, 30, 40, 50]);
  });

  it("Outlier screening: active worksheet, first continuous column, exclusions + filters dropped, selection and range ignored", async () => {
    const { result } = renderHook(() => useOutlierScreening());
    expect(result.current.col).toBe(0);
    await waitFor(() => expect(vi.mocked(statsGrubbs).mock.calls.length).toBeGreaterThan(0));
    expect(vi.mocked(statsGrubbs).mock.calls.at(-1)![0]).toEqual([10, 30, 40, 50]);
  });

  it("Signal Processing: the full worksheet, including excluded and filtered-out rows", async () => {
    render(<SignalProcessingPanel />);
    await waitFor(() => expect(vi.mocked(applyCorrections).mock.calls.length).toBeGreaterThan(0));
    const sent = vi.mocked(applyCorrections).mock.calls.at(-1)![0] as { dataset: Dataset["data"] };
    expect(sent.dataset.time).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
