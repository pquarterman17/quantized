// The canvas half of the shared axis-title fixture's x-axis BREAK case
// (`tests/fixtures/wire/axis_titles.json`): a break view's panels build
// without the Format/drag bridge, so a formatted or dragged title draws plain
// on every panel, and the break renderer draws it plain too
// (`calc/figure_break.py`; backend half `tests/test_export_axis_titles.py`).
// The view is read back out of the fixture's own request.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "../../lib/api/figures";
import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView } from "../../lib/plotview";
import type { AxisLabelOffsets, AxisLabelStyles, DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

function MultiPanelStage() {
  const active = useActiveDataset();
  return <RealMultiPanelStage composition={useEffectiveComposition(active)} />;
}

type Axis = { label?: string };
const { created, MockUPlot } = vi.hoisted(() => {
  const created: { axes: Axis[] }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: { axes: Axis[] }) {
      created.push({ axes: opts.axes });
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

interface Title { size: number | null; bold: boolean; italic: boolean; offset: [number, number] }
interface FixtureCase { name: string; request: FigureSpec; drawn: Partial<Record<"x" | "y" | "y2", Title>> }

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "tests", "fixtures", "wire", "axis_titles.json");
const BROKEN = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: FixtureCase[] }).cases
  .filter((c) => c.request.overrides?.x_breaks?.length);

const PLAIN: Title = { size: null, bold: false, italic: false, offset: [0, 0] };

/** uPlot draws a title itself (plain, unmoved) when its axis keeps the text;
 *  the Format/drag plugin draws it only after blanking the axis label. */
const drawnBy = (axis: Axis): Title | "plugin" => (axis.label ? PLAIN : "plugin");

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useApp.setState({ plotWindows: [], focusedWindowId: null, composition: null, axisLabelStyles: {}, axisLabelOffsets: {} });
});

describe("x-axis break panels draw the fixture's titles", () => {
  it("the fixture has a break case", () => {
    expect(BROKEN.length).toBeGreaterThan(0);
  });

  it.each(BROKEN)("canvas: $name", async (c) => {
    const req = c.request;
    const data = req.dataset as DataStruct;
    const axisLabelStyles = (req.axis_label_styles ?? {}) as AxisLabelStyles;
    const axisLabelOffsets = (req.axis_label_offsets ?? {}) as AxisLabelOffsets;
    expect(Object.keys(axisLabelStyles).length + Object.keys(axisLabelOffsets).length).toBeGreaterThan(0);
    const view = { ...defaultPlotView(), yKeys: req.y_keys as number[], axisLabelStyles, axisLabelOffsets };
    useApp.setState({
      datasets: [{ id: "d1", name: "titles.csv", data }], activeId: "d1",
      xKey: null, yKeys: view.yKeys, y2Keys: null, seriesOrder: null, hiddenChannels: [], stackMode: false,
      composition: null, facetKey: null, groupKey: null, seriesStyles: {}, seriesLabels: {},
      autoSeriesStyles: false, polarMode: false, statMode: false, axisLabelStyles, axisLabelOffsets,
      plotWindows: [{
        id: "w1", kind: "plot", title: "", datasetId: "d1",
        geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
        bg: "theme", linkGroup: null, pinned: false, view,
        document: createFigureDocument({
          id: "fig-w1", name: "w1", datasetId: "d1", view, axisBreaks: { x: req.overrides?.x_breaks ?? [] },
        }),
      }],
      focusedWindowId: "w1",
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBeGreaterThanOrEqual(2));
    const [first, ...rest] = created;
    expect({ x: drawnBy(first.axes[0]), y: drawnBy(first.axes[1]) }).toEqual(c.drawn);
    // Batch 34: like the export (one `supxlabel`, one `set_ylabel` on
    // axes[0]), the titles are drawn once, on panel 0. The panels right of a
    // seam keep a blank x title band and drop the repeated y title.
    for (const { axes } of rest) expect([axes[0].label, axes[1].label]).toEqual(["", undefined]);
  });
});
