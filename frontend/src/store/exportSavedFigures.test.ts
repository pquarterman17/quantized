// N10: several saved (editable) figures -> ONE multi-page PDF through the
// existing batch route, pages in the order the caller lists them.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportFigureBatch } from "../lib/api/figureBatch";
import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api/figureBatch", () => ({ exportFigureBatch: vi.fn(async () => {}) }));

import { exportSavedFiguresPdf } from "./exportSavedFigures";

const ds = (id: string): Dataset => ({
  id,
  name: id,
  data: { time: [0, 1], values: [[1], [2]], labels: ["M"], units: [""], metadata: {} },
});
const fig = (id: string, datasetId: string | null) =>
  createFigureDocument({ id, name: `Fig ${id}`, datasetId, view: defaultPlotView() });

beforeEach(() => {
  vi.mocked(exportFigureBatch).mockClear();
  useApp.setState({
    datasets: [ds("d1"), ds("d2")],
    editableFigures: [fig("a", "d1"), fig("b", "d2"), fig("c", "d1")],
  });
});

describe("exportSavedFiguresPdf", () => {
  it("sends one multipage request with the pages in the requested order", async () => {
    const n = await exportSavedFiguresPdf(["c", "a", "b"]);
    expect(n).toBe(3);
    expect(exportFigureBatch).toHaveBeenCalledTimes(1);
    const [specs, name, , multipage] = vi.mocked(exportFigureBatch).mock.calls[0];
    expect(multipage).toBe(true);
    expect(name).toBe("figures");
    expect(specs.map((s) => s.filename)).toEqual(["Fig c", "Fig a", "Fig b"]);
    expect(specs.every((s) => s.fmt === "pdf")).toBe(true);
  });

  it("keeps each figure's own style preset and skips ids that are not saved figures", async () => {
    const styled = { ...fig("a", "d1"), output: { ...fig("a", "d1").output, stylePreset: "nature" } };
    useApp.setState({ editableFigures: [styled, fig("b", "d2")] });
    await exportSavedFiguresPdf(["a", "ghost", "b"]);
    const [specs] = vi.mocked(exportFigureBatch).mock.calls[0];
    expect(specs).toHaveLength(2);
    expect(specs[0].style).toBe("nature");
  });

  it("refuses an empty selection without calling the backend", async () => {
    await expect(exportSavedFiguresPdf(["ghost"])).rejects.toThrow(/no saved figures/i);
    expect(exportFigureBatch).not.toHaveBeenCalled();
  });
});
