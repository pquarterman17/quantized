// One saved, named ROI (item 8's Saved ROIs card): a box, ruler, sector or
// polygon definition, round-tripped through `store/rois.ts` and the `.dwk`
// (`store/roisCodec.ts`). Split out of `lib/roi.ts`, which sits at its size pin;
// `roi.ts` re-exports the type, so existing imports keep working.

import type { RoiRect, RoiRuler, RoiSector } from "./roi";
import type { RoiPolygon } from "./roiPolygon";

export type RoiDef = { id: string; name: string } & (
  | { kind: "rect"; rect: RoiRect }
  | { kind: "ruler"; ruler: RoiRuler }
  | { kind: "sector"; sector: RoiSector }
  | { kind: "polygon"; polygon: RoiPolygon }
);
