// The map stage's drawing tools in one place (split out of MapStage.tsx, which
// sits at its component ceiling): the Box, the cut ruler, the sector wedge and
// the Pick tool, which of them is armed, and the arm/disarm dispatchers that keep
// them mutually exclusive with each other and with the H/V/segment cuts. They
// all drive the same canvas pointer gestures, so only one owns them at a time.
//
// The Box is the only one that also works off an RSM axis pair: on any other 2-D
// map it is drawn on the displayed channels (lib/mapBoxSpace.ts). The cut ruler
// and the wedge stay RSM-only, and Pick works wherever the pixel-extraction
// coordinates are well defined (lib/mapPick.ts).

import { useMemo } from "react";

import type { CutSpace } from "../../lib/mapcuts";
import type { Dataset } from "../../lib/types";
import { armExclusively, routedTool, type MapToolArming } from "./mapToolArming";
import type { MapCutsState } from "./useMapCuts";
import type { MapKeys } from "./useMapColumnPicks";
import { useMapPickTool, type UseMapPickToolState } from "./useMapPickTool";
import { useMapRoi, type UseMapRoiState } from "./useMapRoi";
import { useMapRuler, type UseMapRulerState } from "./useMapRuler";
import { useMapSectorWedge, type UseMapSectorWedgeState } from "./useMapSectorWedge";

export interface MapTools extends MapToolArming {
  roi: UseMapRoiState;
  ruler: UseMapRulerState;
  wedge: UseMapSectorWedgeState;
  pick: UseMapPickToolState;
  /** The one armed tool's drag routing, or null. */
  routed: ReturnType<typeof routedTool>;
  /** The Box can be drawn here: an RSM pair, or any plain map's own axes. */
  boxDrawable: boolean;
}

/** `active` is the dataset itself, `mapActive` the same dataset with the column
 *  set the map shows (`mapColumns`); `keys` are the toolbar's X / Y / Z picks. */
export function useMapTools(
  active: Dataset | null,
  mapActive: Dataset | null,
  keys: MapKeys,
  cutSpace: CutSpace | null,
  cuts: MapCutsState,
): MapTools {
  const generic = useMemo(() => (mapActive ? { data: mapActive.data, keys } : null), [mapActive, keys]);
  const roi = useMapRoi(active, cutSpace, generic);
  const ruler = useMapRuler(active, cutSpace);
  const wedge = useMapSectorWedge(active, cutSpace);
  const pick = useMapPickTool(active?.data ?? null, mapActive?.data ?? null, keys);
  const boxDrawable = cutSpace != null || generic != null;
  const routed = routedTool([
    { armed: roi.mode === "roi" && boxDrawable, ...roi },
    { armed: ruler.mode === "ruler" && cutSpace != null, ...ruler },
    { armed: wedge.mode === "sector" && cutSpace === "q", ...wedge },
    { armed: pick.mode === "pick", ...pick },
  ]);
  return { roi, ruler, wedge, pick, routed, boxDrawable, ...armExclusively(roi, ruler, wedge, cuts, pick) };
}
