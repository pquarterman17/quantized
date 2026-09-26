// The Stat Stage's computed draws, each KEYED to the inputs it was computed
// for (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 2, review round 2).
//
// The compute effect is async (backend box stats / KDEs), so for a moment
// after the user changes "group by", "facet by" or the value column the stage
// still holds the draw of the PREVIOUS picks while everything derived
// synchronously — the category axis, the facet slices — already describes the
// new ones. Threading the old draw onto the new axis puts boxes under the
// wrong ticks whenever the two happen to have the same number of groups, and
// counting old panels against new facet levels printed "-3 facet panels".
// Labels cannot detect it reliably (two groupings can share them), so this
// records WHICH inputs each draw belongs to instead: `fresh` is true only
// when the stored draws were set under the current `key`.
//
// `key` is any value whose identity changes exactly when the grouping inputs
// do (the hook memoizes an object of them). The setters are stable per
// key, so the compute effect can list them as dependencies without re-running
// for any other reason.
//
// The flat draw and the facet draws are keyed SEPARATELY. The compute effect
// clears one kind at the start of every run (`setDrawFacets(null)` on the flat
// path, `setDrawData(null)` on the faceted one); a single shared key would let
// that clear re-stamp the OTHER, still-old draw as current — exactly the stale
// draw this exists to catch (the review round's forced-race test caught it).

import { useCallback, useState } from "react";

import type { StatDrawData } from "./statRender";
import type { FacetDraw } from "./useStatStageCompute";

interface Drawn {
  draw: StatDrawData | null;
  drawKey: unknown;
  facets: FacetDraw[] | null;
  facetsKey: unknown;
}

export interface StatStageDraws {
  drawData: StatDrawData | null;
  drawFacets: FacetDraw[] | null;
  /** Each stored draw was computed for the current `key`. */
  fresh: { draw: boolean; facets: boolean };
  setDrawData: (draw: StatDrawData | null) => void;
  setDrawFacets: (facets: FacetDraw[] | null) => void;
}

export function useStatStageDraws(key: unknown): StatStageDraws {
  const [drawn, setDrawn] = useState<Drawn>({ draw: null, drawKey: null, facets: null, facetsKey: null });
  const setDrawData = useCallback(
    (draw: StatDrawData | null) => setDrawn((s) => ({ ...s, draw, drawKey: key })),
    [key],
  );
  const setDrawFacets = useCallback(
    (facets: FacetDraw[] | null) => setDrawn((s) => ({ ...s, facets, facetsKey: key })),
    [key],
  );
  return {
    drawData: drawn.draw,
    drawFacets: drawn.facets,
    fresh: { draw: drawn.drawKey === key, facets: drawn.facetsKey === key },
    setDrawData,
    setDrawFacets,
  };
}
