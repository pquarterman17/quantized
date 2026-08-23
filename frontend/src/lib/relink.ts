// Cross-platform source-path matching + provenance-diff (P1.7 box 3/4):
// the pure arithmetic behind relink-one and relink-folder's dry-run preview.
//
// A moved folder tree is the headline case (P1.7's own "cross-platform
// folder-tree relinking passes" checklist item), and the two sides of a
// relink can legitimately come from DIFFERENT operating systems — a project
// imported from a mounted Windows share, reopened after the same folder
// moved to a Mac's local disk, say. So none of the matching below assumes
// the running app's OWN platform's separator or case convention; it only
// ever looks at the STRINGS it's given. Path *I/O* (does a candidate
// actually exist, and does its content match?) is the desktop bridge's job
// (desktopBridge.ts's `probeSource`) — this module never touches a
// filesystem, which is what makes it unit-testable for both win/posix
// shapes on any host.

/** Split a path into its components, tolerant of EITHER separator
 *  regardless of which platform produced it. Drops empty segments (a
 *  leading root/UNC slash, a trailing slash, a doubled separator) so
 *  `/a/b/` and `a/b` compare equal. */
function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

/** Case-insensitive segment compare. Windows volumes are case-insensitive by
 *  default and so is macOS's default (APFS/HFS+) volume; a folder rename
 *  that only changes case is exactly the kind of harmless drift a relink
 *  should still match. This is deliberately the ONE tolerant rule applied
 *  everywhere in this module — never used for anything that writes bytes,
 *  only for "does this candidate correspond to that recorded path". */
