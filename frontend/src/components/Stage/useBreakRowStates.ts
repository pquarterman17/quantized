// G24 "Use row states" on an axis-break row: the break composition with each panel's row colours / glyphs attached
// (`lib/breakRowStates`, lazy). Like `useRowStateColumns` for the flat plot, this gate is all that is eager: a figure
// with no row styles, or no series asking for them, pays nothing and draws exactly as before until the module lands.
// Facet grids are untouched (they draw no row states on screen, and their export sends none).

import { useEffect, useMemo, useState } from "react";

import type { Composition } from "../../lib/composition";
import type { RowRange } from "../../lib/rowRange";
import { onLoadFailure, runLazy } from "../../lib/runLazy";
import type { Dataset, SeriesStyle } from "../../lib/types";

type Mod = typeof import("../../lib/breakRowStates");
let loaded: Mod | null = null;

export function useBreakRowStates(
  composition: Composition | null,
  sheet: Dataset | null | undefined,
  view: Dataset | null | undefined,
  rowRange: RowRange | undefined,
  xKey: number | null,
  styles: Record<number, SeriesStyle>,
): Composition | null {
  const wanted = composition?.kind === "break" && !!sheet?.rowStyle && Object.values(styles).some((s) => s.rowStates);
  const [mod, setMod] = useState<Mod | null>(loaded);
  useEffect(() => {
    if (!wanted || mod) return;
    let live = true;
    void runLazy("Loading row states…", () => import("../../lib/breakRowStates")).then((m) => { loaded = m; if (live) setMod(m); }, onLoadFailure);
    return () => { live = false; };
  }, [wanted, mod]);
  return useMemo(
    () => (wanted && mod && composition && sheet && view ? mod.withBreakRowStates(composition, sheet, view, xKey, view === sheet ? 0 : (rowRange?.from ?? 0), styles) : composition),
    [wanted, mod, composition, sheet, view, rowRange, xKey, styles],
  );
}
