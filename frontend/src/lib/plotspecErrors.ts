// Error-column wells (ORIGIN_GAP_PLAN #51 phase 3 — "any XY mark can carry
// error bars", the COLUMN-DESIGNATION model rather than error-bars-as-plot-
// types): `yErr`/`xErr` are POSITION-paired with `y`, not channel-keyed — the
// simple shape the wells UI drags into. Two pure helpers bridge that to the
// canonical `lib/errorRoles.ErrorBinding` contract the interactive Stage
// (`Dataset.errorRoles`), `.dwk`, and publication export already speak.
//
// Moved verbatim out of `lib/plotspec.ts` (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4,
// the Color/Symbol/Label encoding slice): that module is on a shrink-only
// `architecture.test.ts` pin, and the three new encoding zones had to be paid
// for. `plotspec.ts` re-exports both names, so no importer changed; the import
// back into it is type-only, so there is no runtime cycle.

import { inferErrorBindings, type ErrorBinding } from "./errorRoles";
import type { ChannelRef, PlotSpec } from "./plotspec";
import type { DataStruct } from "./types";

/** Wells -> `ErrorBinding[]`, position-paired: `yErr[i]` describes `y[i]`
 *  (only up to `min(y.length, yErr.length)` pairs — a stale/out-of-sync
 *  wells state never invents a pairing beyond what's actually aligned).
 *  `xErr` binds to the x axis (`target: -1`, the same sentinel
 *  `lib/errorRoles` uses elsewhere). Every binding is symmetric
 *  (`side: "both"`) — the simple wells model has no +/- half, unlike the
 *  Inspector's richer Error columns card. XY-family only by convention: a
 *  categorical mark's `zones.yErr`/`xErr` are validated like any other zone
 *  content but callers never read this for box/violin/bar (see
 *  useGraphBuilder's `commitToPlot` and `specToRender`'s xy branch). */
export function specErrorBindings(spec: PlotSpec): ErrorBinding[] {
  const { y, yErr, xErr } = spec.zones;
  const out: ErrorBinding[] = [];
  const n = Math.min(y.length, yErr.length);
  for (let i = 0; i < n; i++) {
    out.push({ channel: yErr[i].channel, target: y[i].channel, axis: "y", side: "both" });
  }
  if (xErr) out.push({ channel: xErr.channel, target: -1, axis: "x", side: "both" });
  return out;
}

/** Seed `zones.yErr`/`zones.xErr` from the dataset's own name-based inference
 *  (`lib/errorRoles.inferErrorBindings`) — Origin's zero-click experience:
 *  drop a Y with no explicit error assignment and the matching error column
 *  (if any) fills in for free. Only SYMMETRIC inferred bindings project (the
 *  wells have no +/- half). The y-error prefix stops at the first Y channel
 *  with no unambiguous inferred error, since position-pairing has no way to
 *  represent a gap (an errorless Y followed by one that has an error) — this
 *  IS the "only prefill when unambiguous" rule, not a separate check. Pure:
 *  takes the live dataset's data in, never reads the store — the caller
 *  (useGraphBuilder) owns deciding WHEN to call this (never once the user has
 *  touched the error wells themselves). */
export function prefillErrorZones(spec: PlotSpec, data: DataStruct, datasetId: string): PlotSpec {
  const inferred = inferErrorBindings(data).filter((b) => b.side === "both");
  const yErr: ChannelRef[] = [];
  for (const yRef of spec.zones.y) {
    const match = inferred.find((b) => b.axis === "y" && b.target === yRef.channel);
    if (!match) break;
    yErr.push({ datasetId, channel: match.channel });
  }
  const xMatch = inferred.find((b) => b.axis === "x" && b.target === -1);
  return {
    ...spec,
    zones: { ...spec.zones, yErr, xErr: xMatch ? { datasetId, channel: xMatch.channel } : null },
  };
}
