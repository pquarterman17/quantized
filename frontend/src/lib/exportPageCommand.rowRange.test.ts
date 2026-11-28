// "Export page" of a spatial panel set honours the plot's row window on the panels of the windowed sheet
// (ROW_RANGE_CONTRACT 3.3, item 31), as the grid draws them (`Stage/MultiPanelStage.windowKinds.test.tsx`): the
// panel on this sheet holds exactly the window's rows less the sheet's exclusions, a panel of another sheet holds
// all of its rows, and a window that cannot be read refuses the export.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigurePage } from "./api";
import { spatialComposition } from "./composition";
import { runExportSpatialPageCommand } from "./exportPageCommand";
import { defaultPageSetup } from "./pageGeometry";
import type { Dataset } from "./types";
import { useParamDialog } from "../store/paramDialog";
import { useApp } from "../store/useApp";
import { EXCLUDED_OMIT_OPTION } from "./excludedRowsChoice";

vi.mock("./api", () => ({ exportFigurePage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../components/overlays/ParamDialog", () => ({ askParams: vi.fn().mockResolvedValue({ fmt: "pdf", dpi: 300 }) }));
const toastSpy = vi.fn();
vi.mock("../store/toasts", () => ({ toast: (...args: unknown[]) => toastSpy(...args) }));

const N = 200;
const sheet: Dataset = {
  id: "d1", name: "sheet", excludedRows: [25],
  data: { time: Array.from({ length: N }, (_v, r) => r), values: Array.from({ length: N }, (_v, r) => [2 * r]), labels: ["y"], units: [""], metadata: {} },
};
const other: Dataset = { id: "d2", name: "other", data: { time: [0, 1, 2], values: [[5], [6], [7]], labels: ["z"], units: [""], metadata: {} } };
const panel = (datasetId: string, col: number) => ({
  datasetId, xKey: null, yKeys: [0], xLim: [0, 1] as [number, number], yLim: [1, 2] as [number, number], xLog: false, yLog: false, row: 0, col,
  pageRect: { left: 0.1 + 0.4 * col, top: 0.2, width: 0.35, height: 0.6 },
});

/** Run the command, answering the "Excluded rows" question (the sheet has an excluded row in the window) with Omit. */
async function run(): Promise<void> {
  const done = runExportSpatialPageCommand(useApp.getState);
  await vi.waitFor(() => expect(useParamDialog.getState().title).toBe("Excluded rows"));
  const { resolve, close } = useParamDialog.getState();
  close();
  resolve!({ mode: EXCLUDED_OMIT_OPTION });
  await done;
}

beforeEach(() => {
  vi.clearAllMocks();
  useParamDialog.getState().close();
  vi.mocked(askParams).mockResolvedValue({ fmt: "pdf", dpi: 300 });
  vi.mocked(exportFigurePage).mockResolvedValue(undefined);
  useApp.setState({
    datasets: [sheet, other], activeId: "d1", pageSetup: defaultPageSetup(), status: "",
    composition: spatialComposition([panel("d1", 0), panel("d2", 1)]),
    rowRange: { from: 20, to: 43 },
  });
  useApp.getState().setPref("excludedDisplay", "hide");
});

describe("Export page with a plot row window", () => {
  it("cuts the panel of the windowed sheet to the window's rows (less the exclusion) and leaves the other sheet whole", async () => {
    await run();
    const body = vi.mocked(exportFigurePage).mock.calls[0][0];
    const want = Array.from({ length: 24 }, (_v, i) => 20 + i).filter((r) => r !== 25); // a plain selection of the sheet's rows
    expect(body.panels[0].figure.dataset.time).toEqual(want);
    expect(body.panels[0].figure.dataset.values.map((v) => v[0])).toEqual(want.map((r) => 2 * r));
    expect(body.panels[1].figure.dataset.time).toEqual([0, 1, 2]);
  });

  it("with no window every row of both sheets is exported", async () => {
    useApp.setState({ rowRange: undefined });
    await run();
    const body = vi.mocked(exportFigurePage).mock.calls[0][0];
    expect(body.panels[0].figure.dataset.time).toHaveLength(N - 1); // the exclusion is still pruned
  });

  it("a window the sheet does not hold, or a named link that cannot be read, refuses and exports nothing", async () => {
    useApp.setState({ rowRange: { from: 20, to: 999 } });
    await runExportSpatialPageCommand(useApp.getState);
    expect(exportFigurePage).not.toHaveBeenCalled();
    expect(useApp.getState().status).toMatch(/plot row range: rows 21-1,?000 is beyond/);
    useApp.setState({ rowRange: { from: 0, to: -1, named: "nr1:x", namedAs: "Base", refused: "the named range was removed" } });
    await runExportSpatialPageCommand(useApp.getState);
    expect(exportFigurePage).not.toHaveBeenCalled();
    expect(useApp.getState().status).toMatch(/the named range was removed/);
  });
});
