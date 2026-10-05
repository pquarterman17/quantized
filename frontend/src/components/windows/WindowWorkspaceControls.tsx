import { snapshotView } from "../../lib/plotview";
import { useApp } from "../../store/useApp";

/** Always-visible entry points for the common Origin-style MDI workflows.
 * The full command set remains under Window; this strip keeps the two daily
 * actions (another plot, plot beside worksheet) out of menu archaeology. */
export default function WindowWorkspaceControls() {
  const activeId = useApp((s) => s.activeId);
  const visibleCount = useApp(
    (s) => s.plotWindows.filter((win) => win.winState !== "minimized").length,
  );
  const focusedState = useApp(
    (s) => s.plotWindows.find((win) => win.id === s.focusedWindowId)?.winState ?? null,
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
          if (s.focusedWindowId) {
            s.toggleMaximizeWindow(s.focusedWindowId);
            s.setStageTab("plot");
          }
        }}
        disabled={!focusedState}
        title={focusedState === "maximized" ? "Restore the active window" : "Maximize the active window"}
        aria-label={focusedState === "maximized" ? "Restore active window" : "Maximize active window"}
      >
        {focusedState === "maximized" ? "❐" : "□"}
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
