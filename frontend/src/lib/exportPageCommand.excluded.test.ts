// F4.2c (a) for the spatial Origin "Export page…": a page whose panels have
// excluded or filter-dropped rows asks "greyed or omitted?", never otherwise,
// and each panel's figure draws what was chosen, as the spatial grid does
// (`components/Stage/spatialPanelFetch.ts`). The page dialog is mocked; the
// excluded-rows question runs through the real dialog store, and every wait
// is on its STATE.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigurePage } from "./api";
import { spatialComposition } from "./composition";
import { EXCLUDED_GREY_OPTION, EXCLUDED_OMIT_OPTION } from "./excludedRowsChoice";
import { EXCLUDED_GHOST_STYLE } from "./excludedRowsExport";
import { runExportSpatialPageCommand } from "./exportPageCommand";
import { defaultPageSetup } from "./pagesetup";
import type { Dataset } from "./types";
import { useParamDialog } from "../store/paramDialog";
import { usePendingOps } from "../store/pendingOps";
import { useApp } from "../store/useApp";

vi.mock("./api", () => ({ exportFigurePage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../components/overlays/ParamDialog", () => ({
  askParams: vi.fn().mockResolvedValue({ fmt: "pdf", dpi: 300 }),
}));

function seed(excludedRows?: number[]) {
  const ds: Dataset = {
    id: "d1",
    name: "book",
    data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["signal"], units: [""], metadata: {} },
    ...(excludedRows ? { excludedRows } : {}),
  };
  useApp.setState({
    datasets: [ds],
    activeId: "d1",
    composition: spatialComposition([
      {
        datasetId: "d1", xKey: null, yKeys: [0], xLim: [0, 2], yLim: [1, 3], xLog: false, yLog: false,
        row: 0, col: 0, pageRect: { left: 0.1, top: 0.2, width: 0.7, height: 0.6 },
        seriesLabels: { 0: "Field-cooled" },
      },
    ]),
    pageSetup: defaultPageSetup(),
    status: "",
  });
}

async function answer(mode: string | null) {
  await vi.waitFor(() => expect(useParamDialog.getState().title).toBe("Excluded rows"));
  const { resolve, close } = useParamDialog.getState();
  close();
  resolve!(mode === null ? null : { mode });
}

const figure = () => vi.mocked(exportFigurePage).mock.calls[0][0].panels[0].figure;

beforeEach(() => {
  vi.clearAllMocks();
  usePendingOps.setState({ ops: [] });
  useParamDialog.getState().close();
  useApp.getState().setPref("excludedDisplay", "grey");
});

describe("spatial Export page honours the excluded-rows choice", () => {
  it("never asks without excluded rows", async () => {
    seed();
    await runExportSpatialPageCommand(useApp.getState);
    expect(useParamDialog.getState().title).toBeNull();
    expect(figure().dataset.time).toEqual([0, 1, 2]);
  });

  it("greyed: a grey companion per series, kept out of the decoded legend", async () => {
    seed([1]);
    const run = runExportSpatialPageCommand(useApp.getState);
    await answer(EXCLUDED_GREY_OPTION);
    await run;
    const f = figure();
    expect(f.dataset.time).toEqual([0, 2, 1]);
    expect(f.y_keys).toEqual([0, 1]);
    expect(f.series_styles?.[0]?.legend).toBe("Field-cooled");
    expect(f.series_styles?.[1]).toEqual({ ...EXCLUDED_GHOST_STYLE, legend: "_nolegend_" });
  });

  it("omitted: only the kept rows", async () => {
    seed([1]);
    const run = runExportSpatialPageCommand(useApp.getState);
    await answer(EXCLUDED_OMIT_OPTION);
    await run;
    expect(figure().dataset.time).toEqual([0, 2]);
    expect(figure().y_keys).toEqual([0]);
  });

  it("dismissing the question exports nothing", async () => {
    seed([1]);
    const run = runExportSpatialPageCommand(useApp.getState);
    await answer(null);
    await run;
    expect(exportFigurePage).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe("export cancelled");
  });
});
