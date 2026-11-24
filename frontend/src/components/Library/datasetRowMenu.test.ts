// PR F, L0.38: Quick Plot's position in the worksheet row's full context
// menu -- right after the plot/window group (Plot (make active), Plot in new
// window, Open worksheet in window), before Duplicate/Rename/etc.

import { beforeEach, describe, expect, it } from "vitest";

import { buildDatasetRowMenu } from "./datasetRowMenu";
import type { Dataset } from "../../lib/types";
import type { ContextMenuItem } from "../overlays/ContextMenu";
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

/** Every entry, submenus flattened (UX10-C: the row menu files the rarer ones under submenus). */
function flat(items: ContextMenuItem[]): ContextMenuItem[] {
  return items.flatMap((i) => ("submenu" in i ? [i, ...flat(i.submenu)] : [i]));
}
const submenu = (items: ContextMenuItem[], name: string): ContextMenuItem[] => {
  const it = items.find((i) => labelOf(i) === name);
  if (!it || !("submenu" in it)) throw new Error(`no submenu ${name}`);
  return it.submenu;
};

describe("buildDatasetRowMenu — Quick Plot ordering (L0.38)", () => {
  it("keeps Quick Plot right after the plot actions; the worksheet window sits in Open", () => {
    const ds = dataset("d1");
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    const labels = items.map(labelOf);
    const plotInNewWindowIdx = labels.indexOf("Plot in new window");
    expect(plotInNewWindowIdx).toBeGreaterThanOrEqual(0);
    expect(labels[plotInNewWindowIdx + 1]).toBe("Quick Plot");
    expect(labels[plotInNewWindowIdx + 2]).toBe("Open");
    expect(submenu(items, "Open").map(labelOf)).toContain("Open worksheet in window");
  });

  it("opens the selected dataset as a live worksheet window", () => {
    const ds = dataset("d1");
    useApp.setState({
      datasets: [ds],
      activeId: ds.id,
      plotCanvasBounds: { width: 900, height: 600 },
    });
    const items = buildDatasetRowMenu(ds, true, false, [], false, false, () => {}, () => {});
    const openWorksheet = flat(items).find((item) => labelOf(item) === "Open worksheet in window");
    expect(openWorksheet && "run" in openWorksheet).toBe(true);
    if (openWorksheet && "run" in openWorksheet) openWorksheet.run();
    const windows = useApp.getState().plotWindows;
    expect(windows.some((win) => win.kind === "worksheet" && win.datasetId === ds.id)).toBe(true);
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("Configure Quick Plot… sits in the Open submenu, next to the worksheet and workflow entries", () => {
    const ds = dataset("d1");
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    expect(submenu(items, "Open").map(labelOf)).toContain("Configure Quick Plot…");
  });

  it("Quick Plot is disabled with a reason for a generic dataset row", () => {
    const ds = dataset("d1", "generic");
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    const quickPlot = items.find((i) => labelOf(i) === "Quick Plot") as { disabled?: boolean; title?: string };
    expect(quickPlot.disabled).toBe(true);
    expect(quickPlot.title).toBe(
      "needs a recognized technique; Configure Quick Plot… assigns columns and previews an editable figure",
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
    const configure = flat(items).find((i) => labelOf(i) === "Configure Quick Plot…") as
      | { disabled?: boolean }
      | undefined;
    expect(configure).toBeDefined();
    expect(configure!.disabled).toBeFalsy();
  });
});

// LIBRARY_WORKBOOK_UX_PLAN PR K slice 2 (L0.50): Create Derived Worksheet /
// Freeze Copy — exactly one of the two is ever offered on a dataset row.
describe("buildDatasetRowMenu — Create Derived Worksheet / Freeze Copy (PR K slice 2)", () => {
  it("offers 'Create derived worksheet' (not Freeze copy) on an ordinary dataset", () => {
    const ds = dataset("d1");
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    const labels = flat(items).map(labelOf);
    expect(labels).toContain("Create derived worksheet");
    expect(labels).not.toContain("Freeze copy");
  });

  it("offers 'Freeze copy' (not Create derived worksheet) on a derived worksheet", () => {
    const ds: Dataset = { ...dataset("d1"), derivedFrom: { datasetId: "src", pipeline: "x" } };
    const items = buildDatasetRowMenu(ds, false, false, [], false, false, () => {}, () => {});
    const labels = flat(items).map(labelOf);
    expect(labels).toContain("Freeze copy");
    expect(labels).not.toContain("Create derived worksheet");
  });
});
