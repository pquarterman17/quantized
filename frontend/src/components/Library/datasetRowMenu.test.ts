// PR F, L0.38: Quick Plot's position in the worksheet row's full context
// menu -- right after the "plot" group (Plot (make active), Plot in new
// window), before Duplicate/Rename/etc.

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
  it("Quick Plot appears right after the 'Plot in new window' entry", () => {
    const ds = dataset("d1");
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    const labels = items.map(labelOf);
    const plotInNewWindowIdx = labels.indexOf("Plot in new window");
    const quickPlotIdx = labels.indexOf("Quick Plot");
    expect(plotInNewWindowIdx).toBeGreaterThanOrEqual(0);
    expect(quickPlotIdx).toBe(plotInNewWindowIdx + 1);
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
      "unrecognized data — Configure Quick Plot arrives with the Quick Figure Builder (PR G)",
    );
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
