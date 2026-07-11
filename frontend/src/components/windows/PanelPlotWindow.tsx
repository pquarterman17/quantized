// The composite `kind:"panel"` window's content (MAIN_PLAN #19 v1): the
// Library quick picks' "Panel: side by side/stacked/grid" render one
// `PanelCell` per dataset in a CSS grid shaped by `lib/panelwindow.
// panelGridShape` (reusing multipanel's sqrt-balanced tiling for "grid");
// "Overlay in one plot" renders a single `PanelOverlayWindow` instead. A
// dataset id that no longer resolves (removed since the window opened —
// `store/panels.ts`'s pruning already dropped it from `win.panel.datasetIds`,
// but this guards a stale/mid-render read too) is simply skipped, never
// crashes; an emptied panel shows a placeholder instead of a blank canvas.
//
// Sibling panels join the window-PRIVATE sync group (`lib/panelwindow.
// panelSyncKey`, keyed off this window's own id) so x-zoom/cursor link
// across them by default — distinct from the cross-WINDOW link groups
// (item 13), which stay XY-plot-only and are irrelevant to a composite
// window (it has no single `linkGroup` of its own in v1).
//
// Drag-to-rearrange follow-up: each PanelCell gets `windowId` + its `index`
// (the cell's RAW position in `win.panel.datasetIds`, found via `ids.
// indexOf` rather than the post-filter `resolved` array's own index) so a
// drag/drop always splices against the actual store array position even if
// a stale id sits between two live cells mid-render (see the file-header
// comment above on why a stale id can transiently survive one render).

import { panelGridShape, panelSyncKey } from "../../lib/panelwindow";
import type { PanelLayout, PlotWindow } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import PanelCell from "./PanelCell";
import PanelOverlayWindow from "./PanelOverlayWindow";

export interface PanelPlotWindowProps {
  win: PlotWindow;
  datasets: readonly Dataset[];
}

function PanelEmptyState({ text }: { text: string }) {
  return <div className="qzk-panel-empty">{text}</div>;
}

export default function PanelPlotWindow({ win, datasets }: PanelPlotWindowProps) {
  const layout: PanelLayout = win.panel?.layout ?? "grid";
  const ids = win.panel?.datasetIds ?? [];
  // Preserve the picked order; a stale id (dataset removed) is dropped —
  // never renders a broken cell.
  const resolved = ids
    .map((id) => datasets.find((d) => d.id === id))
    .filter((d): d is Dataset => d != null);

  if (resolved.length === 0) {
    return (
      <PanelEmptyState text="No datasets — every dataset in this panel was removed. Close this window or drag a new one in from the Library." />
    );
  }

  if (layout === "overlay") {
    return <PanelOverlayWindow datasets={resolved} />;
  }

  const { rows, cols } = panelGridShape(layout, resolved.length);
  return (
    <div
      className="qzk-panel-grid"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
    >
      {resolved.map((ds) => (
        <PanelCell
          key={ds.id}
          dataset={ds}
          syncKey={panelSyncKey(win.id)}
          windowId={win.id}
          index={ids.indexOf(ds.id)}
        />
      ))}
    </div>
  );
}
