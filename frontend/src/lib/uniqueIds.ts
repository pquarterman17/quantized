// Re-key repeated plot-object ids on load. Builds before store/idSeq.ts's
// `nextPlotObjectId` restarted each object counter on every page load, so a
// reopened project could gain a second `ann-1`; every edit and delete is keyed
// by id, and one delete then removed both. The first holder keeps its id.

/** `list` with every repeated id re-keyed `<id>~<n>`; `list` itself when all
 *  ids are already unique. */
export function uniqueIds<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  let changed = false;
  const out = list.map((e) => {
    let id = e.id;
    for (let n = 2; seen.has(id); n++) id = `${e.id}~${n}`;
    seen.add(id);
    if (id === e.id) return e;
    changed = true;
    return { ...e, id };
  });
  return changed ? out : list;
}
