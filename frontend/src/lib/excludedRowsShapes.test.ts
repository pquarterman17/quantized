// F4.2c (a) for the two figure shapes the flat ghost channels cannot carry:
// a Color/Symbol-ENCODED figure (split server-side, so it sends every row plus
// an `excluded_rows` mask) and a FACETED one (whose Stage grid never draws
// excluded rows, so the export offers only the honest "omit"). Driven through
// the real Export figure command and parameter-dialog store; every wait is on
// dialog STATE, never on a mock having been called.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigure } from "./api/figures";
import { EXCLUDED_GREY_OPTION, EXCLUDED_OMIT_OPTION } from "./excludedRowsChoice";
import { FACET_OMIT_REASON, omitOnlyReason, withExcludedGhosts } from "./excludedRowsExport";
import { runExportFigureCommand } from "./exportFigureCommand";
import { createFigureDocument, type FigureDocument } from "./figureDocument";
import type { FigureEncoding } from "./figureEncoding";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { defaultPlotView } from "./plotview";
import type { DataStruct, Dataset } from "./types";
import { useParamDialog } from "../store/paramDialog";
import { usePendingOps } from "../store/pendingOps";
import { useApp } from "../store/useApp";

vi.mock("./api/figures", () => ({ exportFigure: vi.fn(), renderFigureBlob: vi.fn() }));

// Row 3 is the ONLY row of sample level "c".
const DATA: DataStruct = {
  time: [1, 2, 3, 4],
  values: [
    [10, 0],
    [20, 1],
    [30, 0],
    [40, 2],
  ],
  labels: ["M", "sample"],
  units: ["emu", ""],
  metadata: {},
  cat_levels: { 1: ["a", "b", "c"] },
};

function document(bindings: { encoding?: FigureEncoding; facetKey?: number }): FigureDocument {
  const view = { ...defaultPlotView(), xKey: null, yKeys: [0] };
  return createFigureDocument({ id: "figure-w1", name: "Loop", datasetId: "d1", view, ...bindings });
}

function seed(doc: FigureDocument, excludedRows?: number[]) {
  const ds: Dataset = { id: "d1", name: "scan.dat", data: DATA, ...(excludedRows ? { excludedRows } : {}) };
  const view = { ...defaultPlotView(), xKey: null, yKeys: [0], facetKey: doc.bindings.facetKey };
  // The focused window's document is re-synced from the live view on save
  // (`windowsForSave`), so the live facetKey must match the binding.
  useApp.setState({
    datasets: [ds],
    activeId: "d1",
    yKeys: [0],
    xKey: null,
    facetKey: doc.bindings.facetKey,
    hiddenChannels: [],
    focusedWindowId: "w1",
    plotWindows: [
      {
        id: "w1", kind: "plot", title: "Loop", datasetId: "d1", geometry: { x: 0, y: 0, w: 400, h: 300 },
        z: 0, winState: "normal", view, bg: "theme", linkGroup: null, pinned: false, document: doc,
      },
    ],
  });
}

async function answer(title: string, values: Record<string, string | number | boolean> | null) {
  await vi.waitFor(() => expect(useParamDialog.getState().title).toBe(title));
  const { resolve, fields, close } = useParamDialog.getState();
  close();
  resolve!(values === null ? null : { ...Object.fromEntries(fields.map((f) => [f.key, f.default])), ...values });
}

/** Run Export figure and answer its own dialog; `run` settles with the export
 *  (wrapped, so awaiting this helper does not also await the export). */
async function startExport(): Promise<{ run: Promise<void> }> {
  const run = runExportFigureCommand(useApp.getState);
  await answer("Export figure", {});
  return { run };
}

/** The open excluded-rows question's options, once it is open. */
async function questionOptions(): Promise<unknown[]> {
  await vi.waitFor(() => expect(useParamDialog.getState().title).toBe("Excluded rows"));
  return useParamDialog.getState().fields[0].options ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useParamDialog.getState().close();
  useApp.getState().setPref("excludedDisplay", "grey");
});

