// Acceptance pass 15 U1: the "Single plot" button removes an axis break. It was silent; now it records ONE undo
// step and says so in a toast whose Undo brings the break back.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { breakPanelsOf } from "../../lib/composition";
import type { DataStruct } from "../../lib/types";
import { useToasts } from "../../store/toasts";
import { useActiveDataset, useApp } from "../../store/useApp";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

function MultiPanelStage() {
  const active = useActiveDataset();
  return <RealMultiPanelStage composition={useEffectiveComposition(active)} />;
}

const { MockUPlot } = vi.hoisted(() => ({
  MockUPlot: class {
    scales = { x: { min: 0, max: 1 } };
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  },
}));
vi.mock("uplot", () => ({ default: MockUPlot }));
class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

function gapData(): DataStruct {
  const time: number[] = [];
  const values: number[][] = [];
  for (let i = 0; i <= 20; i++) { time.push(i); values.push([10 + i, 100 + i]); }
  for (let i = 0; i < 3; i++) { time.push(100 + i); values.push([300 + i, 400 + i]); }
  return { time, values, labels: ["Field", "Signal"], units: ["T", "au"], metadata: {} };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data: gapData() }], activeId: "d1", xKey: null, yKeys: null, y2Keys: null,
    seriesOrder: null, hiddenChannels: [], stackMode: false, composition: null, facetKey: null, groupKey: null,
    seriesLabels: {}, plotWindows: [], focusedWindowId: null, history: [], future: [],
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("MultiPanelStage Single plot button on a break plot", () => {
  it("removes the break as one undo step, names it in a toast, and Undo restores it", async () => {
    useApp.getState().breakAtGaps("d1", [[20, 100]]);
    expect(breakPanelsOf(useApp.getState().composition)).toHaveLength(2);
    const depth = useApp.getState().history.length;
    render(<MultiPanelStage />);
    fireEvent.click(await screen.findByRole("button", { name: "Single plot" }));
    expect(useApp.getState().composition).toBeNull();
    expect(useApp.getState().history).toHaveLength(depth + 1);
    const t = useToasts.getState().toasts.find((x) => x.msg.startsWith("removed the axis break"));
    expect(t).toBeDefined();
    act(() => t?.action?.onClick());
    await waitFor(() => expect(breakPanelsOf(useApp.getState().composition)).toHaveLength(2));
  });
});
