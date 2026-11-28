// The plain per-channel stack honours the plot's row window (ROW_RANGE_CONTRACT 3.3, item 31). The facet, break and
// spatial arrangements honour it too: `MultiPanelStage.windowKinds.test.tsx`.
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MultiPanelStage from "./MultiPanelStage";
import { stackDataset } from "./stackRows";

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { data: unknown[][] }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(_opts: unknown, data: unknown[][]) {
      created.push({ data });
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

const N = 200;
const ds: Dataset = {
  id: "d1", name: "stack", excludedRows: [25],
  data: {
    time: Array.from({ length: N }, (_v, r) => r),
    values: Array.from({ length: N }, (_v, r) => [r, r % 2]),
    labels: ["a", "g"], units: ["", ""], metadata: {},
  },
};
const WINDOW = { from: 20, to: 43 };

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({ datasets: [ds], activeId: "d1", stackMode: true, yKeys: [0, 1], rowRange: WINDOW });
});
afterEach(() => vi.unstubAllGlobals());

describe("stackDataset", () => {
  it("narrows the analysis rows to the window, keeps no exclusion to re-apply, and ignores a window that does not fit", () => {
    const w = stackDataset(ds, WINDOW);
    expect(w.data.time).toEqual(Array.from({ length: 24 }, (_v, i) => 20 + i).filter((r) => r !== 25));
    expect(w.excludedRows).toEqual([]);
    expect(stackDataset(ds, { from: 20, to: 999 }).data.time).toHaveLength(N - 1);
    expect(stackDataset(ds).data.time).toHaveLength(N - 1);
  });
});

describe("the per-channel stack", () => {
  it("draws only the window's rows in each panel, with the chip claiming exactly that", async () => {
    render(<MultiPanelStage composition={null} />);
    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    expect(created.every((c) => c.data[0].length === 23)).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("rows 21-44 of 200");
    expect(screen.getByRole("status").textContent).not.toContain("draws every row");
  });
});
