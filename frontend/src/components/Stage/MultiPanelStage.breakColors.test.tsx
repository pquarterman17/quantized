// T2: x-break panels take each series' PALETTE colour from its slot in the
// flat plot, not from its index inside the panel. A break view exports as the
// flat figure plus `x_breaks`, which colours every series once by its flat
// display position (BUG-015's canvas positions, hidden series included). A
// panel holding [B, C] used to paint B in `--series-1`, while the export drew it
// in `--series-2`.
//
// A HIDDEN channel is not drawn on any break panel either (the export drops
// it); it stays in the panel's payload with `show: false`, as on the flat canvas.

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../../lib/figureDocument";
import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultPlotView } from "../../lib/plotview";
import type { DataStruct, SeriesStyle } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

function MultiPanelStage() {
  const active = useActiveDataset();
  return <RealMultiPanelStage composition={useEffectiveComposition(active)} />;
}

type SeriesOpts = { label?: string; stroke?: string; show?: boolean };
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

/** Distinct, mid-luminance hexes (no contrast swap on either theme). */
const PAINT = ["#d03030", "#3070d0", "#30a030", "#a030a0"];

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

function reopenedBreakView(
  data: DataStruct,
  hiddenChannels: number[] = [],
  seriesStyles: Record<number, SeriesStyle> = {},
): void {
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data }], activeId: "d1",
    xKey: null, yKeys: null, y2Keys: null, seriesOrder: null, hiddenChannels, stackMode: false,
    composition: null, facetKey: null, groupKey: null, seriesStyles, seriesLabels: {},
    autoSeriesStyles: false, polarMode: false, statMode: false,
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

/** Screen stroke per panel, keyed by the panel's channel (its label). */
const screenStrokes = () =>
  created.map((c) => c.opts.series.slice(1).map((s) => [s.label?.trim(), s.stroke] as const));

/** Export colour per channel label. */
function exportColors(data: DataStruct): Map<string, string | undefined> {
  const spec = buildStageFigureSpec(useApp.getState, { id: "d1", name: "ds1", data }, "fig", RENDER_OPTS);
  expect(spec.overrides?.x_breaks).toEqual([[20, 90]]); // it IS the break view's export
  const out = new Map<string, string | undefined>();
  (spec.y_keys ?? []).forEach((ch, j) => out.set(data.labels[Number(ch)], spec.series_styles?.[j]?.color));
  return out;
}

async function renderBreak(): Promise<void> {
  render(<MultiPanelStage />);
  await waitFor(() => expect(created).toHaveLength(2));
}

function expectScreenMatchesExport(exported: Map<string, string | undefined>): void {
  for (const panel of screenStrokes()) {
    for (const [label, stroke] of panel) {
      if (exported.has(label!)) expect(stroke, `channel ${label}`).toBe(exported.get(label!));
    }
  }
}

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  PAINT.forEach((c, i) => document.documentElement.style.setProperty(`--series-${i + 1}`, c));
});
afterEach(() => {
  vi.unstubAllGlobals();
  PAINT.forEach((_c, i) => document.documentElement.style.removeProperty(`--series-${i + 1}`));
  useApp.setState({ plotWindows: [], focusedWindowId: null, composition: null, hiddenChannels: [], seriesStyles: {} });
});

describe("MultiPanelStage — break panels colour series by flat position (T2)", () => {
  it("panels holding the same channels draw the export's colours", async () => {
    const data = gapData(true);
    reopenedBreakView(data);
    await renderBreak();
    const exported = exportColors(data);
    expect([...exported.values()]).toEqual(PAINT.slice(0, 3)); // non-vacuous
    for (const panel of screenStrokes()) expect(panel.map(([l]) => l)).toEqual(["A", "B", "C"]);
    expectScreenMatchesExport(exported);
  });

  it("panels holding different channels colour each by its flat slot", async () => {
    const data = gapData(false);
    reopenedBreakView(data);
    await renderBreak();
    const exported = exportColors(data);
    const [p0, p1] = screenStrokes();
    expect(p0.map(([l]) => l)).toEqual(["A", "B"]);
    expect(p1.map(([l]) => l)).toEqual(["B", "C"]);
    // Panel 1's FIRST series is B: the flat plot's second slot, never panel-index slot 1.
    expect(p1[0][1]).toBe(PAINT[1]);
    expect(p1[1][1]).toBe(PAINT[2]);
    expectScreenMatchesExport(exported);
  });

  it("a hidden series keeps its slot, so later channels keep the export's colour", async () => {
    const data = gapData(false);
    reopenedBreakView(data, [1]);
    await renderBreak();
    const exported = exportColors(data);
    // The export drops B but C still takes the third slot (BUG-015).
    expect([...exported.keys()]).toEqual(["A", "C"]);
    expect(exported.get("C")).toBe(PAINT[2]);
    expectScreenMatchesExport(exported);
    expect(screenStrokes()[1].find(([l]) => l === "C")?.[1]).toBe(PAINT[2]);
  });

  it("a hidden channel draws on no panel, so the drawn set is the export's", async () => {
    const data = gapData(true);
    reopenedBreakView(data, [1]);
    await renderBreak();
    const exported = [...exportColors(data).keys()];
    expect(exported).toEqual(["A", "C"]);
    for (const c of created) {
      const drawn = c.opts.series.slice(1).filter((s) => s.show !== false).map((s) => s.label?.trim());
      expect(drawn).toEqual(exported);
    }
  });

  it("an explicit colour still wins on every panel", async () => {
    const data = gapData(false);
    reopenedBreakView(data, [], { 1: { color: "#c08020" } });
    await renderBreak();
    const exported = exportColors(data);
    expect(exported.get("B")).toBe("#c08020");
    const [p0, p1] = screenStrokes();
    expect(p0[1][1]).toBe("#c08020");
    expect(p1[0][1]).toBe("#c08020");
    expect(p1[1][1]).toBe(PAINT[2]);
    expectScreenMatchesExport(exported);
  });
});
