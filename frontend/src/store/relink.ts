// P1.7 box 3/4/5: relink-one and relink-folder with a dry-run preview, and
// "changed source, import as a new version". A standalone Zustand store —
// the store/fitYByX.ts / store/toasts.ts precedent — rather than composed
// into useApp.ts: that store sits at its size-ratchet pin
// (architecture.test.ts's STORE_PINS, 2818, zero headroom), and none of
// this panel's own open/preview state needs to round-trip `.dwk`. Mutations
// to `Dataset.source` go through `useApp.getState()` directly (recordHistory
// + set), the same "standalone store, direct useApp.getState() calls" shape
// store/reimport.ts and store/importDatasets.ts already use.
//
// Path matching (`lib/relink.relinkedCandidate`) and the provenance diff
// (`lib/relink.sourceChangeVerdict`) are pure and unit-tested on their own;
// this module is the thin orchestrator: it calls the desktop bridge to
// PROBE each candidate (never guessing a state without one — see below),
// then either commits an atomic batch update (ONE `recordHistory` call, so
// undo restores every relinked dataset's old path in a single step — box 3's
// "commit is atomic + one undo entry") or reports why a row can't commit.
//
// Browser degrade (box 4's "degrade honestly in browser — no bridge means
// source checks are unavailable, say so, never guess"): `hasDesktopShell()`
// gates the whole preview; with no bridge every row reports `"unavailable"`
// rather than a guessed reachability state.
//
// R3 (POST_SPRINT_INDEPENDENT_REVIEW.md, class #196): `commit()` NEVER
// trusts a preview row's own remembered fields (`candidateChecksum` etc.) AS
// THE VERDICT OF RECORD. It looks up the LIVE dataset by id and recomputes
// against ITS recorded checksum/mtime/size, against a fresh probe taken
// right there at commit time, through TWO guards (`lib/relink.ts`'s
// `guardVerdict` — see its own doc for exactly why it exists instead of
// reusing `sourceChangeVerdict` directly inside a guard): one against what's
// RECORDED, one against what PREVIEW ITSELF showed the user. A guard
// "changed" verdict refuses the row unconditionally — even a Preview-time
// "unknown" that was individually escalated — because escalation approves
// "unverifiable", never "verified-different". The Preview guard is the one
// thing anchoring trust for a dataset with NO recorded provenance at all,
// since the recorded-provenance guard has no baseline to catch drift with.
// Both guards are named as SEPARATE reasons in the completion toast
// ("conflicts with recorded provenance" vs "changed since Preview") — they
// fire for different underlying reasons and lumping them together would
// misname a row Preview never had an opinion about. A dataset removed, or
// whose `source` OBJECT no longer matches what the row was computed against
// (not just a path-string match — a same-path project reload or undo swaps
// the object too) fails closed with zero mutation, re-checked BOTH before
// the probe and again, synchronously, immediately before the write, since
// the probe's own await is itself a gap something else can race. Only once
// a row clears every guard does provenance get written, and which fields
// depends on why it's writing (this part uses the STRICT, un-fallen-back
// `sourceChangeVerdict`, never `guardVerdict` — a stat MATCH when the
// checksum is unconfirmable only fails to contradict, it never CONFIRMS,
// so it must never be treated as license to backfill something never
// actually verified): a confirmed "unchanged" row, or a legacy dataset with
// nothing recorded yet (which just cleared the Preview guard above),
// backfills from the fresh probe; an escalated row that DOES have something
// recorded on file (a checksum this session's probe simply couldn't
// reconfirm) keeps that ORIGINAL recorded provenance verbatim — only the
// path moves — rather than fabricating a replacement for the one signal
// that couldn't be confirmed.
//
// KNOWN LIMITATION (code-review F2, investigated — not fixed, see
// POST_SPRINT_INDEPENDENT_REVIEW.md's R3 closure log for the full
// investigation): `desktop_bridge_dialogs.py`'s `probe_source` computes a
// CHECKSUM only for a read-consented path (`is_consented`), and a relink
// CANDIDATE path is never consented — `grantSourceReadPaths`/
// `grant_source_paths` only ever extends consent to paths already in the
// project's server-tracked DECLARED-source set (a snapshot taken once, at
// project-open time), which a not-yet-linked candidate path can never be a
// member of BY DEFINITION. So every probe of a candidate path — at Preview
// and at commit — carries `checksum: null` today, for every dataset,
// always: the CHECKSUM comparison itself is inert in real desktop use — a
// checksum-bearing dataset's Preview-panel verdict is therefore always
// "unknown", never "unchanged" or "changed" via checksum. The guards
// commit() itself runs (`guardVerdict`, above) are NOT equally inert,
// though (final review pass, F1+F2): when the checksum leg is
// unconfirmable they fall back to comparing mtime/size, which never need
// consent — so a size/mtime contradiction still refuses today even though
// a checksum MATCH never gets confirmed. Fixing the checksum comparison
// itself for real would need a genuine new consent gesture for candidate
// paths (the existing native-file-dialog-pick auto-grant precedent,
// `pick_files` -> `grant_paths`, does not extend to a
// programmatically-derived candidate path with no such dialog behind it,
// and the relink panel's old/new root fields are plain text inputs today,
// not a dialog pick) — out of this file's scope; tracked as an open
// follow-up rather than silently claimed as already working.

