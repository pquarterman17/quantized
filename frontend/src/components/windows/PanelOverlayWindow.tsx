// The "Overlay in one plot" composite window content (MAIN_PLAN #19 v1): ONE
// viewport showing every panel dataset merged onto a shared union-x axis
// (`lib/panelwindow.buildOverlayPayload` — pure, non-destructive, reads each
// dataset through `lib/rowstate.analysisData` so exclusion/filter (#50/#53)
// stay honored). Auto dual-Y by unit family (owner-decided rule): the first
// unit family stays on the left axis, the second gets the right (y2) axis; a
// 3rd+ family collapses back onto the left and fires a ONE-TIME toast warning
// when it first appears (never re-fires on every re-render/row-state change
// while the overflow condition persists — only on the false->true edge).

import { useEffect, useMemo, useRef } from "react";
import type uPlot from "uplot";

import { buildOverlayPayload } from "../../lib/panelwindow";
import { defaultPlotView } from "../../lib/plotview";
import { resolveTemplate } from "../../lib/plotTemplates";
import { droppedRows } from "../../lib/rowstate";
import type { Dataset } from "../../lib/types";
import { LINEAR_PATHS, POINTS_PATHS, STEPPED_PATHS } from "../../lib/uplotPaths";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import PlotViewport from "../Stage/PlotViewport";

const OVERLAY_VIEW = defaultPlotView();

export default function PanelOverlayWindow({ datasets }: { datasets: Dataset[] }) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const defaultTrace = useApp((s) => s.defaultTrace);
  const defaultLineWidth = useApp((s) => s.defaultLineWidth);
  const plotRef = useRef<uPlot | null>(null);
  // Row-state (#50/#53 exclusion + local filter, folded together by the
  // sanctioned `lib/rowstate.droppedRows` chokepoint) can change live after
  // the window opens, so re-merge whenever any dataset's dropped-row set
  // changes — not just on the dataset identity list.
  const rowStateKey = datasets.map((d) => [...droppedRows(d)].join(",")).join("|");
  const { payload, overflow } = useMemo(
    () => buildOverlayPayload(datasets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [datasets, rowStateKey],
  );

  // Fire the "3+ unit families" warning once per false->true edge, never on
  // every render while it stays true (a live exclusion toggle that doesn't
  // change which unit families are present shouldn't re-toast).
  const warnedRef = useRef(false);
  useEffect(() => {
    if (overflow && !warnedRef.current) {
      warnedRef.current = true;
      toast("3+ unit families — plotting on left axis", "info");
    } else if (!overflow) {
      warnedRef.current = false;
    }
  }, [overflow]);

  return (
    <div className="qzk-panel-overlay">
      <PlotViewport
        plotRef={plotRef}
        displayPayload={payload}
        theme={theme}
        accent={accent}
        yScale={OVERLAY_VIEW.yScale}
        xScale={OVERLAY_VIEW.xScale}
        xLim={null}
        yLim={null}
        xStep={null}
        yStep={null}
        y2Lim={null}
        y2Scale={null}
        y2Step={null}
        xFmt={OVERLAY_VIEW.xFmt}
        yFmt={OVERLAY_VIEW.yFmt}
        showGrid={OVERLAY_VIEW.showGrid}
        axisBox={OVERLAY_VIEW.showAxisBox}
        fontSize={resolveTemplate(OVERLAY_VIEW.plotTemplate).fontSize}
        baseLineWidth={defaultLineWidth}
        defaultTrace={defaultTrace}
        steppedPaths={STEPPED_PATHS}
        linearPaths={LINEAR_PATHS}
        pointsPaths={POINTS_PATHS}
        wheelZoom={false}
        title=""
        xAxisLabel={payload.xLabel}
        yAxisLabel=""
        y2AxisLabel=""
        tool="zoom"
        onReadout={() => {}}
        peakWizardEdit={null}
        anchorEdit={null}
      />
    </div>
  );
}
