// The plot's row window (lib/plotRowWindow.ts, with lib/rowWindowDataset.ts) is a lazy chunk: a plot with no row range
// never fetches it. While a range waits for it the hooks answer null and the plot draws nothing (never every row, which
// a range says to hide). A failed fetch stays blank: fail closed.

import { useEffect, useState } from "react";

import type { PlotPayload } from "./plotdata";
import type { RowRange } from "./rowRange";
import type { Dataset } from "./types";

type Windowing = (payload: PlotPayload, range: RowRange | undefined, rows: number) => PlotPayload;
const same: Windowing = (payload) => payload;
let loaded: typeof import("./plotRowWindow") | null = null;

function useWindowChunk(range: RowRange | null | undefined): typeof import("./plotRowWindow") | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (range && !loaded) void import("./plotRowWindow").then((m) => ((loaded = m), bump((n) => n + 1)), () => undefined);
  }, [range]);
  return loaded;
}

/** How to apply `range` to a payload: the identity with no range, null until the chunk arrives. */
export function useRowWindow(range: RowRange | undefined): Windowing | null {
  const m = useWindowChunk(range);
  return range ? m?.windowRows ?? null : same;
}

/** The sheet a panel set (a facet grid, an axis break) is built from, cut to the plot's window: the sheet itself with no
 *  range, null until the chunk arrives (the panels are then built from no rows, never from every row). */
export function useWindowedSheet<T extends Dataset | null | undefined>(ds: T, range: RowRange | null | undefined): T | null {
  const m = useWindowChunk(range);
  return range ? m?.windowedDataset(ds, range) ?? null : ds;
}
