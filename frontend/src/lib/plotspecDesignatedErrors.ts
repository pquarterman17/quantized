// A Graph Builder seed (a worksheet column selection, or "Remake in Graph
// Builder" from a recovered Origin graph) bound to the dataset's OWN error
// columns. The seed used to list a Y-error-designated column as one more Y
// series (and never fill the error wells) -- reader-lane live check on an
// Origin book with yErr columns. `Dataset.errorRoles` already holds the
// right pairing: an Origin book's designations seed it at import (Origin's
// nearest-preceding-Y rule, lib/originBookRoles.ts) and the worksheet's
// "Set As" rewrites it, so the seed reads the bindings, never the labels.
//
// Wells are POSITION-paired with `y` (lib/plotspecErrors.ts), so the y-error
// well fills only up to the first Y without a bound error -- the same
// unambiguous-prefix rule as `prefillErrorZones`; an error column is dropped
// from the Y series either way, since it is never a series of its own.

import type { ErrorBinding } from "./errorRoles";
import type { ChannelRef, PlotSpec } from "./plotspec";
import type { Dataset } from "./types";

export function seedDesignatedErrorZones(spec: PlotSpec, ds: Pick<Dataset, "id" | "errorRoles">): PlotSpec {
  const roles: ErrorBinding[] = (ds.errorRoles ?? []).filter((b) => b.side === "both");
  if (roles.length === 0) return spec;
  const errorChannels = new Set(roles.map((b) => b.channel));
  const y = spec.zones.y.filter((r) => r.datasetId !== ds.id || !errorChannels.has(r.channel));
  if (y.length === 0) return spec; // only error columns were chosen: leave the user's choice visible
  const yErr: ChannelRef[] = [];
  for (const ref of y) {
    const bound = roles.find((b) => b.axis === "y" && b.target === ref.channel);
    if (!bound || ref.datasetId !== ds.id) break;
    yErr.push({ datasetId: ds.id, channel: bound.channel });
  }
  // The single X-error well: an axis-wide binding, or the one bound to the
  // only Y series (Origin's per-Y X error, lib/originBookRoles.ts).
  const xBound = roles.find((b) => b.axis === "x" && (b.target === -1 || (y.length === 1 && b.target === y[0].channel)));
  const xErr = spec.zones.xErr ?? (xBound ? { datasetId: ds.id, channel: xBound.channel } : null);
  return { ...spec, zones: { ...spec.zones, y, yErr: spec.zones.yErr.length ? spec.zones.yErr : yErr, xErr } };
}
