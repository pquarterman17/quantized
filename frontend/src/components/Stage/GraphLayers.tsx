// The graph layers over a plot (origin gap audit 3 #15): inset graphs of any
// data with their own axes, images and tables (`PlotView.layers`, validated
// in full here — the eager `.dwk` reader keeps the list as given). The
// focused plot's come from the live store; a background window's from its
// own view (`view` + `windowId`), and their edits land there. Later layers
// draw on top, as in the export. An inset's plot area and a table are filled
// with the plot's own background (the export's axes face), so the curves
// under them do not show through. Lazy: mounted only when a plot has layers.

import { useMemo, type RefObject } from "react";
import type uPlot from "uplot";

import { sanitizeLayers } from "../../lib/graphLayers";
import type { PlotBg, PlotView } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import GraphLayerBox from "./GraphLayerBox";

export default function GraphLayers({
  plotRef,
  view,
  windowId,
  bg,
}: {
  plotRef?: RefObject<uPlot | null>;
  view?: Pick<PlotView, "layers">;
  windowId?: string;
  /** A background window's own background; omitted, the focused window's. */
  bg?: PlotBg;
}) {
  const live = useApp((s) => s.layers);
  const focusedBg = useApp((s) => s.plotWindows.find((w) => w.id === s.focusedWindowId)?.bg);
  const datasets = useApp((s) => s.datasets);
  const raw = view ? view.layers : live;
  const layers = useMemo(() => sanitizeLayers(raw), [raw]);
  return (
    <>
      {layers.map((l) => (
        <GraphLayerBox key={l.id} layer={l} datasets={datasets} plotRef={plotRef} windowId={windowId} bg={view ? bg : focusedBg} />
      ))}
    </>
  );
}
