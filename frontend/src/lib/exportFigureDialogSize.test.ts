// Audit #5: the Export dialog sizes the figure (width / height / unit — the
// window's `pageSetup`, the SAME object Page setup edits) and labels the
// secondary axis; before, only Page setup could size a figure and a Y2 label
// could not be set at export at all.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
import { exportFigure } from "./api/figures";
import { runExportFigureCommand } from "./exportFigureCommand";
import type { ParamField } from "./params";
import { useApp } from "../store/useApp";

vi.mock("./api/figures", () => ({ exportFigure: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../components/overlays/ParamDialog", () => ({ askParams: vi.fn() }));

const BASE = { fmt: "pdf", style: "default", dpi: 300, title: "", x_label: "", y_label: "", greyscale: false };

function setup(y2Keys: number[] | null) {
  useApp.setState({
    datasets: [{
      id: "d1", name: "scan.dat",
      data: { time: [0, 1], values: [[1, 10], [2, 20]], labels: ["A", "B"], units: ["u", "v"], metadata: {} },
    }],
    activeId: "d1", xKey: null, yKeys: [0, 1], y2Keys, pageSetup: null,
    plotTitle: "", xAxisLabel: "", yAxisLabel: "", y2AxisLabel: "right", status: "",
  });
}

const fieldsAsked = () => vi.mocked(askParams).mock.calls[0][1] as ParamField[];

describe("Export dialog: figure size and Y2 label", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exportFigure).mockResolvedValue(undefined);
  });

  it("asks for the page size (blank = the preset's size) and leaves it alone when blank", async () => {
    setup(null);
    vi.mocked(askParams).mockResolvedValueOnce({ ...BASE, width: 0, height: 0, unit: "in" });
    await runExportFigureCommand(useApp.getState);
    const keys = fieldsAsked().map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["width", "height", "unit"]));
    expect(keys).not.toContain("y2_label"); // no secondary axis: no placebo field
    expect(useApp.getState().pageSetup).toBeNull();
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.width_in).toBeUndefined();
  });

  it("an 8.5 x 6 cm answer becomes the window's page and the export's size", async () => {
    setup(null);
    vi.mocked(askParams).mockResolvedValueOnce({ ...BASE, width: 8.5, height: 6, unit: "cm" });
    await runExportFigureCommand(useApp.getState);
    expect(useApp.getState().pageSetup).toMatchObject({ width: 8.5, height: 6, unit: "cm" });
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.width_in).toBeCloseTo(8.5 / 2.54, 12);
    expect(body.height_in).toBeCloseTo(6 / 2.54, 12);
    expect(body.overrides?.page_pad).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(body.overrides).not.toHaveProperty("margins");
  });

  it("the next dialog opens on the page it set (one source of truth)", async () => {
    setup(null);
    useApp.setState({ pageSetup: { width: 85, height: 60, unit: "mm", margins: { left: 5, right: 5, top: 5, bottom: 5 }, aspectDerived: false } });
    vi.mocked(askParams).mockResolvedValueOnce({ ...BASE, width: 85, height: 60, unit: "mm" });
    await runExportFigureCommand(useApp.getState);
    const byKey = Object.fromEntries(fieldsAsked().map((f) => [f.key, f.default]));
    expect([byKey.width, byKey.height, byKey.unit]).toEqual([85, 60, "mm"]);
  });

  it("asks for a Y2 label when a secondary axis is plotted, and sends it", async () => {
    setup([1]);
    vi.mocked(askParams).mockResolvedValueOnce({ ...BASE, width: 0, height: 0, unit: "in", y2_label: "R (Ω)" });
    await runExportFigureCommand(useApp.getState);
    expect(fieldsAsked().find((f) => f.key === "y2_label")?.default).toBe("right");
    const body = vi.mocked(exportFigure).mock.calls[0][0];
    expect(body.y2_keys).toEqual([1]);
    expect(body.y2_label).toBe("R (Ω)");
  });
});
