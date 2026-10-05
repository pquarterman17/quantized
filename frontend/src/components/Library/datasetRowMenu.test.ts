// PR F, L0.38: Quick Plot's position in the worksheet row's full context
// menu -- right after the plot/window group (Plot (make active), Plot in new
// window, Open worksheet in window), before Duplicate/Rename/etc.

import { beforeEach, describe, expect, it } from "vitest";

import { buildDatasetRowMenu } from "./datasetRowMenu";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";

function dataset(id: string, technique = "magnetometry.mvsh"): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [3, 30]],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: { technique },
    },
  };
}

beforeEach(() => {
  useApp.setState({ selectedIds: [] });
});

function labelOf(item: unknown): string | undefined {
  return item && typeof item === "object" && "label" in item ? (item as { label: string }).label : undefined;
}

describe("buildDatasetRowMenu — Quick Plot ordering (L0.38)", () => {
  it("keeps the worksheet-window shortcut with the plot actions, before Quick Plot", () => {
    const ds = dataset("d1");
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    const labels = items.map(labelOf);
    const plotInNewWindowIdx = labels.indexOf("Plot in new window");
    const worksheetWindowIdx = labels.indexOf("Open worksheet in window");
    const quickPlotIdx = labels.indexOf("Quick Plot");
    expect(plotInNewWindowIdx).toBeGreaterThanOrEqual(0);
    expect(worksheetWindowIdx).toBe(plotInNewWindowIdx + 1);
    expect(quickPlotIdx).toBe(worksheetWindowIdx + 1);
  });

  it("opens the selected dataset as a live worksheet window", () => {
    const ds = dataset("d1");
    useApp.setState({
      datasets: [ds],
      activeId: ds.id,
      plotCanvasBounds: { width: 900, height: 600 },
    });
    const items = buildDatasetRowMenu(ds, true, false, [], false, false, () => {}, () => {});
    const openWorksheet = items.find((item) => labelOf(item) === "Open worksheet in window");
    expect(openWorksheet && "run" in openWorksheet).toBe(true);
    if (openWorksheet && "run" in openWorksheet) openWorksheet.run();
    const windows = useApp.getState().plotWindows;
    expect(windows.some((win) => win.kind === "worksheet" && win.datasetId === ds.id)).toBe(true);
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("Configure Quick Plot… immediately follows Quick Plot", () => {
    const ds = dataset("d1");
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    const labels = items.map(labelOf);
    const quickPlotIdx = labels.indexOf("Quick Plot");
    expect(labels[quickPlotIdx + 1]).toBe("Configure Quick Plot…");
  });

  it("Quick Plot is disabled with a reason for a generic dataset row", () => {
    const ds = dataset("d1", "generic");
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    const quickPlot = items.find((i) => labelOf(i) === "Quick Plot") as { disabled?: boolean; title?: string };
    expect(quickPlot.disabled).toBe(true);
    expect(quickPlot.title).toBe(
      "unrecognized data — choose Configure Quick Plot… to assign columns and preview an editable figure",
    );
  });

  // LIBRARY_WORKBOOK_UX_PLAN acceptance scenario: "Right-click an unknown
  // CSV: Quick Plot is disabled with a short reason; Configure Quick Plot
  // remains available." The test above pins the disabled half; this pins
  // the OTHER half on the SAME row — `datasetQuickPlotActions` (lib/
  // quickPlotActions.ts) gates only "dataset.quickPlot", never
  // "dataset.configureQuickPlot", so the entry must be present and enabled
  // even when Quick Plot itself is refused.
  it("Configure Quick Plot… remains enabled on the SAME generic (unknown) dataset row Quick Plot refuses", () => {
    const ds = dataset("d1", "generic");
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    // A `hidden`-gated entry (Quick Plot With…, "Move to …" self-entries,
    // etc.) is OMITTED from `items` entirely (buildMenuItems), so finding it
    // here already proves it was never hidden for this row.
    const configure = items.find((i) => labelOf(i) === "Configure Quick Plot…") as
      | { disabled?: boolean }
      | undefined;
    expect(configure).toBeDefined();
    expect(configure!.disabled).toBeFalsy();
  });
});

// LIBRARY_WORKBOOK_UX_PLAN PR K slice 2 (L0.50): Create Derived Worksheet /
// Freeze Copy — exactly one of the two is ever offered on a dataset row.
describe("buildDatasetRowMenu — Create Derived Worksheet / Freeze Copy (PR K slice 2)", () => {
  it("offers 'Create Derived Worksheet' (not Freeze Copy) on an ordinary dataset", () => {
    const ds = dataset("d1");
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    const labels = items.map(labelOf);
    expect(labels).toContain("Create Derived Worksheet");
    expect(labels).not.toContain("Freeze Copy");
  });

  it("offers 'Freeze Copy' (not Create Derived Worksheet) on a derived worksheet", () => {
    const ds: Dataset = { ...dataset("d1"), derivedFrom: { datasetId: "src", pipeline: "x" } };
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    const labels = items.map(labelOf);
    expect(labels).toContain("Freeze Copy");
    expect(labels).not.toContain("Create Derived Worksheet");
  });
});