import { create } from "zustand";

import { grantSourceReadPaths, hasDesktopShell, probeSource } from "../lib/desktopBridge";
import { evaluateCommitProbe, relinkedCandidate, sourceChangeVerdict } from "../lib/relink";
import type { Dataset } from "../lib/types";
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
   *  re-check (`commit()`, below) requires referential equality against
   *  this, not a path-string match: a same-path provenance swap (a project
   *  reload, an undo landing between the probe and the write) replaces the
   *  object even when the path text is identical, and a string compare
   *  would miss that entirely. */
  orig: NonNullable<Dataset["source"]>;
};

export type RelinkRowStatus =
  | "resolved" // candidate exists and is readable
  | "missing"
  | "offline"
  | "permission_denied"
  | "no_candidate" // oldPath isn't under the chosen oldRoot — not this relink's concern
  | "unavailable"; // no desktop bridge — cannot probe at all (honest browser degrade)

export interface RelinkPreviewRow {
  datasetId: string;
  datasetName: string;
  oldPath: string;
  candidatePath: string | null;
  status: RelinkRowStatus;
  /** "changed" rows are EXCLUDED from `commit()` — box 5: a changed source
   *  warns and can be imported as a new version, it is never silently
   *  folded into the existing dataset by a plain relink. "unknown" rows
   *  (P1-2 defect 2) are ALSO excluded from a bulk commit by default — a
   *  recorded checksum that couldn't be freshly confirmed this session
   *  (`lib/relink.sourceChangeVerdict`'s defect-1 fix) must never commit
   *  silently as if verified. `escalated` is the one way past that: an
   *  explicit PER-ROW "use anyway" click (never a global bypass). */
  changeVerdict: "unchanged" | "changed" | "unknown";
  /** Set only by `escalateUnknownRow(datasetId)` — per-row consent to commit an
   *  "unknown" row despite the unresolved checksum. Never true on a row
   *  fresh out of `runPreview`; cleared implicitly whenever a new preview
   *  replaces the row (Preview always resets `preview`). */
  escalated?: boolean;
  candidateChecksum: string | null;
  candidateMtime: number | null;
  candidateSize: number | null;
}

interface RelinkState {
  open: boolean;
  oldRoot: string;
  newRoot: string;
  preview: RelinkPreviewRow[];
  busy: boolean;
  bridgeAvailable: boolean;
  openPanel: (seed?: { oldRoot?: string; newRoot?: string }) => void;
  closePanel: () => void;
  setOldRoot: (v: string) => void;
  setNewRoot: (v: string) => void;
  runPreview: () => Promise<void>;
  commit: () => Promise<void>;
  /** Per-row escalation (box 2/5, P1-2 defect 2c): explicit user consent to
   *  commit ONE "unknown" row despite its unresolved checksum. Never a
   *  global bypass — every other unknown row stays excluded. */
  escalateUnknownRow: (datasetId: string) => void;
  importChangedAsNewVersion: (datasetId: string) => Promise<void>;
}

