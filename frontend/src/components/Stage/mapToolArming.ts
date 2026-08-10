// Box ROI, cut ruler, the sector wedge, and the H/V/seg cut tool are
// mutually exclusive (same canvas pointer gestures) — arming one disarms the
// others. Extracted out of MapStage.tsx (RSM_CUTS_PLAN item 7: the ruler
// wiring pushed that file to its 400-line ceiling; this is pure dispatch
// over each tool's own {mode, setMode} pair, no JSX/refs/hooks involved, so
// it factors cleanly into its own focused module rather than trimming the
// feature). Item 12 (sector wedge) adds a 4th tool here rather than growing
// MapStage.tsx's own if-block routing — see `routedTool` below.

import type { CutMode } from "../../lib/mapcuts";
import type { MapPayload } from "../../lib/mapdata";
import type { RoiMode, RulerMode, WedgeMode } from "./MapToolbar";

interface ArmableRoi {
  mode: RoiMode;
  setMode: (m: RoiMode) => void;
}

interface ArmableRuler {
  mode: RulerMode;
  setMode: (m: RulerMode) => void;
}

interface ArmableWedge {
  mode: WedgeMode;
  setMode: (m: WedgeMode) => void;
}

interface ArmableCuts {
  setMode: (m: CutMode) => void;
}

export interface MapToolArming {
  setCutMode: (m: CutMode) => void;
  toggleRoi: () => void;
  toggleRuler: () => void;
  toggleWedge: () => void;
}

/** Build the four mutually-exclusive arm/disarm dispatchers MapStage.tsx
 *  wires to its toolbar. Takes each tool's live {mode, setMode} (re-called
 *  every render, like any other derived-from-hooks value in that
 *  component) rather than owning state itself. */
export function armExclusively(
  roi: ArmableRoi,
  ruler: ArmableRuler,
  wedge: ArmableWedge,
  cuts: ArmableCuts,
): MapToolArming {
  return {
    setCutMode: (m) => {
      if (m !== "off") {
        roi.setMode("off");
        ruler.setMode("off");
        wedge.setMode("off");
      }
      cuts.setMode(m);
    },
    toggleRoi: () => {
      if (roi.mode === "roi") {
        roi.setMode("off");
      } else {
        cuts.setMode("off");
        ruler.setMode("off");
        wedge.setMode("off");
        roi.setMode("roi");
      }
    },
    toggleRuler: () => {
      if (ruler.mode === "ruler") {
        ruler.setMode("off");
      } else {
        cuts.setMode("off");
        roi.setMode("off");
        wedge.setMode("off");
        ruler.setMode("ruler");
      }
    },
    toggleWedge: () => {
      if (wedge.mode === "sector") {
        wedge.setMode("off");
      } else {
        cuts.setMode("off");
        roi.setMode("off");
        ruler.setMode("off");
        wedge.setMode("sector");
      }
    },
  };
}

/** One tool's live drag-routing surface, shaped so `routedTool` can pick
 *  whichever of {box, ruler, wedge} is currently armed without MapStage.tsx
 *  writing a separate if-block per tool (RSM_CUTS_PLAN item 12: adding a
 *  3rd gesture-driven tool to that file's existing 2-if-block routing would
 *  have pushed it over its own 400-line ceiling). `roi`/`ruler`/`wedge`'s
 *  own returned hook state already has exactly this shape (plus more, which
 *  a spread `{ armed, ...roi }` object literal carries along harmlessly —
 *  TS's excess-property check does not fire on spread-sourced properties). */
export interface ArmedTool {
  armed: boolean;
  cursor: string;
  onDown: (payload: MapPayload, w: number, h: number, px: [number, number]) => void;
  onMove: (payload: MapPayload, w: number, h: number, px: [number, number]) => void;
  onUp: (px: [number, number]) => void;
}

/** The first (only, given `armExclusively`'s invariant) tool whose `armed`
 *  flag is true, or null when none is — MapStage.tsx's ONE dispatch point
 *  for onDown/onMove/onUp/cursor instead of one if-block per tool. */
export function routedTool(tools: readonly ArmedTool[]): ArmedTool | null {
  return tools.find((t) => t.armed) ?? null;
}
