// Two undo/redo residuals of the 2026-10-01 undo-coverage audit, each pinned
// do → undo → redo against `restorePatch` (store/historySnapshot.ts):
//
//  1. Break at gaps. Its panels live in `composition`, a render cache outside
//     the snapshot. A facet rebuilds from the durable `facetKey`; a break has
//     no such binding, so redo brought back `stackMode` without the panels,
//     and undoing ANY later edit wiped a live break. The snapshot now carries
//     the break composition by reference.
//     The same holds for an Origin multi-panel (spatial) apply: its placed
//     panels exist only in `composition`, so the snapshot carries a spatial
//     composition too. Facets stay excluded (they rebuild from `facetKey`).
//  2. `openReportId` is UI state outside the snapshot. Undoing "add report"
//     removed the report the viewer was showing and left the id dangling, so
//     the viewer opened on nothing. Restore now drops an id whose report is gone.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { breakPanelsOf, facetPanelsOf, spatialPanelsOf } from "../lib/composition";
import type { ReportSheet } from "../lib/report";
import type { Dataset, DataStruct } from "../lib/types";
import { snapshotOf } from "./historySnapshot";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { useApp } from "./useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

// Warm the lazy Origin-apply chunk so `applyOriginFigure` runs synchronously.
beforeAll(async () => {
  await loadOriginApplyLibs();
});

/** Two clusters of x with a wide gap — `suggestBreaks` finds one break. */
const gapped: DataStruct = {
  time: [1, 2, 3, 100, 101, 102],
  values: [[1, 0], [2, 0], [3, 1], [4, 1], [5, 0], [6, 1]],
  labels: ["ch0", "ch1"],
  units: ["", ""],
  metadata: {},
};
const ds = (id: string, data: DataStruct): Dataset => ({ id, name: id, data });
const sheet = (title: string): ReportSheet => ({ title, sections: [] });

const app = () => useApp.getState();

beforeEach(() => {
  useApp.setState({
    datasets: [ds("g1", gapped)],
    activeId: "g1",
    worksheetId: null,
    selectedIds: [],
    librarySelection: null,
    composition: null,
    facetKey: null,
    stackMode: false,
    xKey: null,
    yKeys: [0],
    showGrid: true,
    reports: [],
    openReportId: null,
    history: [],
    future: [],
  });
});

describe("break at gaps survives undo/redo", () => {
  it("do → undo → redo shows the SAME break panels again", () => {
    app().breakAtGaps("g1");
    const broken = app().composition;
    expect(breakPanelsOf(broken)).toHaveLength(2);

    app().undo();
    expect(app().composition).toBeNull();
    expect(app().stackMode).toBe(false);

    app().redo();
    expect(app().stackMode).toBe(true);
    expect(app().composition).toBe(broken);
  });

  it("undoing a LATER edit keeps the break on screen", () => {
    app().breakAtGaps("g1");
    const broken = app().composition;
    app().setShowGrid(false);

    app().undo();
    expect(app().showGrid).toBe(true);
    expect(app().composition).toBe(broken);

    app().redo();
    expect(app().showGrid).toBe(false);
    expect(app().composition).toBe(broken);
  });

  it("a facet is NOT carried — it rebuilds from facetKey instead", () => {
    app().facetByColumn("g1", 1);
    expect(facetPanelsOf(app().composition)).not.toBeNull();
    expect(snapshotOf(app()).carriedComposition).toBeNull();

    app().setShowGrid(false);
    app().undo();
    expect(app().composition).toBeNull();
    expect(app().facetKey).toBe(1);
  });

  it("undoing a break back to a facet drops the break and keeps the facet binding", () => {
    app().facetByColumn("g1", 1);
    app().breakAtGaps("g1");
    expect(app().facetKey).toBeNull();

    app().undo();
    expect(app().composition).toBeNull();
    expect(app().facetKey).toBe(1);
  });
});

/** One Origin book: x column "A", value columns "B".."D". */
const book = (name: string): DataStruct => ({
  time: [1, 2, 3],
  values: [[10, 1, 1000], [20, 1, 2000], [30, 2, 3000]],
  labels: ["ch0", "ch1", "ch2"],
  units: ["", "", ""],
  metadata: { origin_book: name, x_column_name: "A", origin_column_names: ["B", "C", "D"] },
});

/** Two same-window layers bound to DIFFERENT datasets — the spatial apply. */
const spatialEntry = (id: string, layer: number, datasetId: string, bookName: string) => ({
  id,
  stem: "SI",
  datasetId,
  siblingIds: ["p1", "p2"],
  figure: {
    name: "Graph6",
    layer,
    x_from: 0,
    x_to: 10,
    x_log: false,
    y_from: 0,
    y_to: 100 * layer,
    y_log: false,
    n_curves: 1,
    annotations: [] as string[],
    curves: [{ book: bookName, x: "A", y: "B" }],
    frame: null,
  },
});

describe("Origin multi-panel (spatial) apply survives undo/redo", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [{ id: "p1", name: "SI:Book1", data: book("Book1") }, { id: "p2", name: "SI:Book2", data: book("Book2") }],
      activeId: null,
      originFigures: [spatialEntry("fig-sp-1", 1, "p1", "Book1"), spatialEntry("fig-sp-2", 2, "p2", "Book2")],
    });
  });

  it("apply → undo → redo shows the SAME panels again", () => {
    app().applyOriginFigure("fig-sp-1");
    const placed = app().composition;
    expect(spatialPanelsOf(placed)).toHaveLength(2);

    app().undo();
    expect(app().composition).toBeNull();

    app().redo();
    expect(app().stackMode).toBe(true);
    expect(app().composition).toBe(placed);
  });

  it("undoing a LATER edit keeps the spatial layout on screen", () => {
    app().applyOriginFigure("fig-sp-1");
    const placed = app().composition;
    expect(app().showGrid).toBe(false); // the Origin apply turns the grid off
    app().setShowGrid(true);

    app().undo();
    expect(app().showGrid).toBe(false);
    expect(app().composition).toBe(placed);

    app().redo();
    expect(app().showGrid).toBe(true);
    expect(app().composition).toBe(placed);
  });
});

describe("openReportId never dangles after undo/redo", () => {
  it("do → undo → redo: undoing the add closes the viewer instead of opening it on nothing", () => {
    app().addReport("peak fit", sheet("P"));
    const id = app().reports[0].id;
    expect(app().openReportId).toBe(id);

    app().undo();
    expect(app().reports).toEqual([]);
    expect(app().openReportId).toBeNull();

    app().redo();
    expect(app().reports.map((r) => r.id)).toEqual([id]);
    expect(app().openReportId).toBeNull();
  });

  it("an open report that survives the restore stays open", () => {
    app().addReport("a", sheet("A"));
    const a = app().reports[0].id;
    app().renameReport(a, "a2");
    expect(app().openReportId).toBe(a);

    app().undo();
    expect(app().reports[0].name).toBe("a");
    expect(app().openReportId).toBe(a);

    app().redo();
    expect(app().openReportId).toBe(a);
  });

  it("redo that removes the open report closes the viewer too", () => {
    app().addReport("a", sheet("A"));
    const a = app().reports[0].id;
    app().removeReport(a);
    app().undo();
    app().setOpenReport(a);

    app().redo();
    expect(app().reports).toEqual([]);
    expect(app().openReportId).toBeNull();
  });
});