function sameSegment(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Is `path` located under `root` (segment-wise, case-insensitive, either
 *  separator)? Returns the REMAINING segments below `root` when so — e.g.
 *  `suffixUnderRoot("C:\\data", "C:\\data\\run1\\a.csv")` ->
 *  `["run1", "a.csv"]` — or `null` when `path` is not under `root` at all
 *  (a dataset outside the moved tree; relink-folder leaves it untouched). */
export function suffixUnderRoot(root: string, path: string): string[] | null {
  const r = segments(root);
  const p = segments(path);
  if (r.length === 0 || p.length < r.length) return null;
  for (let i = 0; i < r.length; i++) {
    if (!sameSegment(r[i], p[i])) return null;
  }
  return p.slice(r.length);
}

/** Which separator `root` itself uses, so a relinked candidate reads
 *  naturally in ITS OWN convention rather than inheriting the old root's.
 *  A backslash anywhere (and no forward slash) reads as Windows; anything
 *  else — including a bare drive/UNC root with no separator visible yet —
 *  defaults to `/`, the more common case (posix roots, and a drive-letter
 *  root typed as `C:/data`). */
function separatorFor(root: string): string {
  const backslash = String.fromCharCode(92);
  return root.includes(backslash) && !root.includes("/") ? backslash : "/";
}

/** Join `newRoot` + `suffix` using `newRoot`'s own separator convention. */
export function joinUnderRoot(newRoot: string, suffix: string[]): string {
  const sep = separatorFor(newRoot);
  const base = newRoot.replace(/[\\/]+$/, "");
  return [base, ...suffix].join(sep);
}

/** The ONE relink computation relink-one (a single dataset) and
 *  relink-folder (every dataset under a moved tree) share: the candidate
 *  new path for `oldPath`, given the chosen `oldRoot` -> `newRoot` remap.
 *  `null` when `oldPath` isn't under `oldRoot` — not this relink's concern,
 *  left alone rather than guessed at. */
export function relinkedCandidate(oldRoot: string, newRoot: string, oldPath: string): string | null {
  const suffix = suffixUnderRoot(oldRoot, oldPath);
  if (suffix === null) return null;
  return joinUnderRoot(newRoot, suffix);
}

// ── provenance diff (P1.7 box 4/5: "changed") ──────────────────────────

export interface RecordedProvenance {
  checksum?: string;
  mtime?: number;
  size?: number;
}

export interface ProbedProvenance {
  checksum?: string | null;
  mtime?: number | null;
  size?: number | null;
}

export type SourceChangeVerdict = "unchanged" | "changed" | "unknown";

/** Shared by `sourceChangeVerdict` and `guardVerdict` (below) — the
 *  size/mtime-only comparison both fall back to once checksum comparison is
 *  off the table, for whatever reason each function has for putting it
 *  there. Never called directly: callers decide WHEN this fallback applies,
 *  which is exactly the one thing that differs between the two. */
function statVerdict(recorded: RecordedProvenance, probed: ProbedProvenance): SourceChangeVerdict {
  const haveSize = recorded.size !== undefined && probed.size != null;
  const haveMtime = recorded.mtime !== undefined && probed.mtime != null;
  if (!haveSize && !haveMtime) return "unknown";
  if (haveSize && recorded.size !== probed.size) return "changed";
  if (haveMtime && recorded.mtime !== probed.mtime) return "changed";
  return "unchanged";
}

/** Did the SOURCE FILE's content change since it was imported or last
 *  relinked? Checksum is authoritative whenever a checksum was RECORDED —
 *  content identity, not a proxy for it. Falls back to comparing size and
 *  mtime only when no checksum was ever recorded (a dataset imported before
 *  this slice, or a browser import that never had bridge access to compute
 *  one) — that is the legitimate degraded mode. Reports `"unknown"` —
 *  NEVER `"unchanged"` or `"changed"` — when there simply isn't enough
 *  information to say anything at all: a browser-imported dataset with no
 *  recorded provenance must never be silently reported as fine just because
 *  nothing contradicts it, AND (P1-2 defect 1) a RECORDED checksum whose
 *  fresh probe came back unavailable — content-read consent lapsed this
 *  session, desktopBridge.ts's `SourceProbe.checksum` doc — must never
 *  silently fall through to size/mtime: that would answer with a WEAKER
 *  signal than the one actually on record, which is worse than admitting
 *  the question can't be answered right now. (This is the DISPLAY verdict —
 *  `runPreview` calls this directly. A commit-time REFUSAL guard has a
 *  different job and calls `guardVerdict` instead — see its own doc.) */
export function sourceChangeVerdict(
  recorded: RecordedProvenance,
  probed: ProbedProvenance,
): SourceChangeVerdict {
  if (recorded.checksum) {
    // A checksum was recorded: it is the ONLY signal trusted from here on,
    // never demoted to size/mtime just because the fresh probe couldn't
    // compute one this session.
    if (!probed.checksum) return "unknown";
    return recorded.checksum === probed.checksum ? "unchanged" : "changed";
  }
  return statVerdict(recorded, probed);
}

/** The guard-only counterpart to `sourceChangeVerdict` (POST_SPRINT_
 *  INDEPENDENT_REVIEW.md R3's final review pass, F1+F2): `sourceChangeVerdict`
 *  deliberately never demotes a RECORDED checksum to size/mtime just because
 *  a fresh probe couldn't compute one — correct for the verdict SHOWN in the
 *  Preview panel, where "unknown" must stay honestly "unknown" rather than
 *  borrow a weaker signal's confidence. But a commit-time REFUSAL guard has
 *  a different job: it only ever needs to answer "is there a decisive reason
 *  to refuse?", and size/mtime disagreeing IS one, even when the checksum
 *  comparison itself is unconfirmable. Reusing `sourceChangeVerdict` inside
 *  the guards let two real corruptions through: (a) recorded {checksum:A,
 *  mtime:10, size:10} vs a fresh probe of {checksum:null, mtime:5, size:5}
 *  verified NOTHING (checksum priority swallowed the checksum-less probe
 *  into "unknown") and an escalated row committed size-10 provenance for a
 *  file observably 5 bytes; (b) a Preview snapshot of {checksum:X, mtime:1,
 *  size:1} against a fresh {checksum:null, mtime:999, size:999} passed the
 *  consent guard for the same reason — a swapped file with no checksum
 *  confirmation on either side.
 *
 *  `guardVerdict` computes checksum-vs-checksum ONLY when BOTH sides
 *  actually have one; otherwise it falls back to the stat comparison
 *  (identical to `sourceChangeVerdict`'s own fallback branch) rather than
 *  reporting "unknown" — a stat-level "changed" here is still a genuine,
 *  actionable contradiction. It reports "unknown" only when NEITHER level
 *  is comparable (no checksum on both sides, no size, no mtime) — the
 *  guards then correctly let the row through as escalatable-but-unverified
 *  (`sourceChangeVerdict`, unchanged by this, still owns THAT distinction).
 *  Never used for anything DISPLAYED — `runPreview` keeps calling
 *  `sourceChangeVerdict` directly. */
export function guardVerdict(recorded: RecordedProvenance, probed: ProbedProvenance): SourceChangeVerdict {
  if (recorded.checksum && probed.checksum) {
    return recorded.checksum === probed.checksum ? "unchanged" : "changed";
  }
  return statVerdict(recorded, probed);
}

// ── commit-time verdict (POST_SPRINT_INDEPENDENT_REVIEW.md R3 + its
// code-review round) ────────────────────────────────────────────────────

/** What Preview ITSELF showed the user for a row (F1's consent guard) —
 *  the exact 3 fields `RelinkPreviewRow` (store/relink.ts) already carries,
 *  so a preview row can be passed straight through with no remapping.
 *  `candidateChecksum` is often `null` (a checksum-recorded dataset's
 *  Preview-time probe simply couldn't confirm one), but
 *  `candidateMtime`/`candidateSize` are always real stats — no read consent
 *  needed for those — so a checksum-less preview still gets stat-level
 *  verification. */
export interface PreviewSnapshot {
  candidateChecksum: string | null;
  candidateMtime: number | null;
  candidateSize: number | null;
}

/** A refusal names WHY (`store/relink.ts` tallies each into its own toast
 *  bucket); anything else IS the provenance object to write — the caller
 *  distinguishes the two with a plain `typeof outcome === "string"` (no
 *  wrapper object needed for either case).
 *  - `"conflict"`: the fresh probe conflicts with the RECORDED
 *    checksum/mtime/size — the R3 defect fix's flagship refusal.
 *    Unconditional: escalation approves "unverifiable", never
 *    "verified-different".
 *  - `"mismatch"`: independent of what is/isn't recorded, the fresh
 *    probe no longer matches what PREVIEW ITSELF showed the user (F1) — the
 *    one guard a dataset with NO recorded provenance at all still has.
 *  - `"gap"`: recorded-vs-fresh is genuinely "unknown" (unverified) and this
 *    row was never escalated — excluded from a bulk commit exactly like any
 *    other unescalated "unknown" row.
 *  - a provenance object: every guard cleared, narrowed to only the fields
 *    actually confirmed (F2: backfilled from the fresh probe for
 *    "unchanged" or a legacy dataset with nothing recorded; preserved
 *    verbatim from `recorded` otherwise — R3 #3). */
export type CommitRowOutcome =
  | "conflict"
  | "mismatch"
  | "gap"
  | { checksum?: string; mtime?: number; size?: number };

/** The pure per-row decision `store/relink.ts`'s `commit()` applies to
 *  every committing candidate, once its fresh probe succeeds — kept here,
 *  not inline in the store, so it's unit-testable without a store/mock
 *  bridge (this module's own header doc: "pure and unit-tested on their
 *  own"). The store stays the thin async orchestrator: gather the inputs
 *  (a fresh probe, the live dataset), call this, apply the result.
 *  Positional, not an options object — `preview` takes a `RelinkPreviewRow`
 *  (or anything shaped like one) directly, no call-site remapping. */
export function evaluateCommitProbe(
  recorded: RecordedProvenance,
  probe: ProbedProvenance,
  preview: PreviewSnapshot,
  escalated: boolean | undefined,
): CommitRowOutcome {
  // Final review pass (F1+F2): both guards below use `guardVerdict`, not
  // `sourceChangeVerdict` directly — see that function's own doc for why.
  // `guardVerdict(recorded, probe) === "changed"` is a strict SUPERSET of
  // `sourceChangeVerdict(recorded, probe) === "changed"` (identical whenever
  // both sides have a checksum; a decisive stat-level answer, never a
  // silent "unchanged", whenever they don't) — so this one call is the
  // complete recorded-provenance refusal check.
  if (guardVerdict(recorded, probe) === "changed") return "conflict";
  const previewGuard = {
    checksum: preview.candidateChecksum ?? undefined,
    mtime: preview.candidateMtime ?? undefined,
    size: preview.candidateSize ?? undefined,
  };
  if (guardVerdict(previewGuard, probe) === "changed") return "mismatch";
  // From here on, classification and backfill fall back to the STRICT
  // `sourceChangeVerdict` (never `guardVerdict`) on purpose: a stat MATCH
  // when the checksum is unconfirmable is not proof of anything — it only
  // failed to CONTRADICT — so it must never be treated as "confirmed
  // unchanged" for what gets recorded, only used above to catch an outright
  // disagreement.
  const freshVerdict = sourceChangeVerdict(recorded, probe);
  if (freshVerdict === "unknown" && !escalated) return "gap";
  const nothingRecorded = recorded.checksum == null && recorded.mtime == null && recorded.size == null;
  const prov = freshVerdict === "unchanged" || nothingRecorded ? probe : recorded;
  return {
    ...(prov.checksum != null ? { checksum: prov.checksum } : {}),
    ...(prov.mtime != null ? { mtime: prov.mtime } : {}),
    ...(prov.size != null ? { size: prov.size } : {}),
  };
}
