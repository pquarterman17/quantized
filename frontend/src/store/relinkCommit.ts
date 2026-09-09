// `store/relink.ts`'s `commit()` body — split out under that module's
// 500-line ceiling AND out of the eager bundle: `store/relink.ts` itself is
// eager (store/reimport.ts, lib/openWorkspaceReplace.ts and AppOverlays read
// its open flag), but nothing needs the commit machinery — or lib/relink.ts,
// whose only importers are this file and store/relinkPreview.ts — until the
// user clicks Relink, so the store `import()`s this on the click (the
// `folderOps` precedent in lib/contextActions.ts; see
// scripts/check-bundle-size.mjs's history). Every review ruling the body
// carries (R3/F1–F7/P2, and P1.7 slice 2's collision guard) is documented
// inline below, unchanged from where it lived in the store.

import { probeSource } from "../lib/desktopBridge";
import { plural } from "../lib/plural";
import { evaluateCommitProbe, findCandidateCollisions, isCommittableRow } from "../lib/relink";
import type { Dataset } from "../lib/types";
import type { RelinkState } from "./relink";
import { toast } from "./toasts";
import { useApp } from "./useApp";

// F6 (code-review): the ONE shape a committing row's async pipeline produces,
// named once instead of written out three times (the per-row return type,
// the results-filter type guard, and `pending`'s own declaration). Keyed by
// datasetId via the Map itself (a `[id, write]` tuple), not a redundant
// field inside the value.
type PendingWrite = {
  source: NonNullable<Dataset["source"]>;
  /** F3 (code-review): the EXACT `Dataset.source` OBJECT the write was
   *  computed against — not just its `.path` string. The final pre-write
   *  re-check (below) requires referential equality against this, not a
   *  path-string match: a same-path provenance swap (a project reload, an
   *  undo landing between the probe and the write) replaces the object
   *  even when the path text is identical, and a string compare would miss
   *  that entirely. */
  orig: NonNullable<Dataset["source"]>;
  /** The FRESH commit-time probe's fingerprint (not the provenance being
   *  written, which for an escalated row is the ORIGINAL recorded one) —
   *  what the write-side collision guard below hands
   *  `findCandidateCollisions` as its "is this really one file" oracle. */
  probed: { checksum: string | null; size: number | null };
};

