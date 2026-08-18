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

/** Did the SOURCE FILE's content change since it was imported or last
 *  relinked? Checksum is authoritative whenever BOTH sides have one —
 *  content identity, not a proxy for it. Falls back to comparing size and
 *  mtime only when no checksum is available on either side (a dataset
 *  imported before this slice, or a browser import that never had bridge
 *  access to compute one). Reports `"unknown"` — NEVER `"unchanged"` — when
 *  there simply isn't enough recorded or probed information to say
 *  anything at all: a browser-imported dataset with no recorded provenance
 *  must never be silently reported as fine just because nothing
 *  contradicts it. */
export function sourceChangeVerdict(
  recorded: RecordedProvenance,
  probed: ProbedProvenance,
): SourceChangeVerdict {
  if (recorded.checksum && probed.checksum) {
    return recorded.checksum === probed.checksum ? "unchanged" : "changed";
  }
  const haveSize = recorded.size !== undefined && probed.size != null;
  const haveMtime = recorded.mtime !== undefined && probed.mtime != null;
  if (!haveSize && !haveMtime) return "unknown";
  if (haveSize && recorded.size !== probed.size) return "changed";
  if (haveMtime && recorded.mtime !== probed.mtime) return "changed";
  return "unchanged";
}
