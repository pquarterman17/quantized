// G24 "Use row states": lay the dataset's per-row colours / markers over the
// Stage's colour-scatter specs. The eager half is this gate only; the
// derivation (`lib/rowStyleSpecs`) loads through a dynamic import the first time
// a plotted series asks for row states, so a figure that never does pays
// nothing (and draws exactly as before until the module lands).

import { useEffect, useMemo, useState } from "react";

import type { ColorScatterSpec } from "../../lib/colorscatter";
import { onLoadFailure, runLazy } from "../../lib/runLazy";
import type { Dataset, SeriesStyle } from "../../lib/types";

type Mod = typeof import("../../lib/rowStyleSpecs");
let loaded: Mod | null = null;

export function useRowStateColumns(
  base: Map<number, ColorScatterSpec>,
  ds: Dataset | null | undefined,
  plotted: readonly number[],
  styles: Record<number, SeriesStyle>,
  skip: boolean,
): Map<number, ColorScatterSpec> {
  const wanted = !skip && !!ds?.rowStyle && plotted.some((ch) => styles[ch]?.rowStates);
  const [mod, setMod] = useState<Mod | null>(loaded);
  useEffect(() => {
    if (!wanted || mod) return;
    let live = true;
    void runLazy("Loading row states…", () => import("../../lib/rowStyleSpecs")).then((m) => { loaded = m; if (live) setMod(m); }, onLoadFailure);
    return () => { live = false; };
  }, [wanted, mod]);
  const rowStyle = ds?.rowStyle;
  return useMemo(
    () => (wanted && mod && ds ? mod.withRowStates(base, ds, plotted, styles) : base),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ds identity churns on renames; rowStyle + data are what the specs read
    [wanted, mod, base, ds?.id, ds?.data, rowStyle, plotted, styles],
  );
}
