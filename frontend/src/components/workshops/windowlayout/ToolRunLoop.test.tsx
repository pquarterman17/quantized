// B1 of UX pass 3: Peaks in window-layout mode looped on /api/peaks/find and never finished.
// A run starting (`busy`) auto-pins the tool (freezeSelection), the run ending thaws it
// (re-seed), and each of those wrote a NEW selection object, which re-armed usePeaks'
// auto-detect effect (it depends on the selected item), which started a new run, which
// flipped `busy` again. The fix keeps the selection's items identity when the capture is
// unchanged. The assertions read state (the panel settles, the pin clears) and bound the
// request count; they never wait on a mock call.

import { act, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks } from "../../../lib/api/peaks";
import { dock, emptyLayout } from "../../../lib/windowLayout/ops";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { layoutTool, resetLayoutToolsForTests } from "../../../store/layoutTools";
import { resetToolDockForTests } from "../../../store/toolDock";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { usePeaks } from "../peaks/usePeaks";
import LayoutHost from "./LayoutHost";

vi.mock("../../../lib/api/peaks", () => ({ findPeaks: vi.fn(), fitMultiPeak: vi.fn(), fitPeak: vi.fn() }));
vi.mock("../../../lib/api", () => ({ fetchBookData: vi.fn() }));
vi.mock("../../Stage/PlotStage", () => ({ default: () => <div data-testid="plot-stage" /> }));
vi.mock("../../windows/BackgroundPlotWindow", () => ({ default: ({ windowId }: { windowId: string }) => <div data-testid={`bg-${windowId}`} /> }));
vi.mock("../../Inspector/Inspector", () => ({ default: () => <aside className="qzk-inspector" /> }));
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

const sheet: Dataset = {
  id: "d1",
  name: "two-peaks.csv",
  data: { time: [0, 1, 2, 3, 4], values: [[1], [5], [2], [6], [2]], labels: ["I"], units: ["cps"], metadata: {} },
};
const win: PlotWindow = {
  id: "w1", kind: "plot", title: "Graph w1", datasetId: "d1", geometry: { x: 40, y: 40, w: 480, h: 360 }, z: 1, winState: "normal",
  view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false,
};

/** Peaks as the real workshop wires it: the hook's `busy` goes to the window frame. */
function PeaksLike() {
  const { busy } = usePeaks();
  return (
    <ToolWindow id="peaks" title="Peaks" busy={busy} onClose={() => {}}>
      <div>{busy ? "Finding peaks…" : "Peaks done"}</div>
    </ToolWindow>
  );
}

beforeEach(() => {
  vi.mocked(findPeaks).mockReset();
  vi.mocked(findPeaks).mockImplementation(() => new Promise((r) => setTimeout(() => r({ peaks: [], background: [] } as never), 40)));
  resetLayoutToolsForTests();
  resetToolDockForTests();
  useAnalysisSelection.getState().clear();
  useApp.setState({
    datasets: [sheet], activeId: "d1", selectedIds: ["d1"], plotWindows: [win], focusedWindowId: "w1",
    layoutMode: "windows", windowLayout: dock(emptyLayout(), "plot:w1", "centre"), leftCollapsed: false, status: "",
  });
});
afterEach(() => resetLayoutToolsForTests());

describe("a tool run in layout mode settles", () => {
  it("Peaks finds once, finishes, and releases its run pin (no request loop)", async () => {
    // Each find is held until the test lets it go, so the run is observably in flight.
    const held: (() => void)[] = [];
    vi.mocked(findPeaks).mockImplementation(() => new Promise((r) => held.push(() => r({ peaks: [], background: [] } as never))));
    const { rerender } = render(<LayoutHost />);
    // The host's lazy side is up before the tool opens (as when a user picks it from the Analysis list).
    await screen.findByTestId("plot-stage");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    rerender(<><LayoutHost /><PeaksLike /></>);
    await expect.poll(() => layoutTool("peaks")?.autoPin).toBe("d1");
    // Let every run finish as it starts; a loop would keep starting new ones.
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        held.splice(0).forEach((release) => release());
        await new Promise((r) => setTimeout(r, 25));
      });
    }
    expect(screen.queryByText("Peaks done")).not.toBeNull();
    expect(layoutTool("peaks")?.autoPin).toBeNull();
    // One find on open. A run's own pin and release must not start another.
    expect(vi.mocked(findPeaks).mock.calls.length).toBeLessThanOrEqual(1);
  });
});
