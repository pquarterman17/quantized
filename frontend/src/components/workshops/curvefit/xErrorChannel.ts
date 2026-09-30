// Curve Fit — which column holds a dataset's X errors. Its own module so the
// panel can decide whether to offer ODR without loading the lazy ODR section.

import { figureSeedErrorBindings } from "../../../lib/errorRoles";
import type { Dataset } from "../../../lib/types";

/** The symmetric X-error channel of `ds` (designated, or confidently paired
 *  by label: the bindings a new figure draws with), or null when none. */
export function xErrorChannel(ds: Dataset | null | undefined): number | null {
  if (!ds) return null;
  const b = figureSeedErrorBindings(ds).find((e) => e.axis === "x" && e.side === "both");
  return b ? b.channel : null;
}
