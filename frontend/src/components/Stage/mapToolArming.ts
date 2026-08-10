// Box ROI, cut ruler, and the H/V/seg cut tool are mutually exclusive (same
// canvas pointer gestures) — arming one disarms the other two. Extracted out
// of MapStage.tsx (RSM_CUTS_PLAN item 7: the ruler wiring pushed that file
// to its 400-line ceiling; this is pure dispatch over each tool's own
// {mode, setMode} pair, no JSX/refs/hooks involved, so it factors cleanly
// into its own focused module rather than trimming the feature).

import type { CutMode } from "../../lib/mapcuts";
import type { RoiMode, RulerMode } from "./MapToolbar";

interface ArmableRoi {
  mode: RoiMode;
  setMode: (m: RoiMode) => void;
}

interface ArmableRuler {
  mode: RulerMode;
  setMode: (m: RulerMode) => void;
}

interface ArmableCuts {
  setMode: (m: CutMode) => void;
}

export interface MapToolArming {
  setCutMode: (m: CutMode) => void;
  toggleRoi: () => void;
  toggleRuler: () => void;
}

/** Build the three mutually-exclusive arm/disarm dispatchers MapStage.tsx
 *  wires to its toolbar. Takes each tool's live {mode, setMode} (re-called
 *  every render, like any other derived-from-hooks value in that
 *  component) rather than owning state itself. */
export function armExclusively(roi: ArmableRoi, ruler: ArmableRuler, cuts: ArmableCuts): MapToolArming {
  return {
    setCutMode: (m) => {
      if (m !== "off") {
        roi.setMode("off");
        ruler.setMode("off");
      }
      cuts.setMode(m);
    },
    toggleRoi: () => {
      if (roi.mode === "roi") {
        roi.setMode("off");
      } else {
        cuts.setMode("off");
        ruler.setMode("off");
        roi.setMode("roi");
      }
    },
    toggleRuler: () => {
      if (ruler.mode === "ruler") {
        ruler.setMode("off");
      } else {
        cuts.setMode("off");
        roi.setMode("off");
        ruler.setMode("ruler");
      }
    },
  };
}
