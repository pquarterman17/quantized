import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigurePage } from "./api";
import { runExportSpatialPageCommand } from "./exportPageCommand";
import { defaultPageSetup } from "./pagesetup";
import { useApp } from "../store/useApp";

vi.mock("./api", () => ({ exportFigurePage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../components/overlays/ParamDialog", () => ({
  askParams: vi.fn().mockResolvedValue({ fmt: "pdf", dpi: 300 }),
}));
vi.mock("../store/toasts", () => ({ toast: vi.fn() }));

describe("runExportSpatialPageCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book",
          data: {
            time: [0, 1],
            values: [[1], [2]],
            labels: ["signal"],
            units: [""],
            metadata: {},
          },
        },
      ],
      activeId: "d1",
      spatialPanels: [
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 1],
          yLim: [1, 2],
          xLog: false,
          yLog: true,
          row: 0,
          col: 0,
          pageRect: { left: 0.1, top: 0.2, width: 0.7, height: 0.6 },
        },
      ],
      pageSetup: defaultPageSetup(),
      xFmt: { mode: "eng", digits: 2 },
      yFmt: { mode: "sci", digits: 1 },
      showGrid: false,
      showAxisBox: true,
    });
  });

  it("threads the live page appearance into every nested figure request", async () => {
    await runExportSpatialPageCommand(useApp.getState);
    const body = vi.mocked(exportFigurePage).mock.calls[0][0];
    expect(body.panels[0].figure.x_fmt).toEqual({ mode: "eng", digits: 2 });
    expect(body.panels[0].figure.y_fmt).toEqual({ mode: "sci", digits: 1 });
    expect(body.panels[0].figure.overrides).toMatchObject({
      x_lim: [0, 1],
      y_lim: [1, 2],
      grid: false,
      spines: { top: true, right: true },
      ticks: { minor: true },
    });
  });
});
