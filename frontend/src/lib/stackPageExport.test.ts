// A stacked view's vector export is one panel per stack slot (plot audit round
// 4), cut from the flat spec and styled as the one-series canvas panel draws.
import { describe, expect, it } from "vitest";

import type { FigureSpec } from "./api/figures";
import { seriesColor } from "./seriesStyleCycle";
import { stackPageRequest, type StackExportView } from "./stackPageExport";

const flat = (over: Partial<FigureSpec> = {}): FigureSpec => ({
  dataset: { time: [0, 1, 2], values: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], labels: ["A", "B", "C"], units: ["u", "v", "w"], metadata: {} },
  y_keys: [0, 2, 1],
  y_scale: "log",
  x_scale: "linear",
  y2_keys: [1],
  fmt: "svg",
  style: "aps",
  dpi: 300,
  title: "Depth profile",
  series_styles: [{ color: "#111111" }, { color: "#222222", line: "dashed" }, { color: "#333333" }],
  error_spans: [null, { y: { plus: [1, 1, 1], minus: [1, 1, 1] } }, null],
  waterfall_offsets: [0, 1, 2],
  overrides: {
    legend: { show: true, loc: "auto" },
    x_lim: [0, 2],
    y_lim: [1, 9],
    grid: true,
    spines: { top: true, right: true },
    annotations: [{ x: 1, y: 1, text: "note" }],
  },
  filename: "scan",
  ...over,
});

const view = (over: Partial<StackExportView> = {}): StackExportView => ({
  channels: [0, 2, 1],
  seriesStyles: { 2: { color: "#abcdef" } },
  seriesLabels: { 1: "Renamed" },
  ...over,
});

describe("stackPageRequest", () => {
  it("lays one panel per channel down one column, sharing x, as the page route's stack", () => {
    const page = stackPageRequest(flat(), view())!;
    expect(page).toMatchObject({ rows: 3, cols: 1, stack: true, link_x: true, label_format: "none", fmt: "svg", style: "aps", dpi: 300, filename: "scan" });
    expect(page.panels.map((p) => [p.row, p.col, p.label, p.figure.y_keys])).toEqual([
      [0, 0, "", [0]],
      [1, 0, "", [2]],
      [2, 0, "", [1]],
    ]);
    expect(page.panels.map((p) => p.figure.title)).toEqual(["Depth profile", "", ""]);
    expect(page.panels.every((p) => p.figure.y_scale === "log")).toBe(true);
  });

  it("styles each panel as a one-series canvas: its own colour if chosen, else the first palette colour", () => {
    const [a, c, b] = stackPageRequest(flat(), view())!.panels.map((p) => p.figure.series_styles?.[0]);
    expect(a?.color).toBe(seriesColor(0));
    expect(c?.color).toBe("#abcdef");
    expect(b).toMatchObject({ color: seriesColor(0), legend: "Renamed" });
    expect(b?.line).toBeUndefined();
  });

  it("keeps what the canvas stack draws and drops what it does not", () => {
    const panels = stackPageRequest(flat(), view())!.panels.map((p) => p.figure);
    expect(panels[1].error_spans).toEqual([{ y: { plus: [1, 1, 1], minus: [1, 1, 1] } }]);
    expect(panels[0].error_spans).toBeUndefined();
    for (const f of panels) {
      expect(f.overrides).toEqual({ legend: { show: false }, x_lim: [0, 2], grid: true, spines: { top: true, right: true } });
      expect(f.y2_keys).toBeUndefined();
      expect(f.waterfall_offsets).toBeUndefined();
    }
  });

  it("declines a view it cannot draw panel for panel", () => {
    expect(stackPageRequest(flat(), view({ channels: [0] }))).toBeNull();
    expect(stackPageRequest(flat({ y_keys: [0, 2] }), view())).toBeNull();
    expect(stackPageRequest(flat({ facets: [] }), view())).toBeNull();
    expect(stackPageRequest(flat({ overrides: { x_breaks: [[0, 1]] } }), view())).toBeNull();
  });
});
