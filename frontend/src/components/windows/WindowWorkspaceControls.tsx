import { snapshotView, type PlotWindow } from "../../lib/plotview";
import { useApp } from "../../store/useApp";

/** Always-visible entry points for the common Origin-style MDI workflows.
 * The full command set remains under Window; this strip keeps the two daily
 * actions (another plot, plot beside worksheet) out of menu archaeology. */
export default function WindowWorkspaceControls() {
  const activeId = useApp((s) => s.activeId);
  const visibleCount = useApp(
    (s) => s.plotWindows.filter((win) => win.winState !== "minimized").length,
  );
  // `focusedWindowId` deliberately tracks only editable plot windows. A
  // worksheet/map/snapshot can still be the frontmost document, so the
  // workspace-level maximize action must follow z-order rather than silently
  // changing the last plot behind it. Equal z values resolve to the later DOM
  // window, which is also the one painted on top.
  const frontWindow = useApp(
    (s) => s.plotWindows.reduce<PlotWindow | null>((front, win) => {
      if (win.winState === "minimized") return front;
      return front === null || win.z >= front.z ? win : front;
    }, null),
  );

  const newPlot = () => {
    const s = useApp.getState();
    const id = s.createWindow(s.activeId, snapshotView(s));
    s.focusWindow(id);
    s.setStageTab("plot");
  };

  const openWorksheet = () => {
    const s = useApp.getState();
    if (!s.activeId) return;
    const id = s.createDocumentWindow("worksheet", s.activeId);
    s.focusWindow(id); // document windows raise without taking plot-view focus
    s.setStageTab("plot");
  };

  return (
    <div className="qzk-window-workspace" role="toolbar" aria-label="Plot and worksheet windows">
      <button type="button" onClick={newPlot} title="Open another editable plot window">
        <span aria-hidden="true">＋</span>
        <span>Plot</span>
      </button>
      <button
        type="button"
        onClick={openWorksheet}
        disabled={!activeId}
        title={activeId ? "Show this dataset's worksheet beside its plot" : "Select a dataset first"}
      >
        <span aria-hidden="true">▦</span>
        <span>Sheet</span>
      </button>
      <span className="qzk-window-workspace-sep" aria-hidden="true" />
      <button
        type="button"
        onClick={() => {
          const s = useApp.getState();
          if (frontWindow) {
            s.toggleMaximizeWindow(frontWindow.id);
            s.setStageTab("plot");
          }
        }}
        disabled={!frontWindow}
        title={frontWindow?.winState === "maximized" ? "Restore the active window" : "Maximize the active window"}
        aria-label={frontWindow?.winState === "maximized" ? "Restore active window" : "Maximize active window"}
      >
        {frontWindow?.winState === "maximized" ? "❐" : "□"}
      </button>
      <button
        type="button"
        onClick={() => {
          const s = useApp.getState();
          s.tileWindows();
          s.setStageTab("plot");
        }}
        disabled={visibleCount < 2}
        title="Tile visible windows side by side"
        aria-label="Tile visible windows"
      >
        ▦▦
      </button>
      <button
        type="button"
        onClick={() => {
          const s = useApp.getState();
          s.cascadeWindows();
          s.setStageTab("plot");
        }}
        disabled={visibleCount < 2}
        title="Cascade visible windows"
        aria-label="Cascade visible windows"
      >
        ◫
      </button>
    </div>
  );
}