export async function commitRelink(
  get: () => RelinkState,
  set: (partial: Partial<RelinkState>) => void,
  /** The live datasets, snapshotted SYNCHRONOUSLY by `store/relink.ts`'s
   *  `commit` at the click — before this chunk's `import()` resolves — so
   *  the R3 identity guard below measures from the moment the user acted,
   *  never from whenever the network delivered this module. */
  liveById: ReadonlyMap<string, Dataset>,
): Promise<void> {
  const { preview } = get();
  // `isCommittableRow` (lib/relink.ts) is the SAME predicate the panel's
  // Relink count uses — the button and the write can never disagree.
  const candidates = preview.filter(isCommittableRow);
  if (candidates.length === 0) {
    toast("nothing to relink — no resolved, unchanged candidates", "danger");
    return;
  }
  set({ busy: true });
  // F4 (code-review): split apart — a fresh probe can conflict with what
  // is RECORDED (the R3 recompute) or with what PREVIEW ITSELF showed the
  // user (F1's consent guard) for two DIFFERENT reasons; naming them the
  // same bucket claimed a "changed since Preview" verdict for rows Preview
  // never even had an opinion about. `evaluateCommitProbe` (lib/relink.ts)
  // is the pure per-row decision (R3 recompute, F1 guard, F2 backfill
  // rule) shared with its own unit tests; this loop is the thin async
  // orchestrator gathering its inputs and tallying the toast buckets.
  let unreachableAtCommit = 0,
    conflictAtCommit = 0,
    mismatchAtCommit = 0,
    unverifiedAtCommit = 0,
    identityChangedAtCommit = 0,
    collidedAtCommit = 0;
  let pending: Map<string, PendingWrite>;
  try {
    // R3 (POST_SPRINT_INDEPENDENT_REVIEW.md, class #196 — silent
    // provenance overwrite): the preview can go stale between when it ran
    // and when the user clicks Relink in more ways than "the file
    // vanished" — the LIVE dataset backing a row can have been removed,
    // reimported, or independently relinked in that same window. Snapshot
    // it fresh right here (never the copy `preview` closed over) so every
    // row's verdict is recomputed against what is ACTUALLY on record now,
    // never against the preview row's own remembered fields alone.
    // (`liveById` is the caller's click-time snapshot — see the parameter.)
    const results = await Promise.all(
      candidates.map(async (row): Promise<[string, PendingWrite] | null> => {
        const liveDs = liveById.get(row.datasetId);
        // Fail closed, zero mutation: the dataset this row named is gone,
        // or its recorded source has moved on from what Preview saw (an
        // independent relink/reimport landed in the gap) — "identity
        // changed" is not this commit's call to make sense of.
        if (liveDs?.source?.path !== row.oldPath) {
          identityChangedAtCommit++;
          return null;
        }
        // P2 (adversarial review, TOCTOU): a file deleted or overwritten
        // in the Preview-to-commit window must never write a stale
        // checksum silently. Re-probe every committing candidate right
        // here, right before the write.
        const probe = await probeSource(row.candidatePath!);
        if (probe === null || probe.state !== "ok") {
          unreachableAtCommit++;
          return null;
        }
        const src = liveDs.source;
        const outcome = evaluateCommitProbe(src, probe, row, row.escalated);
        if (outcome === "conflict") {
          conflictAtCommit++;
          return null;
        }
        if (outcome === "mismatch") {
          mismatchAtCommit++;
          return null;
        }
        if (outcome === "gap") {
          unverifiedAtCommit++;
          return null;
        }
        return [
          row.datasetId,
          {
            source: { kind: "path" as const, path: row.candidatePath!, ...outcome },
            orig: src,
            probed: { checksum: probe.checksum, size: probe.size },
          },
        ];
      }),
    );
    pending = new Map(results.flatMap((r) => (r ? [r] : [])));
  } finally {
    set({ busy: false });
  }
  // F3 (code-review, residual TOCTOU + STRENGTHENED): `liveById` above was
  // read BEFORE the awaited probes — a dataset's recorded source can
  // still have been swapped out from under a row during that async gap (a
  // reimport or a second relink landing mid-commit). Re-verify identity
  // one more time, synchronously, immediately before the actual write —
  // nothing async runs between this read and the `setState` below, so
  // this check and the write are effectively atomic. Compares OBJECT
  // IDENTITY against `orig` (the exact `source` the write was
  // computed against), not a path string: a same-path swap — a project
  // reload or an undo landing in the gap, reconstructing an
  // equal-looking but structurally different `source` object — changes
  // nothing a string comparison would ever see.
  // F7 (code-review): one Map built once (the `liveById` pattern above),
  // not a `.find()` scan of every live dataset per pending row.
  const nowById = new Map(useApp.getState().datasets.map((d) => [d.id, d]));
  for (const [id, entry] of pending) {
    if (nowById.get(id)?.source !== entry.orig) {
      pending.delete(id);
      identityChangedAtCommit++;
    }
  }
  // P1.7 slice 2, the write-side guard: whatever the preview's per-row
  // flags say, no two writes in THIS batch may land distinct recorded
  // sources on one destination. Fail closed for the whole contested
  // group (never pick a winner here) — the preview filter above is the
  // UI contract, this is the invariant that holds even if state was
  // edited underneath it.
  const collided = findCandidateCollisions(
    [...pending].map(([id, e]) => ({
      datasetId: id,
      oldPath: e.orig.path,
      candidatePath: e.source.path,
      candidateChecksum: e.probed.checksum,
      candidateSize: e.probed.size,
    })),
  );
  for (const id of collided.keys()) {
    pending.delete(id);
    collidedAtCommit++;
  }
  // F5 (code-review, actionable-advice split): the panel's "Use anyway"
  // escalate control (RelinkPanel.tsx) renders ONLY for a row Preview
  // itself showed as `status === "resolved"` AND `changeVerdict ===
  // "unknown"` — a row that never got that far (missing/offline/
  // permission_denied/unavailable) never had a checksum question to
  // escalate at all, and already has its own clear status label in the
  // panel from Preview — commit()'s summary says nothing new about it
  // rather than repeat wrong "escalate" advice for a button it never had.
  // `escalatable` rows genuinely have the button now; `unverifiedAtCommit`
  // rows looked "unchanged" at Preview (no button ever appeared) and would
  // need a FRESH Preview pass before one could. One pass over `preview`
  // computes both this and `skippedChanged`.
  let skippedChanged = 0;
  let escalatable = 0;
  let collisionUnresolved = 0;
  let collisionSkipped = 0;
  for (const r of preview) {
    if (r.collision && !r.collision.resolution) collisionUnresolved++;
    else if (r.collision?.resolution === "skip") collisionSkipped++;
    else if (r.changeVerdict === "changed") skippedChanged++;
    else if (r.status === "resolved" && r.changeVerdict === "unknown" && !r.escalated) escalatable++;
  }
  // F4 (code-review, honest wording) + F3 (final review pass, doc-promise
  // audit): each bucket names the SPECIFIC thing that happened to it, in
  // words a reader (not just the source) can follow — "unreachable"
  // (probe failed) is not "changed" (content differs), and neither of
  // those is "conflicts with recorded provenance" (the RECORDED
  // checksum/mtime/size itself, `conflictAtCommit`) or "changed since
  // Preview" (what PREVIEW showed, `mismatchAtCommit`) or "moved/
  // reimported" (identity itself moved on, `identityChangedAtCommit`).
  // These EXACT strings are the ones this module's header doc and the
  // POST_SPRINT_INDEPENDENT_REVIEW.md closure log quote — keep them in
  // sync if either changes. Built once and reused for BOTH the
  // empty-commit and partial-commit toasts.
  const notes = (
    [
      [skippedChanged, "changed (import as a new version instead)"],
      [escalatable, "needs verification — use \"use anyway\" to include"],
      [unverifiedAtCommit, "could not be re-verified"],
      [conflictAtCommit, "conflicts with recorded provenance"],
      [mismatchAtCommit, "changed since Preview"],
      [identityChangedAtCommit, "moved/reimported"],
      [unreachableAtCommit, "unreachable"],
      [collisionUnresolved, "share a destination (choose one per file to include)"],
      [collisionSkipped, "skipped (another dataset keeps the file)"],
      [collidedAtCommit, "would collide on one destination"],
    ] as const
  ).flatMap(([n, label]) => (n > 0 ? [`${n} ${label}`] : []));
  const joined = notes.length > 0 ? ` — ${notes.join("; ")}` : "";
  const n = pending.size;
  if (n === 0) {
    toast(`nothing to relink${joined || " — no resolved, unchanged candidates"}`, "danger");
    return;
  }
  // ONE recordHistory call for the whole batch — undo restores every
  // relinked dataset's old path in a single step (box 3).
  useApp.getState().recordHistory(`relink ${n} source${plural(n)}`);
  useApp.setState((state) => ({
    datasets: state.datasets.map((d) => {
      const source = pending.get(d.id)?.source;
      if (!source || !d.source) return d;
      return { ...d, source };
    }),
  }));
  toast(`relinked ${n} dataset${plural(n)}${joined}`, "ok");
  get().closePanel(); // also revokes the C1 directory grant, if any
  set({ preview: [] });
}
