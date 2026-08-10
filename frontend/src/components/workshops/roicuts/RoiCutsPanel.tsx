// ROI cuts workshop — view (RSM_CUTS_PLAN item 8). A draggable ToolWindow,
// the workshop pattern's thin view: state + polar routing live in
// useRoiCuts.ts, each card (Box/Sector/Saved ROIs) is its own sub-component.
//
// This panel is NEVER required for a plain box cut — once item 6 lands, the
// map's floating inline bar (draw a box, click ∫x) is the fast 3-click path.
// What THIS panel is for: exact numeric bounds, sector/annulus profiles, and
// named ROIs you re-apply on the next dataset — the one entry point that
// works without ever touching the canvas (select a dataset from the
// Library, everything else is typed).

import ToolWindow from "../../overlays/ToolWindow";
import { useApp } from "../../../store/useApp";
import { useRoiCuts } from "./useRoiCuts";
import BoxCard from "./BoxCard";
import SectorCard from "./SectorCard";
import SavedRoisCard from "./SavedRoisCard";
import BatchCard from "./BatchCard";

export default function RoiCutsPanel() {
  const setOpen = useApp((s) => s.setRoiCutsOpen);
  const roi = useRoiCuts();

  return (
    <ToolWindow id="roi-cuts" title="ROI cuts" width={340} onClose={() => setOpen(false)}>
      {!roi.active && <Hint>Select a dataset first.</Hint>}
      {roi.active && !roi.isMap && (
        <Hint>The active dataset is not a 2-D map. Import a 2-D area-scan dataset.</Hint>
      )}

      {roi.isMap && (
        <>
          <BoxCard roi={roi} />
          <SectorCard roi={roi} />
          <BatchCard roi={roi} />
        </>
      )}
      <SavedRoisCard roi={roi} />
    </ToolWindow>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
      {children}
    </div>
  );
}