/** A dataset known (by the type system, not just at runtime) to carry a
 *  real `source` — the narrowed shape `relinkableDatasets` returns. */
export type SourcedDataset = Dataset & { source: NonNullable<Dataset["source"]> };

/** The datasets a relink can possibly act on: every dataset carrying a real
 *  `source.path` (a browser-only import never has one — see
 *  `Dataset.source`'s own doc — and is correctly invisible to relink, there
 *  is nothing to point anywhere). Exported for the view to render an
 *  "N datasets have a source" hint before a root is even chosen. */
export function relinkableDatasets(): SourcedDataset[] {
  return useApp.getState().datasets.filter((d): d is SourcedDataset => Boolean(d.source));
}

export const useRelink = create<RelinkState>((set, get) => ({
  open: false,
  oldRoot: "",
  newRoot: "",
  preview: [],
  busy: false,
  bridgeAvailable: false,

  openPanel: (seed) =>
    set({
      open: true,
      oldRoot: seed?.oldRoot ?? "",
      newRoot: seed?.newRoot ?? "",
      preview: [],
      bridgeAvailable: hasDesktopShell(),
    }),
  closePanel: () => set({ open: false }),
  setOldRoot: (v) => set({ oldRoot: v, preview: [] }),
  setNewRoot: (v) => set({ newRoot: v, preview: [] }),

  runPreview: async () => {
    const { oldRoot, newRoot } = get();
    if (!oldRoot.trim() || !newRoot.trim()) {
      toast("enter both the old and new folder paths", "danger");
      return;
    }
    set({ busy: true });
    try {
      const datasets = relinkableDatasets();
      const bridgeAvailable = hasDesktopShell();
      set({ bridgeAvailable });
      // P1.7 consent ruling (desktop_bridge.py's module doc): these are
      // ALREADY the project's own recorded source paths, not arbitrary
      // picks, so read consent is extended up front — reusing
      // desktop_consent's existing per-path grant store, never a new
      // consent kind — so a checksum can be computed below without a
      // native dialog per file.
      if (bridgeAvailable) {
        await grantSourceReadPaths(datasets.map((d) => d.source.path));
      }
      const rows: RelinkPreviewRow[] = [];
      for (const ds of datasets) {
        const oldPath = ds.source.path;
        const candidate = relinkedCandidate(oldRoot, newRoot, oldPath);
        if (candidate === null) continue; // outside the moved tree entirely
        if (!bridgeAvailable) {
          rows.push({
            datasetId: ds.id,
            datasetName: ds.name,
            oldPath,
            candidatePath: candidate,
            status: "unavailable",
            changeVerdict: "unknown",
            candidateChecksum: null,
            candidateMtime: null,
            candidateSize: null,
          });
          continue;
        }
        const probe = await probeSource(candidate);
        if (probe === null || probe.state !== "ok") {
          const status: RelinkRowStatus =
            probe?.state === "permission_denied"
              ? "permission_denied"
              : probe?.state === "offline"
                ? "offline"
                : "missing";
          rows.push({
            datasetId: ds.id,
            datasetName: ds.name,
            oldPath,
            candidatePath: candidate,
            status,
            changeVerdict: "unknown",
            candidateChecksum: null,
            candidateMtime: null,
            candidateSize: null,
          });
          continue;
        }
        const verdict = sourceChangeVerdict(
          { checksum: ds.source.checksum, mtime: ds.source.mtime, size: ds.source.size },
          { checksum: probe.checksum, mtime: probe.mtime, size: probe.size },
        );
        rows.push({
          datasetId: ds.id,
          datasetName: ds.name,
          oldPath,
          candidatePath: candidate,
          status: "resolved",
          changeVerdict: verdict,
          candidateChecksum: probe.checksum,
          candidateMtime: probe.mtime,
          candidateSize: probe.size,
        });
      }
      set({ preview: rows });
      if (rows.length === 0) {
        toast("no datasets have a source under that folder", "info");
      }
    } finally {
      set({ busy: false });
    }
  },

  commit: async () => {
    const { preview } = get();
    const candidates = preview.filter(
      (r) =>
        r.status === "resolved" &&
        r.candidatePath &&
        r.changeVerdict !== "changed" &&
        // P1-2 defect 2: an "unknown" row commits ONLY once explicitly
        // escalated via `escalateUnknownRow` — a bulk commit never sweeps it in.
        (r.changeVerdict !== "unknown" || r.escalated),
    );
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
      identityChangedAtCommit = 0;
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
      const liveById = new Map(useApp.getState().datasets.map((d) => [d.id, d]));
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
          return [row.datasetId, { source: { kind: "path" as const, path: row.candidatePath!, ...outcome }, orig: src }];
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
    for (const r of preview) {
      if (r.changeVerdict === "changed") skippedChanged++;
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
    useApp.getState().recordHistory(`relink ${n} source${n === 1 ? "" : "s"}`);
    useApp.setState((state) => ({
      datasets: state.datasets.map((d) => {
        const source = pending.get(d.id)?.source;
        if (!source || !d.source) return d;
        return { ...d, source };
      }),
    }));
    toast(`relinked ${n} dataset${n === 1 ? "" : "s"}${joined}`, "ok");
    set({ open: false, preview: [] });
  },

  escalateUnknownRow: (datasetId) =>
    set((s) => ({
      preview: s.preview.map((r) => (r.datasetId === datasetId ? { ...r, escalated: true } : r)),
    })),

  // Box 5: "changed source warns and can import as a NEW VERSION" — reuses
  // the EXISTING import path (never an in-place refresh, per L0.32), then
  // tags the freshly created dataset(s) with `versionOf` so the link back
  // to the original survives.
  //
  // P1-2 defect 3: `importPaths` records ONE history entry PER created
  // dataset (`addDataset` calls `recordHistory` every time it's called —
  // see useApp.ts), and a multi-book Origin source creates several. Left
  // alone, the trailing versionOf `setState` below would ride on whatever
  // entry happened to land last, so Undo only reverted the LAST book and
  // stranded every earlier one's versionOf tag. `withHistoryBatch` collapses
  // the whole thing — import of ALL created datasets + versionOf tagging —
  // into exactly ONE undo step, the same guarantee `commit()` above already
  // has (its own comment: "ONE recordHistory call for the whole batch").
  //
  // R6 (POST_SPRINT_INDEPENDENT_REVIEW.md): the `token` `withHistoryBatch`
  // hands `fn` here is threaded explicitly into `importPaths` (which
  // forwards it to every `addDataset` call it makes) so ONLY the datasets
  // THIS operation creates fold into the one undo entry. Any unrelated edit
  // a user makes while `importPaths`'s own `await`s are in flight (network
  // round trips) calls `recordHistory` with no token at all — per that
  // function's doc, an untokened call ALWAYS records its own independent
  // entry, live-state and all, never absorbed into this batch. See
  // `HistoryBatchToken`'s doc (store/history.ts) for why identity, not a
  // boolean, is what makes that true.
  importChangedAsNewVersion: async (datasetId) => {
    const s = useApp.getState();
    const ds = s.datasets.find((d) => d.id === datasetId);
    if (!ds?.source) return;
    const sourcePath = ds.source.path;
    let created = false;
    await useApp.getState().withHistoryBatch(`import "${ds.name}" as a new version`, async (token) => {
      const before = new Set(useApp.getState().datasets.map((d) => d.id));
      await useApp.getState().importPaths([sourcePath], token);
      const createdIds = useApp
        .getState()
        .datasets.filter((d) => !before.has(d.id))
        .map((d) => d.id);
      if (createdIds.length === 0) return;
      created = true;
      const createdSet = new Set(createdIds);
      useApp.setState((state) => ({
        datasets: state.datasets.map((d) => (createdSet.has(d.id) ? { ...d, versionOf: datasetId } : d)),
      }));
    });
    if (created) toast(`imported "${ds.name}" as a new version`, "ok");
  },
}));
