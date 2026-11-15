// The `.dwk` figure-doc sanitizer (MAIN #12 back-compat; BUG-016 round 4),
// moved verbatim out of lib/figuredoc.ts in bundle diet slice 27
// (plans/BUNDLE_HEADROOM.md). Only the lazy `.dwk` read (lib/workspace.ts)
// calls it, so it ships in that chunk rather than the startup one; the types
// and the graph templates stay in lib/figuredoc.ts.

import type { FigureConfig, FigureDoc } from "./figuredoc";
import { decodeCell } from "./nonFiniteCells";
import { isAxisScale, scaleFromLog } from "./plotview";
import { sanitizeExportSeriesStyles } from "./publicationStyles";
import type { DataStruct } from "./types";

/** Validate + migrate a persisted `FigureConfig` (MAIN #12 back-compat): a
 *  pre-#12 doc carries `xLog`/`yLog` booleans instead of `xScale`/`yScale` —
 *  bridged via `scaleFromLog` so an old `.dwk`'s figure docs keep working
 *  rather than silently dropping. Returns null when the object isn't
 *  recognizably a config at all (style/fmt/title missing, or NEITHER the new
 *  nor the old axis-scale shape is present). */
function migrateConfig(v: unknown): FigureConfig | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.style !== "string" || typeof o.fmt !== "string" || typeof o.title !== "string") {
    return null;
  }
  const xScale = isAxisScale(o.xScale) ? o.xScale : typeof o.xLog === "boolean" ? scaleFromLog(o.xLog) : null;
  const yScale = isAxisScale(o.yScale) ? o.yScale : typeof o.yLog === "boolean" ? scaleFromLog(o.yLog) : null;
  if (xScale === null || yScale === null) return null;
  // BUG-016 round 4: `config.seriesStyles` used to be spread VERBATIM out of
  // the persisted JSON — this path never ran the app's own validator for that
  // shape, so a `.dwk` was the one FigureDoc source whose publication styles
  // reached the export wire unchecked. Review F3 measured the two ends of
  // that: `colorDerived: "no"` (truthy) dropped a colour the user CHOSE from a
  // grouped export, and `colorDerived: null` (falsy) shipped a derived one —
  // round 1's regression. Running it through the same sanitizer
  // `figureDocument`/`nameKeyedRecipes` use closes that, and that is ALL it
  // does for provenance (round 5): a malformed flag is dropped, an absent one
  // stays absent, and nothing is inferred from the live palette — so a `.dwk`
  // loads the same under every theme, and re-saving it can neither gain nor
  // freeze a guess. `undefined` (a config saved before the field existed)
  // stays `undefined`.
  const seriesStyles =
    o.seriesStyles === undefined ? undefined : sanitizeExportSeriesStyles(o.seriesStyles);
  return {
    ...(o as unknown as FigureConfig),
    xScale,
    yScale,
    ...(seriesStyles === undefined ? {} : { seriesStyles }),
  };
}

/** Validate persisted figure docs (drop malformed; clamp dead dataset refs —
 *  a live doc whose dataset vanished stays listed but renders disabled). */
export function sanitizeFigureDocs(v: unknown, dsIds: ReadonlySet<string>): FigureDoc[] {
  if (!Array.isArray(v)) return [];
  const out: FigureDoc[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    const config = migrateConfig(o.config);
    if (typeof o.id !== "string" || typeof o.name !== "string" || !config) continue;
    const datasetId =
      typeof o.datasetId === "string" && dsIds.has(o.datasetId) ? o.datasetId : null;
    const doc: FigureDoc = {
      id: o.id,
      name: o.name,
      datasetId,
      config,
      live: o.live !== false,
    };
    if (!doc.live && typeof o.dataSnapshot === "object" && o.dataSnapshot !== null) {
      doc.dataSnapshot = decodeSnapshotCells(o.dataSnapshot as DataStruct);
    }
    out.push(doc);
  }
  return out;
}

/** The save boundary (`encodePersistedCells`) writes NaN/±Infinity/-0 in a
 *  frozen snapshot as sentinel strings, and a pre-sentinel file wrote NaN as
 *  `null`. Read both back as numbers, the contract `figureDocument.ts`'s frozen
 *  snapshot already keeps; anything else is left exactly as it was read. */
function decodeSnapshotCells(snap: DataStruct): DataStruct {
  const row = (cells: unknown): unknown =>
    Array.isArray(cells) ? cells.map((c) => (c === null ? Number.NaN : (decodeCell(c) ?? c))) : cells;
  return {
    ...snap,
    time: row(snap.time) as number[],
    values: (Array.isArray(snap.values) ? snap.values.map(row) : snap.values) as number[][],
  };
}
