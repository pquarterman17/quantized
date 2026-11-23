// The window-layout toolbar (WORKSPACE_LAYOUT_PLAN D4, the mockup's "Window"
// row): the arrange commands, then a toggle per singleton window (Style today;
// pressed = open, press to close or reopen it) and a restore button per
// minimized plot window. It takes the place of the classic stage tab strip,
// which windows mode hides.
//
// Fail closed on the views this preview cannot show yet: an action that asks
// for the Worksheet, Map or Workflow stage view (a Library click on a book,
// New workbook, a technique command) sets the classic stage tab, which nothing
// here renders. The toolbar then says so and offers the classic layout,
// instead of the request silently doing nothing (the adapter is plan P5).

import type { WindowLayoutV1 } from "../../../lib/windowLayout/types";
import { useApp } from "../../../store/useApp";
import { closeRef, dockAllWindows, floatAllWindows, reopenRef, tileAllWindows } from "../../../store/windowLayoutActions";
import { PLOT_DATA_PENDING } from "./useLayoutCommands";

const PENDING_VIEW: Record<string, string> = { worksheet: "Worksheet", map: "Map", technique: "Workflow", analysis: "Workflow" };

export default function LayoutToolbar({ layout }: { layout: WindowLayoutV1 }) {
  const plotWindows = useApp((s) => s.plotWindows);
  const minimized = plotWindows.filter((w) => w.winState === "minimized");
  const datasets = useApp((s) => s.datasets);
  const styleOpen = layout.placements.style?.open === true;
  const pendingView = PENDING_VIEW[useApp((s) => s.stageTab)];
  const setStageTab = useApp((s) => s.setStageTab);
  const setLayoutMode = useApp((s) => s.setLayoutMode);

  return (
    <div className="qzk-wl-toolbar" role="toolbar" aria-label="Window layout">
      <span className="qzk-wl-toolbar-label">Window</span>
      <button type="button" className="qzk-wl-tbtn" aria-disabled="true" title={PLOT_DATA_PENDING}>
        ▥ Plot | Data side by side
      </button>
      <button type="button" className="qzk-wl-tbtn" title="Share the centre between every open window as an even grid." onClick={tileAllWindows}>
        ⊞ Tile all
      </button>
      <button type="button" className="qzk-wl-tbtn" title="Dock the focused plot in the centre and Style on the right." onClick={dockAllWindows}>
        ▦ Dock all
      </button>
      <button type="button" className="qzk-wl-tbtn" title="Float every docked window at its own saved position." onClick={floatAllWindows}>
        ⧉ Float all
      </button>
      <span className="qzk-wl-toolbar-sep" aria-hidden="true" />
      <button
        type="button"
        className="qzk-wl-pill"
        aria-pressed={styleOpen}
        title={styleOpen ? "Close the Style window." : "Reopen the Style window where it was."}
        onClick={() => (styleOpen ? closeRef("style") : reopenRef("style"))}
      >
        Style
      </button>
      {minimized.map((w) => {
        const name = w.title || datasets.find((d) => d.id === w.datasetId)?.name || "Untitled graph";
        return (
          <button key={w.id} type="button" className="qzk-wl-pill" title={`Restore "${name}".`} onClick={() => reopenRef(`plot:${w.id}`)}>
            ▭ {name}
          </button>
        );
      })}
      {pendingView && (
        <span className="qzk-wl-notice" role="status">
          The {pendingView} view is not in the window layout yet.
          <button type="button" className="qzk-wl-tbtn" onClick={() => void setLayoutMode("classic")}>
            Open the classic layout
          </button>
          <button type="button" className="qzk-wl-close" aria-label="Dismiss" title="Stay in the window layout." onClick={() => setStageTab("plot")}>
            ✕
          </button>
        </span>
      )}
    </div>
  );
}
