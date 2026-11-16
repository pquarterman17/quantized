// Curve Fit's fit-range line under the Fit bar (UX audit 8 #5, lane UX8-D;
// the rules are ./fitRange). It keeps the panel's analysis selection `range`
// -- the rows the fit reads (lib/fitselection.ts's `selectedFitData`), shown
// in Review inputs -- on what the user can see:
//
//  * zoomed in on the fitted dataset (a direct launch, not a reviewed
//    hand-off): the VISIBLE X range, following the zoom -- until a fit
//    lands. Zooming to LOOK at a fit must not change what it was fitted to
//    (nor mark it stale), so with a current fit the zoom is only offered
//    ("Use visible range");
//  * "Fit range: drag on plot" (offered when a single-peak model or a poor fit
//    would fit too much): arms the plot's region rubber-band; the dragged
//    range wins over the zoom and stays until "Whole range";
//  * a range picked on the plot BEFORE the launch (Live-fit band, ∫ region,
//    selected rows) or set by a fit template is left alone unless the user
//    drags a new one.
//
// The Baseline workshop arms the same rubber-band; each panel tags its arm
// (lib/regionPickOwner) and takes only its own drag.

import { useEffect, useMemo, useState } from "react";

import type { AnalysisRangeSelection } from "../../../lib/analysisSelection";
import { fullPlottedX } from "../../../lib/fitselectionActions";
import { sigFigs } from "../../../lib/fitValueFormat";
import { armRegionPick, regionPickOwner, releaseRegionPick } from "../../../lib/regionPickOwner";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import { finiteExtent, sameRange, zoomedRange, type XRange } from "./fitRange";

const SOURCE_LABEL: Record<AnalysisRangeSelection["source"], string> = {
  manual: "template",
  dragged: "dragged",
  "visible x range": "visible x range",
  "gadget region": "Live-fit band",
  "integration region": "∫ region",
  "selected rows": "selected rows",
};

const line = { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 } as const;
const note = { color: "var(--text-faint)", fontSize: "var(--font-size-sm)" } as const;

export default function FitRangeBar({ active, offer, fitted }: {
  active: Dataset | null;
  /** Offer the drag even with no range: a single-peak model, or a poor fit. */
  offer: boolean;
  /** A current (not stale) fit is showing: the zoom no longer moves the range. */
  fitted: boolean;
}) {
  const activeId = useApp((s) => s.activeId);
  const xLim = useApp((s) => s.xLim);
  const xKey = useApp((s) => s.xKey);
  const plotTool = useApp((s) => s.plotTool);
  const setPlotTool = useApp((s) => s.setPlotTool);
  const regionPicked = useApp((s) => s.regionPicked);
  const setRegionPicked = useApp((s) => s.setRegionPicked);
  const owner = useAnalysisSelection((s) => s.toolId);
  const selection = useAnalysisSelection((s) => s.selection);
  const updateItem = useAnalysisSelection((s) => s.updateItem);
  const [dragged, setDragged] = useState<(XRange & { id: string }) | null>(null);
  // Armed, with the tool Cancel goes back to.
  const [armed, setArmed] = useState<{ back: typeof plotTool } | null>(null);

  const id = active?.id ?? null;
  const item = owner === "curvefit" && id ? selection?.items.find((i) => i.datasetId === id) ?? null : null;
  // The data's X extent once per dataset / column, not on every zoom or pan frame.
  const extent = useMemo(() => (active ? finiteExtent(fullPlottedX(active.data, xKey)) : null), [active, xKey]);
  const view = active && active.id === activeId ? zoomedRange(xLim, extent) : null;

  // An armed drag lands as this dataset's range -- only a drag armed HERE
  // (lib/regionPickOwner: Baseline arms the same tool) -- and the plot goes
  // back to the tool the user had; leaving the tool without a drag disarms.
  useEffect(() => {
    if (!armed) return;
    if (regionPicked && id && regionPickOwner() === "curvefit") {
      const [a, b] = regionPicked.x;
      setDragged({ id, lo: Math.min(a, b), hi: Math.max(a, b) });
      setRegionPicked(null);
      setArmed(null);
      setPlotTool(armed.back);
    } else if (plotTool !== "region") {
      releaseRegionPick("curvefit");
      setArmed(null);
    }
  }, [armed, regionPicked, plotTool, id, setRegionPicked, setPlotTool]);
  // Closing the panel mid-drag leaves no tag behind.
  useEffect(() => () => releaseRegionPick("curvefit"), []);

  const mine = dragged && dragged.id === id ? dragged : null;
  const cur = item?.range ?? null;
  const pickedBefore = !!cur && cur.source !== "dragged" && cur.source !== "visible x range";
  const want: AnalysisRangeSelection | null = mine
    ? { lo: mine.lo, hi: mine.hi, source: "dragged" }
    : view && selection?.source === "tool-default" ? { ...view, source: "visible x range" } : null;
  const differs = !sameRange(cur, want) || cur?.source !== want?.source;
  // A drag (made or undone) always applies; the zoom only while no fit shows.
  const hold = !mine && (pickedBefore || (fitted && cur?.source !== "dragged"));
  const apply = () => {
    if (id) updateItem(id, { range: want });
  };
  // Re-applied after a re-seed of the selection (a plot or role change).
  useEffect(() => {
    if (item && id && !hold && differs) updateItem(id, { range: want });
  });

  if (!active || !item) return null;
  const drag = () => {
    armRegionPick("curvefit");
    setArmed({ back: plotTool === "region" ? "zoom" : plotTool });
    setPlotTool("region");
  };
  if (armed && plotTool === "region") {
    return (
      <div style={line} role="status">
        <span style={note}>Drag across the peak on the plot…</span>
        <Button size="sm" variant="ghost" onClick={() => setPlotTool(armed.back)}>Cancel</Button>
      </div>
    );
  }
  // A current fit while the zoom shows another range: offered, never imposed.
  const useView = hold && !pickedBefore && differs ? (
    <Button size="sm" variant="ghost" title="Fit the X range the plot shows now" onClick={apply}>
      {want ? "Use visible range" : "Whole range"}
    </Button>
  ) : null;
  if (cur) {
    return (
      <div style={line}>
        <span style={{ ...note, fontFamily: "var(--font-mono)" }} data-testid="cf-fit-range">
          Fit range {sigFigs(cur.lo, 5)} – {sigFigs(cur.hi, 5)} ({SOURCE_LABEL[cur.source]})
        </span>
        <Button size="sm" variant="ghost" title="Drag a new X range on the plot to fit" onClick={drag}>Drag…</Button>
        {mine && <Button size="sm" variant="ghost" title="Fit the whole X range (or the visible one when zoomed)" onClick={() => setDragged(null)}>Whole range</Button>}
        {useView}
      </div>
    );
  }
  if (!offer && !useView) return null;
  return (
    <div style={line}>
      {useView}
      {offer && (
        <Button size="sm" title="Fitting the whole X range; drag across one peak on the plot to fit just that" onClick={drag}>
          Fit range: drag on plot
        </Button>
      )}
      <span style={note}>now: whole X range</span>
    </div>
  );
}
