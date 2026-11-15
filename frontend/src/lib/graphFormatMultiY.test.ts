// Copy / Paste Format and graph templates carry Origin-style multiple Y axes
// (gap audit 4 G11): each extra axis' look and which plotted position rides
// it -- never a range or a title -- validated on load, failing closed to Y1.

import { describe, expect, it } from "vitest";

import { captureGraphFormat, graphFormatPatch, sanitizeGraphFormat } from "./graphFormat";
import { formatAxisOrphans } from "./graphFormatMultiY";
import { newExtraYAxis } from "./multiY";
import { defaultPlotView, type PlotView } from "./plotview";

const source: PlotView = {
  ...defaultPlotView(),
  y2Keys: [1],
  yAxes: [
    { lim: [0, 9], scale: "log", step: null, fmt: { mode: "sci", digits: 1 }, label: "Moment", color: "#aa0000" },
    { lim: null, scale: null, step: 2, fmt: null, label: "", color: "#0000aa" },
  ],
  yAxisOf: { 2: 3, 3: 4 },
};

describe("graph format: extra Y axes", () => {
  // Display order the commands use: Y1 + Y3+ series, then Y2's.
  const plotted = [0, 2, 3, 1];

  it("captures each axis' look and the per-position axis, no range or title", () => {
    const format = captureGraphFormat(source, plotted);
    expect(format.yAxes).toEqual([
      { scale: "log", fmt: { mode: "sci", digits: 1 }, color: "#aa0000" },
      { scale: null, fmt: null, color: "#0000aa" },
    ]);
    expect(format.seriesAxis).toEqual([null, 3, 4, null]);
    expect(captureGraphFormat(defaultPlotView(), plotted).yAxes).toBeUndefined();
  });

  it("pastes onto another graph by position, keeping the target's own ranges and titles", () => {
    const format = sanitizeGraphFormat(JSON.parse(JSON.stringify(captureGraphFormat(source, plotted))))!;
    const target: PlotView = { ...defaultPlotView(), y2Keys: [12], yAxes: [{ ...newExtraYAxis(), label: "Mine", lim: [1, 2] }] };
    const patch = graphFormatPatch(format, [10, 11, 12, 13], {}, target);
    expect(patch.yAxisOf).toEqual({ 11: 3, 12: 4 });
    expect(patch.y2Keys).toBeNull();
    expect(patch.yAxes?.[0]).toMatchObject({ label: "Mine", lim: [1, 2], scale: "log", color: "#aa0000" });
    // The tick step is limit-coupled, so (like Y1 / Y2's) it never travels.
    expect(patch.yAxes?.[1]).toMatchObject({ label: "", lim: null, step: null });
  });

  it("a format without extra axes leaves the target's assignments alone", () => {
    const plain = captureGraphFormat(defaultPlotView(), [0]);
    const patch = graphFormatPatch(plain, [0, 2], {}, source);
    expect(patch.yAxisOf).toBeUndefined();
    expect(patch.yAxes).toBeUndefined();
  });

  it("a damaged template's assignment past its axes falls back to Y1 and is counted", () => {
    const raw = JSON.parse(JSON.stringify(captureGraphFormat(source, plotted))) as { yAxes: unknown[]; seriesAxis: unknown[] };
    raw.yAxes = raw.yAxes.slice(0, 1);
    raw.seriesAxis = [null, 3, 4, 99];
    const format = sanitizeGraphFormat(raw)!;
    expect(format.seriesAxis).toEqual([null, 3, 4, null]);
    expect(formatAxisOrphans(format)).toBe(1);
    const patch = graphFormatPatch(format, [0, 2, 3, 1], {}, { ...defaultPlotView(), yAxisOf: { 3: 3 } });
    expect(patch.yAxisOf).toEqual({ 2: 3 });
  });
});
