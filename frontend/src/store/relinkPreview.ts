// The per-dataset row computation behind `store/relink.ts`'s `runPreview` —
// split out under that module's 500-line ceiling (the same extraction
// precedent as store/relinkBrowse.ts) when P1.7 slice 2's collision
// annotation landed. Pure over its inputs apart from the bridge probes;
// the store stays the thin orchestrator (busy state, consent grant, the
// empty-preview toast).

import { probeSource } from "../lib/desktopBridge";
import { findCandidateCollisions, relinkedCandidate, sourceChangeVerdict } from "../lib/relink";
import type { RelinkPreviewRow, RelinkRowStatus, SourcedDataset } from "./relink";

/** One preview row per dataset whose recorded source sits under `oldRoot`
 *  (anything outside the moved tree is skipped, not guessed at), probed
 *  through the bridge when one is available and reported `unavailable`
 *  otherwise — then annotated with any destination collision (P1.7
 *  slice 2): rows whose candidates name ONE file from DIFFERENT recorded
 *  sources carry `collision.others` and start unresolved, so `commit()`
 *  never folds two datasets onto one path without an explicit choice. */
export async function buildPreviewRows(
  datasets: readonly SourcedDataset[],
  oldRoot: string,
  newRoot: string,
  bridgeAvailable: boolean,
): Promise<RelinkPreviewRow[]> {
  const rows: RelinkPreviewRow[] = [];
  for (const ds of datasets) {
    const oldPath = ds.source.path;
    const candidate = relinkedCandidate(oldRoot, newRoot, oldPath);
    if (candidate === null) continue; // outside the moved tree entirely
    const base = { datasetId: ds.id, datasetName: ds.name, oldPath, candidatePath: candidate };
    const unprobed = { changeVerdict: "unknown" as const, candidateChecksum: null, candidateMtime: null, candidateSize: null };
    if (!bridgeAvailable) {
      rows.push({ ...base, status: "unavailable", ...unprobed });
      continue;
    }
    const probe = await probeSource(candidate);
    if (probe === null || probe.state !== "ok") {
      const status: RelinkRowStatus =
        probe?.state === "permission_denied" ? "permission_denied" : probe?.state === "offline" ? "offline" : "missing";
      rows.push({ ...base, status, ...unprobed });
      continue;
    }
    const verdict = sourceChangeVerdict(
      { checksum: ds.source.checksum, mtime: ds.source.mtime, size: ds.source.size },
      { checksum: probe.checksum, mtime: probe.mtime, size: probe.size },
    );
    rows.push({
      ...base,
      status: "resolved",
      changeVerdict: verdict,
      candidateChecksum: probe.checksum,
      candidateMtime: probe.mtime,
      candidateSize: probe.size,
    });
  }
  // Only a row that COULD commit contests a destination: a missing/offline/
  // permission-denied/unavailable row can never be written, so asking the
  // user to choose between it and a resolved one would be a choice about
  // nothing — and its own status label already says what is wrong with it.
  const collisions = findCandidateCollisions(rows.filter((r) => r.status === "resolved"));
  if (collisions.size === 0) return rows;
  const nameOf = new Map(rows.map((r) => [r.datasetId, r.datasetName]));
  return rows.map((r) => {
    const others = collisions.get(r.datasetId);
    return others ? { ...r, collision: { others: others.map((id) => nameOf.get(id) ?? id), otherIds: others } } : r;
  });
}
