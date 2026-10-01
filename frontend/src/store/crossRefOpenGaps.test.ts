// Cross-reference gaps from the multi-window consistency audit (2026-10-01),
// first pinned here as `it.fails` and now fixed: a source column INSERT under a
// derived sheet (store/derivedSheetShift.ts), a column-changing reimport vs
// legacy FigureDocs/saved specs (store/reimport.ts), and workshop column picks
// (components/workshops/useFollowColumnPicks.ts). Siblings live in
// columnRemovalRefs.test.ts, derivedSheetReshape.test.ts and
// useFollowColumnPicks.test.ts.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOutlierScreening } from "../components/workshops/outliers/useOutlierScreening";
import { importFile } from "../lib/api";
import type { FigureConfig, FigureDoc } from "../lib/figuredoc";
import { emptySpec, type SavedPlotSpec } from "../lib/plotspec";
import type { ComputedColumn, Dataset, DataStruct } from "../lib/types";
import { toast } from "./toasts";
import { useApp } from "./useApp";
import { plotWindowView, syncPlotWindow } from "./windowDocuments";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  applyCorrections: vi.fn(async ({ dataset }: { dataset: DataStruct }) => dataset),
  importFile: vi.fn(),
  // The outlier hook auto-runs a test; never let it settle.
  statsGrubbs: vi.fn(() => new Promise(() => {})),
  statsRosner: vi.fn(() => new Promise(() => {})),
  statsDixonQ: vi.fn(() => new Promise(() => {})),
  statsMadOutliers: vi.fn(() => new Promise(() => {})),
}));
vi.mock("./toasts", () => ({ toast: vi.fn() }));
vi.mock("../lib/desktopBridge", () => ({
  hasDesktopShell: vi.fn(() => false),
  pathState: vi.fn(async () => "unknown"),
}));

const table = (labels: string[], rows: number[][]): DataStruct => ({
  time: rows.map((_, i) => i),
  values: rows,
  labels,
  units: labels.map(() => ""),
  metadata: {},
});

const labelsOf = (id: string, keys: readonly number[] | null | undefined): (string | undefined)[] =>
  (keys ?? []).map((k) => useApp.getState().datasets.find((d) => d.id === id)?.data.labels[k]);

beforeEach(() => {
  useApp.setState({
    datasets: [],
    activeId: null,
    recalcMode: "manual",
    staleDatasets: [],
    staleFits: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    figureDocs: [],
    savedPlotSpecs: [],
    status: "",
  });
});

describe("a derived sheet whose source GAINS a column", () => {
  // Source A, F1; the sheet adds its own G = B + 1 (F1 + 1) after them. A new
  // source column lands BEFORE G in the sheet, so every index on G is stale.
  // A single insertion is detected by label (detectColumnShift) and remapped.
  it("a window on the sheet's own column keeps plotting it", async () => {
    const formulas: ComputedColumn[] = [{ name: "F1", expr: "A * 10", deps: ["A"] }];
    const src: Dataset = { id: "src", name: "src", data: table(["A", "F1"], [[1, 10], [2, 20]]), formulas };
    const der: Dataset = {
      id: "der",
      name: "der",
      data: table(["A", "F1", "G"], [[1, 10, 11], [2, 20, 21]]),
      raw: src.data,
      corrections: {},
      derivedFrom: { datasetId: "src", pipeline: "identity" },
      formulas: [{ name: "G", expr: "B + 1", deps: ["B"] }],
    };
    useApp.setState({ datasets: [src, der] });
    const wid = useApp.getState().createWindow("der");
    useApp.setState((s) => ({
      plotWindows: s.plotWindows.map((w) =>
        w.id === wid ? syncPlotWindow(w, { ...plotWindowView(w), yKeys: [2] }) : w,
      ),
    }));
    useApp.getState().addFormula("src", "F2", "A * 3");
    await useApp.getState().recalcNow();
    const view = plotWindowView(useApp.getState().plotWindows.find((w) => w.id === wid)!);
    expect(labelsOf("der", view.yKeys)).toEqual(["G"]); // was: ["F2"]
  });
});

describe("a column-changing re-import", () => {
  // store/reimport.ts resets the live view, bound windows and editable figures
  // on `columnsChanged`, and now the two holders columnRemovalRefsPatch added.
  function seed(config: Partial<FigureConfig>, spec?: SavedPlotSpec) {
    const doc: FigureDoc = {
      id: "fd",
      name: "fd",
      datasetId: "d1",
      live: true,
      config: {
        xKey: null, yKeys: null, xScale: "linear", yScale: "linear", title: "", xLabel: "", yLabel: "",
        style: "screen", fmt: "png", dpi: 300, overrides: null, seriesStyles: null, ...config,
      },
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "s.dat", data: table(["m"], [[1], [2]]), source: { kind: "path", path: "/s.dat" } }],
      figureDocs: [doc],
      savedPlotSpecs: spec ? [spec] : [],
    });
    vi.mocked(importFile).mockResolvedValue(table(["T", "m"], [[300, 1], [301, 2]]));
  }

  it("a live legacy FigureDoc no longer plots the column that moved into its slot", async () => {
    seed({ yKeys: [0] });
    await useApp.getState().reimportDataset("d1");
    const c = useApp.getState().figureDocs[0].config;
    expect(c.yKeys === null || labelsOf("d1", c.yKeys).join() === "m").toBe(true); // was: ["T"]
  });

  it("a saved Graph Builder spec no longer plots the column that moved into its slot", async () => {
    const spec = { ...emptySpec(), zones: { ...emptySpec().zones, y: [{ datasetId: "d1", channel: 0 }] } };
    seed({}, { id: "p", name: "p", createdAt: "t", modifiedAt: "t", spec });
    await useApp.getState().reimportDataset("d1");
    const y = useApp.getState().savedPlotSpecs[0].spec.zones.y;
    expect(y.length === 0 || labelsOf("d1", y.map((r) => r.channel)).join() === "m").toBe(true); // was: ["T"]
  });

  it("a grouped legacy FigureDoc loses its grouping column with a notice", async () => {
    seed({ yKeys: [0], groupCol: 0 });
    await useApp.getState().reimportDataset("d1");
    expect(useApp.getState().figureDocs[0].config.groupCol).toBeNull();
    expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.stringContaining("grouping column no longer exists"), "info");
  });
});

describe("a workshop's column pick when a column is removed under it", () => {
  // useOutlierScreening (and its siblings) re-derived their pick only when the
  // active dataset's ID changed, so a removed column shifted the pick onto the
  // next column with no notice; picks now follow by label.
  it("Outlier Screening keeps screening F2 after F1 is removed", () => {
    const formulas: ComputedColumn[] = [
      { name: "F1", expr: "A * 1", deps: ["A"] },
      { name: "F2", expr: "A * 2", deps: ["A"] },
      { name: "F3", expr: "A * 3", deps: ["A"] },
    ];
    const rows = [1, 2, 3, 4].map((a) => [a, a, 2 * a, 3 * a]);
    useApp.setState({ datasets: [{ id: "a", name: "a", data: table(["A", "F1", "F2", "F3"], rows), formulas }], activeId: "a" });
    const { result } = renderHook(() => useOutlierScreening());
    act(() => result.current.setCol(2)); // F2
    act(() => useApp.getState().removeFormula("a", 0));
    const picked = result.current.columns.find((c) => c.index === result.current.col)?.label;
    expect(picked).toBe("F2"); // was: "F3"
  });
});
