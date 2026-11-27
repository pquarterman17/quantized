// Subset links, store half (ROW_RANGE_CONTRACT section 4; the pure half is lib/sourceRowLink.ts): install the
// identities a new subset points at, and Go to Source. Lazy: reached from Extract's commit and the worksheet
// menu only.

import { readSourceRowLink, resolveSourceRows, goToSourceStatus } from "../lib/sourceRowLink";
import { FIT_ROW_IDENTITIES } from "../lib/rowSidecars";
import { resolvePendingEdit } from "./pendingEdit";
import { useApp } from "./useApp";
import { openWorksheet } from "./worksheetOpen";

/** Add the identity record `metadata` carries to worksheet `id` (its `data`, and the pre-correction copy when it has
 *  the same rows, as `setFitSpec` does). Identities carry no data, so this is not an undo step of its own. */
export function installSourceIdentities(id: string, metadata: Record<string, unknown>): void {
  const record = metadata[FIT_ROW_IDENTITIES];
  const ds = useApp.getState().datasets.find((d) => d.id === id);
  if (!record || !ds) return;
  // A still-loading sheet has its `data` replaced when the fetch lands: wait for it (Extract itself refuses one).
  if (resolvePendingEdit(useApp.getState, ds, "linking a subset", () => installSourceIdentities(id, metadata))) return;
  useApp.setState((s) => ({
    datasets: s.datasets.map((d) => {
      if (d.id !== id) return d;
      const raw = d.raw && d.raw.time.length === d.data.time.length
        ? { ...d.raw, metadata: { ...d.raw.metadata, [FIT_ROW_IDENTITIES]: record } }
        : d.raw;
      return { ...d, data: { ...d.data, metadata: { ...d.data.metadata, [FIT_ROW_IDENTITIES]: record } }, ...(raw !== d.raw ? { raw } : {}) };
    }),
  }));
}

/** Open the worksheet a subset was made from with exactly its rows selected. Says so, and selects nothing, when the
 *  subset has no link, the source is gone or still loading, or none of the rows exist any more. */
export function goToSourceRows(childId: string): boolean {
  const s = useApp.getState();
  const refuse = (why: string): false => {
    s.setStatus(`Go to Source: ${why}`, "danger");
    return false;
  };
  const child = s.datasets.find((d) => d.id === childId);
  const link = readSourceRowLink(child?.data.metadata);
  if (!child || !link) return refuse("this worksheet has no row link to a source");
  const source = s.datasets.find((d) => d.id === link.source);
  if (!source) return refuse("the source worksheet no longer exists; nothing was selected");
  if (source.pending) {
    openWorksheet({ datasetId: source.id }); // loads it
    return refuse(`“${source.name}” is still loading; run Go to Source again in a moment`);
  }
  const resolved = resolveSourceRows(link, source);
  const { text, tone } = goToSourceStatus(resolved, source.name);
  if (resolved.rows.length) openWorksheet({ datasetId: source.id, rowIds: resolved.rows });
  s.setStatus(text, tone);
  return resolved.rows.length > 0;
}
