// R1 (S2 of the screen-canvas regression matrix): the paneled x-break leg
// built its panels with NO `seriesStyles`, so a chosen width / colour / dash
// stopped mattering the moment a plot was broken (a width-2 line drew at the
// default 1.5) — while the export of the same view, which ships as the flat
// figure, carried them. The fix hands the break leg the flat plot's
// channel-keyed `seriesStyles`, projected through each panel's OWN
// `BreakPanel.channels` exactly as its renames are (BUG-014 round 5): a break
// panel resolves its channels over its own x-slice, so two panels of one view
// can hold different channels and a positional list would dress the wrong
// curve.

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { breakPanelsOf } from "../../lib/composition";
import type { DataStruct, SeriesStyle } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

function MultiPanelStage() {
  const active = useActiveDataset();
  return <RealMultiPanelStage composition={useEffectiveComposition(active)} />;
}

type SeriesOpts = { label?: string; stroke?: unknown; width?: number; dash?: number[] };
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

/** `Field` finite only before the gap, `Aux` only after it: with `yKeys` null
 *  panel 0 resolves channels [0, 1] and panel 1 resolves [1, 2] — `Aux` sits
 *  at the SAME series index `Field` does. */
function divergentData(): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (let i = 0; i <= 20; i++) {
    time.push(i);
    values.push([10 + i, 100 + i, NaN]);
  }
  for (let i = 0; i < 2; i++) {
    time.push(100 + i);
    values.push([NaN, 300 + i, 270 + i]);
  }
  return { time, values, labels: ["Field", "Signal", "Aux"], units: ["T", "au", "V"], metadata: {} };
}

const panelSeries = () => created.map((c) => c.opts.series.slice(1));

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data: divergentData() }], activeId: "d1",
    xKey: null, yKeys: null, y2Keys: null, seriesOrder: null, hiddenChannels: [], stackMode: false,
    composition: null, facetKey: null, groupKey: null, seriesLabels: {}, plotWindows: [], focusedWindowId: null,
    defaultLineWidth: 1.5, defaultTrace: "Line",
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useApp.setState({ seriesStyles: {}, composition: null });
});

describe("MultiPanelStage — explicit series styles on x-break panels (R1, S2)", () => {
  it("draws an explicit width on EVERY break panel, not the 1.5 default", async () => {
    const styles: Record<number, SeriesStyle> = { 1: { width: 2 } };
    useApp.setState({ yKeys: [1], seriesStyles: styles });
    useApp.getState().breakAtGaps("d1", [[20, 100]]);
    expect(breakPanelsOf(useApp.getState().composition)).toHaveLength(2);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(panelSeries().map((p) => p.map((s) => s.width))).toEqual([[2], [2]]);
  });

  it("keys each panel's styles by ITS channels when the panels hold different ones", async () => {
    const styles: Record<number, SeriesStyle> = {
      0: { color: "#ff8800", line: "dashed", width: 3 },
      2: { width: 2.5 },
    };
    useApp.setState({ seriesStyles: styles });
    useApp.getState().breakAtGaps("d1", [[20, 100]]);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    const [p0, p1] = panelSeries();
    expect(p0.map((s) => s.label)).toEqual(["Field (T)", "Signal (au)"]);
    expect(p1.map((s) => s.label)).toEqual(["Signal (au)", "Aux (V)"]);
    // Panel 0: Field wears its colour, dash and width; Signal is unstyled.
    expect(p0[0]).toMatchObject({ stroke: "#ff8800", width: 3, dash: [8, 4] });
    expect(p0[1].width).toBe(1.5);
    expect(p0[1].dash).toBeUndefined();
    // Panel 1: index 0 is now Signal (unstyled), index 1 Aux — never Field's style.
    expect(p1[0].width).toBe(1.5);
    expect(p1[0].stroke).not.toBe("#ff8800");
    expect(p1[1]).toMatchObject({ width: 2.5 });
    expect(p1[1].dash).toBeUndefined();
  });
});
