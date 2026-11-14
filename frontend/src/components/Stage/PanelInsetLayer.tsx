// Panel insets layer (#15): one PanelInsetBox per `PlotView.panelInsets`
// entry, mounted on the FOCUSED plot only (a background window's panel
// insets are a documented follow-up -- see PLOT_PLAN; the magnifier inset's
// own background-window support, `windowId`/`patchBackgroundView`, is the
// template when that lands). Reads the store directly (an established
// pattern for this overlay family -- InsetPlot.tsx does the same from
// inside the same "pure presentational" PlotStageOverlays).

import type { RefObject } from "react";
import type uPlot from "uplot";
import { useApp } from "../../store/useApp";
import PanelInsetBox from "./PanelInsetBox";

interface Props {
  plotRef?: RefObject<uPlot | null>;
}

export default function PanelInsetLayer({ plotRef }: Props) {
  const panelInsets = useApp((s) => s.panelInsets);
  if (!panelInsets.length) return null;
  return (
    <div data-testid="panel-inset-layer" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {panelInsets.map((p) => (
        <div key={p.id} style={{ pointerEvents: "auto" }}>
          <PanelInsetBox inset={p} plotRef={plotRef} />
        </div>
      ))}
    </div>
  );
}
