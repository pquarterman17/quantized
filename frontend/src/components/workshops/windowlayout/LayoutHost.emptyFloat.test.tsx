// Empty workspace + window layout: floating windows must not cover the welcome card, and must come back at
// their saved geometry (placements and tool-window rects untouched) once data loads.

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { dock, emptyLayout, float } from "../../../lib/windowLayout/ops";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import LayoutHost from "./LayoutHost";

vi.mock("../../Stage/PlotStage", () => ({ default: () => <div data-testid="plot-stage" /> }));
vi.mock("../../Inspector/Inspector", () => ({ default: () => <aside data-testid="inspector" /> }));
vi.mock("../../windows/useWindowCommands", () => ({ useWindowCommands: () => {} }));
vi.mock("../../history/useHistoryCommands", () => ({ useHistoryCommands: () => {} }));
vi.mock("../../../commands/recentProjectsCommands", () => ({ useRecentProjectsCommands: () => {} }));
vi.mock("../../../commands/relinkCommands", () => ({ useRelinkCommands: () => {} }));
vi.mock("../../../commands/workbookTransferCommands", () => ({ useWorkbookTransferCommands: () => {} }));
vi.mock("../../../commands/projectLockCommands", () => ({ useProjectLockCommands: () => {} }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
beforeAll(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => void localStorage.clear());

const DATASET: Dataset = { id: "d1", name: "ds1", data: { time: [0, 1], values: [[1], [2]], labels: ["a"], units: [""], metadata: {} } };
const RECT = { x: 300, y: 120, width: 420, height: 380, collapsed: false };

function seed(datasets: Dataset[]) {
  localStorage.clear();
  useApp.setState({
    datasets,
    activeId: datasets[0]?.id ?? null,
    plotWindows: [],
    layoutMode: "windows",
    windowLayout: float(dock(emptyLayout(), "style", "right"), "data"),
    toolWindowLayout: { data: RECT },
  });
}

describe("floating windows over an empty workspace", () => {
  it("renders no float layer while empty, keeps saved state, and restores the window when data loads", async () => {
    seed([]);
    const layoutBefore = useApp.getState().windowLayout;
    const { container } = render(<LayoutHost />);
    expect(await screen.findByLabelText("Empty project")).toBeTruthy();
    expect(container.querySelector(".qzk-wl-float")).toBeNull();
    expect(document.querySelector('[data-tool-window="data"]')).toBeNull();
    expect(useApp.getState().windowLayout).toBe(layoutBefore);
    expect(useApp.getState().toolWindowLayout.data).toEqual(RECT);

    act(() => useApp.setState({ datasets: [DATASET], activeId: "d1" }));
    await waitFor(() => expect(document.querySelector('[data-tool-window="data"]')).not.toBeNull());
    expect(container.querySelector(".qzk-wl-float")).not.toBeNull();
    expect(useApp.getState().toolWindowLayout.data).toEqual(RECT);
  });

  it("with data the float layer is there from the start", async () => {
    seed([DATASET]);
    const { container } = render(<LayoutHost />);
    expect(container.querySelector(".qzk-wl-float")).not.toBeNull();
    await waitFor(() => expect(document.querySelector('[data-tool-window="data"]')).not.toBeNull());
  });
});