afterEach(() => {
  useApp.setState({ datasets: [], activeId: null, focusedWindowId: null, plotWindows: [] });
});

describe("an encoded figure's export honours the excluded-rows choice", () => {
  it("never asks without excluded rows, and sends no mask", async () => {
    seed(document({ encoding: { symbol: 1 } }));
    await (await startExport()).run;
    expect(useParamDialog.getState().title).toBeNull();
    const spec = vi.mocked(exportFigure).mock.calls[0][0];
    expect(spec.encoding?.symbol_col).toBe(1);
    expect(spec).not.toHaveProperty("excluded_rows");
    expect(spec).not.toHaveProperty("grey_excluded");
  });

  it("asks both ways; greyed sends every row, the mask and grey_excluded", async () => {
    seed(document({ encoding: { symbol: 1 } }), [3]);
    const { run } = await startExport();
    expect(await questionOptions()).toEqual([EXCLUDED_GREY_OPTION, EXCLUDED_OMIT_OPTION]);
    await answer("Excluded rows", { mode: EXCLUDED_GREY_OPTION });
    await run;
    const spec = vi.mocked(exportFigure).mock.calls[0][0];
    // Every row, so the backend takes level "c" as the window does.
    expect(spec.dataset.time).toEqual([1, 2, 3, 4]);
    expect(spec.excluded_rows).toEqual([3]);
    expect(spec.grey_excluded).toBe(true);
    expect(spec.y_keys).toEqual([0]); // no client-side ghost channels on an encoded request
  });

  it("omitted keeps the mask (the screen's levels) without greying", async () => {
    seed(document({ encoding: { symbol: 1 } }), [3]);
    const { run } = await startExport();
    await answer("Excluded rows", { mode: EXCLUDED_OMIT_OPTION });
    await run;
    const spec = vi.mocked(exportFigure).mock.calls[0][0];
    expect(spec.dataset.time).toEqual([1, 2, 3, 4]);
    expect(spec.excluded_rows).toEqual([3]);
    expect(spec).not.toHaveProperty("grey_excluded");
  });
});

describe("a faceted figure's export asks with only the honest option", () => {
  it("offers only omit, says why, and exports the pruned facets", async () => {
    seed(document({ facetKey: 1 }), [3]);
    const { run } = await startExport();
    expect(await questionOptions()).toEqual([EXCLUDED_OMIT_OPTION]);
    expect(useParamDialog.getState().message).toBe(FACET_OMIT_REASON);
    await answer("Excluded rows", {});
    await run;
    const spec = vi.mocked(exportFigure).mock.calls[0][0];
    expect(spec.facets?.map((f) => f.label)).toEqual(["a", "b"]); // level "c" was only in row 3
  });

  it("dismissing cancels, and a faceted figure without excluded rows is never asked", async () => {
    seed(document({ facetKey: 1 }), [3]);
    const first = await startExport();
    await answer("Excluded rows", null);
    await first.run;
    expect(exportFigure).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("export cancelled");

    seed(document({ facetKey: 1 }));
    await (await startExport()).run;
    expect(useParamDialog.getState().title).toBeNull();
    expect(vi.mocked(exportFigure).mock.calls[0][0].facets).toHaveLength(3);
  });

  it("the omit-only reason survives a page spec's panel copy and never reaches the wire", () => {
    const ds: Dataset = { id: "d1", name: "scan.dat", data: DATA, excludedRows: [3] };
    const grey = buildFigureSpecFromDocument(document({ facetKey: 1 }), ds, "f", { greyExcluded: withExcludedGhosts });
    expect(omitOnlyReason(grey)).toBe(FACET_OMIT_REASON);
    expect(omitOnlyReason({ panels: [{ figure: { ...grey } }] })).toBe(FACET_OMIT_REASON);
    expect(JSON.stringify(grey)).toBe(JSON.stringify(buildFigureSpecFromDocument(document({ facetKey: 1 }), ds, "f")));
  });
});
