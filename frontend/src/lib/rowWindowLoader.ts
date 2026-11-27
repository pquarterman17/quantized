// The plot's row window (lib/plotRowWindow.ts) is a lazy chunk: a plot with no row range never fetches it. While a
// range waits for it the hook answers null and the plot draws nothing (never every row, which a range says to hide).
// A failed fetch stays blank: fail closed.

import { useEffect, useState } from "react";

import type { PlotPayload } from "./plotdata";
import type { RowRange } from "./rowRange";

type Windowing = (payload: PlotPayload, range: RowRange | undefined, rows: number) => PlotPayload;
const same: Windowing = (payload) => payload;
let loaded: Windowing | null = null;

/** How to apply `range` to a payload: the identity with no range, null until the chunk arrives. */
export function useRowWindow(range: RowRange | undefined): Windowing | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (range && !loaded) void import("./plotRowWindow").then((m) => ((loaded = m.windowRows), bump((n) => n + 1)), () => undefined);
  }, [range]);
  return range ? loaded : same;
}
