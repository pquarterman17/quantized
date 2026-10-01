// S1 (b): the P3.3 auto dash/marker cycle on an x-break view with `stackMode`
// off — a saved `plot.axisBreaks.x` mounts the break panels on its own
// (BUG-012). The view's export is the FLAT figure plus `x_breaks`, which the
// cycle gate (`windowCyclesSeriesStyles`) lets cycle, while the break leg drew
// every panel undashed. The panels now resolve the SAME cycle, keyed by each
// channel's flat display position, so the two agree channel for channel —
// including when two panels hold different channels.

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../../lib/figureDocument";
import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultPlotView } from "../../lib/plotview";
import { DASH } from "../../lib/seriesStyleCycle";
import type { DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

function MultiPanelStage() {
  const active = useActiveDataset();
  return <RealMultiPanelStage composition={useEffectiveComposition(active)} />;
}

type SeriesOpts = { label?: string; dash?: number[] };
const { created, MockUPlot } = vi.hoisted(() => {
  const created: { opts: { series: SeriesOpts[] } }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: { series: SeriesOpts[] }) {
      created.push({ opts });
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

/** x 0..10 | 100..110. `dense` keeps every channel finite on both sides; else
 *  `A` is finite only before the gap and `C` only after it, so (yKeys null)
 *  panel 0 holds channels [0, 1] and panel 1 holds [1, 2]. */
function gapData(dense: boolean): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (const x0 of [0, 100]) {
    for (let i = 0; i <= 10; i++) {
      time.push(x0 + i);
      values.push([dense || x0 === 0 ? 1 + i : NaN, 50 + i, dense || x0 === 100 ? 90 + i : NaN]);
    }
  }
  return { time, values, labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} };
}

const RENDER_OPTS = { fmt: "pdf", style: "default", dpi: 300, title: "" };

function reopenedBreakView(data: DataStruct): void {
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data }], activeId: "d1",
    xKey: null, yKeys: null, y2Keys: null, seriesOrder: null, hiddenChannels: [], stackMode: false,
    composition: null, facetKey: null, groupKey: null, seriesStyles: {}, seriesLabels: {},
    autoSeriesStyles: true, polarMode: false, statMode: false,
    plotWindows: [
      {
        id: "w1", kind: "plot", title: "", datasetId: "d1",
        geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
        bg: "theme", linkGroup: null, pinned: false, view: defaultPlotView(),
        document: createFigureDocument({
          id: "fig-w1", name: "w1", datasetId: "d1", view: defaultPlotView(),
          axisBreaks: { x: [[20, 90]] },
        }),
      },
    ],
    focusedWindowId: "w1",
  });
}

/** Screen dash per panel, keyed by the panel's channel (its label). */
const screenDashes = () =>
  created.map((c) => c.opts.series.slice(1).map((s) => [s.label, s.dash ?? null] as const));

/** Export dash per channel label, through the dash vocabulary the canvas uses. */
function exportDashes(data: DataStruct): Map<string, number[] | null> {
  const spec = buildStageFigureSpec(useApp.getState, { id: "d1", name: "ds1", data }, "fig", RENDER_OPTS);
  expect(spec.overrides?.x_breaks).toEqual([[20, 90]]); // it IS the break view's export
  const out = new Map<string, number[] | null>();
  (spec.y_keys ?? []).forEach((ch, j) => {
    const line = spec.series_styles?.[j]?.line;
    out.set(data.labels[Number(ch)], (line && line !== "none" ? DASH[line] : undefined) ?? null);
  });
  return out;
}

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  useApp.setState({ autoSeriesStyles: false, plotWindows: [], focusedWindowId: null, composition: null });
});

describe("MultiPanelStage — the auto dash cycle on a saved x-break (S1 b)", () => {
  it("break panels draw the dashes the export's series styles carry", async () => {
    const data = gapData(true);
    reopenedBreakView(data);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    const exported = exportDashes(data);
    // Non-vacuous: the export really cycles (B dashed, C dotted).
    expect(exported.get("B")).toEqual(DASH.dashed);
    expect(exported.get("C")).toEqual(DASH.dotted);
    for (const panel of screenDashes()) {
      expect(panel).toHaveLength(3);
      for (const [label, dash] of panel) expect(dash).toEqual(exported.get(label!.trim()));
    }
  });

  it("keys the cycle by channel when the panels hold different channels", async () => {
    const data = gapData(false);
    reopenedBreakView(data);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    const exported = exportDashes(data);
    const [p0, p1] = screenDashes();
    expect(p0.map(([l]) => l?.trim())).toEqual(["A", "B"]);
    expect(p1.map(([l]) => l?.trim())).toEqual(["B", "C"]);
    // Panel 1's FIRST series is B: dashed, as exported — never panel-index solid.
    expect(p1[0][1]).toEqual(DASH.dashed);
    for (const panel of [p0, p1]) for (const [label, dash] of panel) expect(dash).toEqual(exported.get(label!.trim()));
  });

  it("stays uncycled on both sides with the preference off", async () => {
    const data = gapData(true);
    reopenedBreakView(data);
    useApp.setState({ autoSeriesStyles: false });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    const exported = exportDashes(data);
    expect([...exported.values()].every((d) => d === null)).toBe(true);
    expect(screenDashes().flat().every(([, d]) => d === null)).toBe(true);
  });
});
