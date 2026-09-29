// One named cluster of the plot toolbar's icon buttons (Navigate/Inspect/
// Analyze/Annotate/View/Export — GUI_INTERACTION_PLAN #7, plot-toolbar
// legibility). Pure presentational wrapper: an ARIA group (screen-reader
// grouping, always on) plus an optional small uppercase caption (mouse/
// sighted grouping — toggled from the toolbar's own "..." flyout, persisted
// via store/prefs.ts). Split out of PlotToolbar.tsx to keep it comfortably
// under the .tsx component-ceiling ratchet.
//
// `collapsed` (GUI audit P1): the group did not fit the stage and its buttons
// live in the dock's "⋯" menu instead. It stays mounted, invisible and out of
// the accessibility tree, so plotToolbarOverflow.ts can still measure it.

import type { ReactNode } from "react";

interface Props {
  label: string;
  showLabel: boolean;
  collapsed?: boolean;
  children: ReactNode;
}

export default function PlotToolbarGroup({ label, showLabel, collapsed = false, children }: Props) {
  return (
    <div
      className="qzk-tool-group"
      role="group"
      aria-label={label}
      data-tool-group=""
      data-overflow={collapsed ? "" : undefined}
      aria-hidden={collapsed || undefined}
    >
      {showLabel && <div className="qzk-tool-group-label">{label}</div>}
      <div className="qzk-tool-group-row">{children}</div>
    </div>
  );
}
