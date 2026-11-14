// The persisted half of a live graph's curve list (lib/linkedCurves.ts): the
// type, the .dwk sanitizer, the merge-time id remap and the column remaps a
// source's column edit or re-import applies. Its own module with no
// runtime imports, so the workspace read/merge paths can use it without
// pulling the graph builder in.

export interface LinkedCurve {
  datasetId: string;
  /** X column in the source; null = the Y column's own X. */
  xKey: number | null;
  /** Y column in the source; -1 = a curve that can never resolve (drawn empty). */
  yKey: number;
  /** The user's legend text; absent = follow the source's name. */
  label?: string;
}

/** A source id that matches no dataset (an unmapped .dwk merge). */
export const UNRESOLVED_SOURCE = "";

/** Re-type a persisted list. A malformed entry keeps its SLOT as an
 *  unresolvable curve (review finding 9): dropping it would shift every later
 *  curve onto another curve's style, rename and visibility. */
export function sanitizeLinkedCurves(v: unknown): LinkedCurve[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((e): LinkedCurve => {
    const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    const ok = typeof o.datasetId === "string" && Number.isInteger(o.yKey) && (o.yKey as number) >= 0;
    const xOk = o.xKey === null || o.xKey === undefined || (Number.isInteger(o.xKey) && (o.xKey as number) >= 0);
    return {
      datasetId: typeof o.datasetId === "string" ? o.datasetId : UNRESOLVED_SOURCE,
      xKey: xOk && typeof o.xKey === "number" ? o.xKey : null,
      yKey: ok && xOk ? (o.yKey as number) : -1,
      ...(typeof o.label === "string" && o.label ? { label: o.label } : {}),
    };
  });
}

/** Re-point each curve's source through `idMap` (a merged .dwk's fresh ids);
 *  an unmapped source becomes unresolvable (review finding 2). */
export function remapCurveSources(curves: readonly LinkedCurve[], idMap: ReadonlyMap<string, string>): LinkedCurve[] {
  return curves.map((c) => ({ ...c, datasetId: idMap.get(c.datasetId) ?? UNRESOLVED_SOURCE }));
}

/** Follow a column insert/delete/move on `sourceId`: `remap` gives each old
 *  column's new index, or -1 when it was deleted -- then the curve is dead
 *  (a deleted X too: it is never re-pointed at another X). */
export function remapCurveColumns(
  curves: readonly LinkedCurve[],
  sourceId: string,
  remap: (col: number) => number,
): LinkedCurve[] {
  return curves.map((c) => {
    if (c.datasetId !== sourceId || c.yKey < 0) return c;
    const y = remap(c.yKey);
    const x = c.xKey === null ? null : remap(c.xKey);
    return { ...c, yKey: y < 0 || (x !== null && x < 0) ? -1 : y, xKey: x !== null && x < 0 ? null : x };
  });
}

/** Re-find `sourceId`'s curves by column LABEL after its columns changed (a
 *  re-import, review finding 4). A label missing, or no longer unique, kills
 *  the curve rather than guessing. */
export function relabelCurveColumns(
  curves: readonly LinkedCurve[],
  sourceId: string,
  oldLabels: readonly string[],
  newLabels: readonly string[],
): LinkedCurve[] {
  const find = (col: number): number => {
    const label = oldLabels[col];
    const first = newLabels.indexOf(label);
    return label === undefined || first < 0 || newLabels.indexOf(label, first + 1) >= 0 ? -1 : first;
  };
  return remapCurveColumns(curves, sourceId, find);
}
