// Vector map export (MapStage ⤓): the request body built from the on-screen
// map, and the dialog's format routing (PDF/SVG -> /api/export/map-figure,
// PNG -> the canvas grab it always was).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../lib/api/http", () => ({ postDownload: vi.fn(() => Promise.resolve()) }));
vi.mock("../../lib/plotExport", () => ({ exportCanvasPng: vi.fn() }));

import { askParams } from "../overlays/ParamDialog";
import { postDownload } from "../../lib/api/http";
import type { MapPayload } from "../../lib/mapdataFetch";
import { mapFigureBody, runMapExport, type MapExportView } from "./mapFigureExport";
import { exportCanvasPng } from "../../lib/plotExport";

const payload: MapPayload = {
  xAxis: [0, 1, 2],
  yAxis: [10, 20],
  zGrid: [
    [1, 10, null],
    [100, 1000, 0],
  ],
  xLabel: "2Theta",
  xUnit: "deg",
  yLabel: "Omega",
  yUnit: "",
  zLabel: "Intensity",
  zUnit: "cps",
  zMin: 0,
  zMax: 1000,
};

const view: MapExportView = {
  cmap: "viridis",
  logZ: false,
  colorLimits: null,
  contour: { on: false, levelCount: 8, scale: "linear" },
};

const opts = { fmt: "pdf", style: "default", title: "", filename: "scan_map" };

describe("mapFigureBody", () => {
  it("asks for equal aspect exactly when the canvas letterboxes (axes sharing a unit, e.g. Qx/Qz)", () => {
    const q = { ...payload, xLabel: "Qx", xUnit: "Ang^-1", yLabel: "Qz", yUnit: "Ang^-1" };
    expect(mapFigureBody(q, view, opts).equal_aspect).toBe(true);
    expect(mapFigureBody({ ...payload, yUnit: "deg" }, view, opts)).not.toHaveProperty("equal_aspect");
  });

  it("sends the on-screen grid as a heatmap with gaps as null and unit-suffixed labels", () => {
    const b = mapFigureBody(payload, view, opts);
    expect(b).toMatchObject({
      kind: "heatmap",
      fmt: "pdf",
      cmap: "viridis",
      x_axis: [0, 1, 2],
      y_axis: [10, 20],
      z_grid: [
        [1, 10, null],
        [100, 1000, 0],
      ],
      x_label: "2Theta (deg)",
      y_label: "Omega",
      z_label: "Intensity (cps)",
      filename: "scan_map",
    });
  });

  it("maps the diverging colormap to matplotlib's orientation (blue low)", () => {
    expect(mapFigureBody(payload, { ...view, cmap: "rdbu" }, opts).cmap).toBe("RdBu_r");
  });

  it("log colour scale exports log10(z), dropping non-positive cells, with the canvas' colour-bar title", () => {
    const b = mapFigureBody(payload, { ...view, logZ: true }, opts);
    expect(b.z_grid).toEqual([
      [0, 1, null],
      [2, 3, null],
    ]);
    // The canvas bar reads values (1e-3, 0.01 …) under "Intensity (cps) — log";
    // the export labels its decades the same way rather than with exponents.
    expect(b.z_label).toBe("Intensity (cps) — log");
    expect(b.colorbar_log10).toBe(true);
    expect(mapFigureBody(payload, view, opts).colorbar_log10).toBeUndefined();
  });

  it("clamps to the explicit colour limits the canvas saturates at", () => {
    const b = mapFigureBody(payload, { ...view, colorLimits: [5, 500] }, opts);
    expect(b.z_grid).toEqual([
      [5, 10, null],
      [100, 500, 5],
    ]);
  });

  // P2.8 residual (b): a half-open pair clamps only its typed side, and
  // `z_limits` carries the blank side filled from the grid's own extent — the
  // exact pair the canvas paints (`effectiveColorLimits`).
  it("a half-open pair clamps only its typed side and fills the auto side from the data", () => {
    const top = mapFigureBody(payload, { ...view, colorLimits: [null, 500] }, opts);
    expect(top.z_grid).toEqual([
      [1, 10, null],
      [100, 500, 0],
    ]);
    expect(top.z_limits).toEqual([0, 500]);
    const bottom = mapFigureBody(payload, { ...view, colorLimits: [5, null] }, opts);
    expect(bottom.z_grid).toEqual([
      [5, 10, null],
      [100, 1000, 5],
    ]);
    expect(bottom.z_limits).toEqual([5, 1000]);
  });

  it("under a log scale a non-positive cell stays a gap even when a limit would clamp it up", () => {
    const b = mapFigureBody(payload, { ...view, logZ: true, colorLimits: [10, 100] }, opts);
    expect(b.z_grid).toEqual([
      [1, 1, null],
      [2, 2, null],
    ]);
  });

  it("a contour overlay exports as filled contours with the overlay's levels", () => {
    const b = mapFigureBody(payload, { ...view, contour: { on: true, levelCount: 6, scale: "log" } }, opts);
    expect(b).toMatchObject({ kind: "contourf", levels: 6, level_scale: "log" });
  });
});

describe("runMapExport", () => {
  const canvas = document.createElement("canvas");
  const setStatus = vi.fn();

  beforeEach(() => {
    vi.mocked(askParams).mockReset();
    vi.mocked(postDownload).mockClear();
    vi.mocked(exportCanvasPng).mockClear();
    setStatus.mockClear();
  });

  it("defaults the format to vector PDF", async () => {
    vi.mocked(askParams).mockResolvedValue(null);
    await runMapExport({ canvas, payload, view, stem: "scan", setStatus });
    const fields = vi.mocked(askParams).mock.calls[0]![1];
    const fmt = fields.find((f) => f.key === "fmt");
    expect(fmt?.default).toBe("pdf");
    expect(fmt?.options).toEqual(["pdf", "svg", "png"]);
    expect(postDownload).not.toHaveBeenCalled();
  });

  it("PDF/SVG go through /api/export/map-figure", async () => {
    vi.mocked(askParams).mockResolvedValue({ fmt: "svg", style: "aps", title: " RSM " });
    await runMapExport({ canvas, payload, view, stem: "scan", setStatus });
    expect(postDownload).toHaveBeenCalledTimes(1);
    const [path, body, fallback] = vi.mocked(postDownload).mock.calls[0]!;
    expect(path).toBe("/api/export/map-figure");
    expect(body).toMatchObject({ fmt: "svg", style: "aps", title: "RSM", filename: "scan_map" });
    expect(fallback).toBe("scan_map.svg");
    expect(exportCanvasPng).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenLastCalledWith("exported scan_map.svg");
  });

  it("PNG keeps the on-screen canvas grab", async () => {
    vi.mocked(askParams).mockResolvedValue({ fmt: "png", style: "default", title: "" });
    await runMapExport({ canvas, payload, view, stem: "scan", setStatus });
    expect(exportCanvasPng).toHaveBeenCalledWith(canvas, "scan_map.png");
    expect(postDownload).not.toHaveBeenCalled();
  });

  it("reports a backend failure on the status line", async () => {
    vi.mocked(askParams).mockResolvedValue({ fmt: "pdf", style: "default", title: "" });
    vi.mocked(postDownload).mockRejectedValueOnce(new Error("422 bad grid"));
    await runMapExport({ canvas, payload, view, stem: "scan", setStatus });
    expect(setStatus).toHaveBeenLastCalledWith("map export failed — 422 bad grid");
  });
});
