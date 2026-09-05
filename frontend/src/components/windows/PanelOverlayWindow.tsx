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
import { rowStateIdentity } from "../../lib/rowstate";
import type { Dataset } from "../../lib/types";
import { LINEAR_PATHS, POINTS_PATHS, STEPPED_MID_PATHS, STEPPED_PATHS, STEPPED_PATHS_PRE } from "../../lib/uplotPaths";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import PlotViewport from "../Stage/PlotViewport";

const OVERLAY_VIEW = defaultPlotView();

// Cheap re-render gate for the overlay merge. The PREVIOUS version built
// `datasets.map((d) => [...droppedRows(d)].join(","))` — an O(datasets x
// rows) full-row-set string, materialized on EVERY render before the
// `useMemo` below even ran. Worse, `PanelPlotWindow`'s `resolved` array
// (this component's `datasets` prop) is a fresh `.map().filter()` result on
// every one of ITS renders, so listing `datasets` itself as a memo
// dependency defeated the memo entirely — `buildOverlayPayload` (and the
// `droppedRows` calls inside its `analysisData`) reran unconditionally.
//
// Fixed by comparing only object IDENTITY (no row iteration) of the exact
// fields `buildOverlayPayload` reads per dataset: `name` (the series label)
// plus `lib/rowstate.rowStateIdentity` — the sanctioned accessor for the
// data/exclusion-list/filter references `droppedRows` derives from (the #50
// architecture guard forbids reading the dataset's raw exclusion field
// anywhere but the row-state model itself). The store's immutable-update
// convention (every mutation spreads `{...d, field: newRef}`) means any of
// these actually changing always produces a new reference, so this never
// misses a real change — it only skips recompute when every dataset is byte-for-byte
// the same object it was last render.
function useOverlaySignature(datasets: Dataset[]): number {
  const versionRef = useRef(0);
  const prevRef = useRef<readonly unknown[]>([]);
  const next = datasets.flatMap((d) => [...rowStateIdentity(d), d.name]);
  const prev = prevRef.current;
  const changed = next.length !== prev.length || next.some((v, i) => v !== prev[i]);
  if (changed) {
    versionRef.current += 1;
    prevRef.current = next;
  }
  return versionRef.current;
}

export default function PanelOverlayWindow({ datasets }: { datasets: Dataset[] }) {
  const theme = useApp((s) => s.theme);
  const accent = useApp((s) => s.accent);
  const defaultTrace = useApp((s) => s.defaultTrace);
  const defaultLineWidth = useApp((s) => s.defaultLineWidth);
  const plotRef = useRef<uPlot | null>(null);
  const overlaySignature = useOverlaySignature(datasets);
  const { payload, overflow } = useMemo(
    () => buildOverlayPayload(datasets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overlaySignature],
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
        steppedPathsPre={STEPPED_PATHS_PRE}
        steppedPathsMid={STEPPED_MID_PATHS}
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
