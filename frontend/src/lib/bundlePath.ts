// P1.7 PR 3 (frontend half) — bundle-relative dataset source paths.
//
// A packed project (`.dwk` + copied dataset files) records each copied
// source as a path RELATIVE to the bundle directory (the `.dwk`'s own
// directory), always rooted at "sources/" — e.g. "sources/run1.csv" or
// "sources/subdir/run2.csv". `isBundleRelativePath` is a faithful
// TypeScript port of the Python contract's `is_bundle_relative`
// (src/quantized/portable/layout.py) — same containment rule, same
// per-segment portability check, so a manifest path validates identically
// on both sides of the Python/TypeScript boundary. Keep the two in sync:
// any rule added to one belongs in the other.
//
// `resolveBundlePath` turns such a path back into a real filesystem path
// under `projectDir` — a "validate, then join, then re-verify containment"
// shape (mirroring `join_bundle_path`'s own belt-and-suspenders re-check
// after the join — PR 3 review finding #5, not the "line-for-line port"
// the original header here claimed; see `plans/PRIMARY_SOFTWARE_AUDIT_PLAN.md`
// for the corrected description) — returning `null` on failure (this side
// never throws for what is, here, an ordinary "malformed/hand-edited .dwk"
// degrade — see lib/datasetSource.ts's `parseDatasetSource`) rather than
// raising. `deriveBundleRelativePath` is the inverse, SERIALIZE-time
// direction: given a live absolute `source.path` and the directory a
// project is being saved into, decide whether that path sits under this
// project's own `sources/` folder and so can be written back as a portable
// bundle-relative reference — see `lib/workspaceSerialize.ts`'s
// `serializeDatasetSource` for the caller.
//
// This module is imported from the EAGER load path (`lib/datasetSource.ts`
// -> `lib/workspaceDatasetParse.ts` -> `lib/workspace.ts`, wired into
// `store/useApp.ts`), so it deliberately does NOT import `lib/relink.ts` —
// that module is otherwise lazy (only the Relink panel's store slices pull
// it in), and importing even one of its exports here would drag its whole
// chunk into the eager bundle (measured: +3.1 kB, enough alone to fail
// `scripts/check-bundle-size.mjs`'s ratchet). `joinUnderProjectDir` below
// duplicates `relink.ts`'s `joinUnderRoot`+`separatorFor` (same behavior:
// join onto `projectDir` using ITS OWN separator convention) rather than
// importing them. Keep the duplicate in sync with `lib/relink.ts` by
// comment if its join rule ever changes.

// Self-import (a live binding to this module's OWN exports object) so
// `resolveBundlePath`'s call to `isBundleRelativePath` below goes through a
// reference that `vi.spyOn(bundlePathModule, "isBundleRelativePath")` can
// actually intercept in tests — Vitest/esbuild's module transform does NOT
// rewrite a same-module function's plain local-scope calls to go through
// its own exports object, so spying on the imported module namespace alone
// leaves a direct local call unaffected (measured directly: a mocked
// `isBundleRelativePath` that throws never fired through a local call).
// Routing the ONE call site that a review-round regression test needs to
// intercept (bundlePath.test.ts's post-join containment-check test, PR 3
// review finding #5) through `self.isBundleRelativePath` instead keeps
// every other reference in this file a normal local call.
import * as self from "./bundlePath";

/** One shared UTF-8 encoder for every portable-segment byte-length check
 *  below (PR 3 review finding #6) — `TextEncoder` construction is cheap but
 *  pointless to repeat once per segment per call. */
const UTF8 = new TextEncoder();

/** Which separator `root` itself uses — mirrors `lib/relink.ts`'s private
 *  `separatorFor` (duplicated, not imported — see module doc above). */
function separatorFor(root: string): string {
  const backslash = String.fromCharCode(92);
  return root.includes(backslash) && !root.includes("/") ? backslash : "/";
}

/** Join `root` + `segments` using `root`'s own separator convention —
 *  mirrors `lib/relink.ts`'s `joinUnderRoot` (duplicated, not imported —
 *  see module doc above). */
function joinUnderProjectDir(root: string, segments: string[]): string {
  const sep = separatorFor(root);
  const base = root.replace(/[\\/]+$/, "");
  return [base, ...segments].join(sep);
}

/** Forward-slash form of `p`, backslashes only (no case-folding — PR 3
 *  review finding #1/#2: a case-sensitive volume must never have two
 *  differently-cased spellings of the same directory treated as equal). */
function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** `dir`, forward-slashed with any trailing separator stripped — the
 *  normal form both `resolveBundlePath`'s containment check and
 *  `deriveBundleRelativePath` compare against. */
function normalizedProjectDir(dir: string): string {
  return toForwardSlashes(dir).replace(/\/+$/, "");
}

// Mirrors layout.py's `_ILLEGAL_CHARS_RE` — characters illegal in a
// filename on at least one of Windows/macOS/Linux, plus C0 controls and DEL.
const ILLEGAL_CHARS_RE = /[<>:"|?*\x00-\x1f\x7f]/;

// Mirrors layout.py's `_RESERVED_STEMS` — Windows reserved device names
// (case-insensitive), matched against the component's stem (the part
// before its FIRST ".").
const RESERVED_STEMS = new Set<string>([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

// Mirrors layout.py's `_CONTROL_CHAR_RE` — control characters (including
// NUL) disallowed anywhere in a bundle-relative path string.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

const DRIVE_LETTER_RE = /^[A-Za-z]:/;

const SOURCES_DIR = "sources";

/** Is `seg` already a portable path component — layout.py's
 *  `sanitize_component(seg) == (seg, None)`, i.e. every rule that function
 *  would otherwise REPAIR instead already passes untouched? Ported as a
 *  pure predicate (never the repair itself — this side has no reason to
 *  rewrite a segment, only to accept or reject one). */
function isPortableSegment(seg: string): boolean {
  if (seg === "" || seg === "." || seg === "..") return false;
  if (ILLEGAL_CHARS_RE.test(seg)) return false;
  if (seg !== seg.replace(/[ .]+$/, "")) return false; // trailing dot/space
  const stem = seg.split(".", 1)[0].toUpperCase();
  if (RESERVED_STEMS.has(stem)) return false;
  // layout.py's MAX_COMPONENT_BYTES check (UTF-8 byte length, not JS's
  // UTF-16 code-unit length — a segment of astral characters must be
  // measured the same way on both sides of the boundary).
  if (UTF8.encode(seg).length > 200) return false;
  return true;
}

/** Is `rel` a well-formed bundle-relative path? Faithful port of
 *  `quantized.portable.layout.is_bundle_relative` — see that function's
 *  docstring for the full rule-by-rule rationale (this mirrors it exactly,
 *  rule for rule, rather than re-deriving an equivalent-but-different
 *  check). True only when `rel` is non-empty, uses ONLY "/" as a separator
 *  (a literal backslash anywhere is rejected outright), has no empty/"."/
 *  ".." segment, is not absolute in any platform's sense (no leading "/",
 *  no drive letter, no "//"/"\\\\" UNC prefix), carries no NUL or control
 *  character, its first segment is exactly "sources", and every segment is
 *  already a portable name in `sanitize_component`'s own sense. */
export function isBundleRelativePath(rel: string): boolean {
  if (!rel) return false;
  if (rel.includes("\\")) return false;
  if (CONTROL_CHAR_RE.test(rel)) return false;
  if (rel.startsWith("/")) return false; // also rejects the "//" UNC-ish case
  if (DRIVE_LETTER_RE.test(rel)) return false;
  const segments = rel.split("/");
  if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) return false;
  if (segments[0] !== SOURCES_DIR) return false;
  return segments.every(isPortableSegment);
}

/** Turn a manifest-supplied bundle-relative path into a real filesystem
 *  path under `projectDir` (the `.dwk`'s own directory), or `null` when
 *  `projectDir` is unknown, `rel` fails `isBundleRelativePath`, or the
 *  joined result fails the post-join containment re-check below — never
 *  throws, since a stale/hand-edited `.dwk` degrading to "no bundle path"
 *  (lib/datasetSource.ts's documented fallback) is the expected outcome
 *  here, not an error.
 *
 *  `projectDir === ""` is treated as UNKNOWN, not a real (root-relative)
 *  directory (PR 3 review finding #3): `lib/importEntry.ts`'s
 *  `parentDirectory` returns `""` as its own "no directory" sentinel for a
 *  separator-less path, and joining against that would silently resolve a
 *  bundle source to a bogus root-anchored path like "/sources/a.csv" —
 *  every call site is also fixed to pass `parentDirectory(p) || undefined`
 *  rather than relying on this guard alone.
 *
 *  Joins using `projectDir`'s OWN separator convention (so a Windows
 *  project directory yields a backslash-joined result, a POSIX one a
 *  forward-slash one) — see the module doc for why this duplicates rather
 *  than imports `lib/relink.ts`'s equivalent `joinUnderRoot`.
 *
 *  PR 3 review finding #5: after joining, independently re-verify the
 *  JOINED result (separator-normalized) actually lands under
 *  `projectDir + "/sources/"` and carries no residual "/../" or "/./"
 *  segment — `join_bundle_path`'s own post-join containment check, ported
 *  alongside the pre-join `isBundleRelativePath` validation rather than
 *  trusting that validation alone. */
export function resolveBundlePath(projectDir: string, rel: string): string | null {
  if (!projectDir) return null;
  if (!self.isBundleRelativePath(rel)) return null;
  const joined = joinUnderProjectDir(projectDir, rel.split("/"));
  const normalizedJoined = toForwardSlashes(joined);
  const prefix = `${normalizedProjectDir(projectDir)}/${SOURCES_DIR}/`;
  if (!normalizedJoined.startsWith(prefix)) return null;
  if (/(^|\/)\.\.?(\/|$)/.test(normalizedJoined)) return null;
  return joined;
}

/** The inverse of `resolveBundlePath`, for SERIALIZE time
 *  (`lib/workspaceSerialize.ts`'s `serializeDatasetSource`): given a live
 *  absolute `sourcePath` and the directory a project is being saved into,
 *  decide whether `sourcePath` sits under THIS `projectDir`'s own
 *  `sources/` folder and so can be written back as a portable
 *  bundle-relative reference.
 *
 *  PR 3 review finding #1/#2 (design change): this replaces the old
 *  parse-time `DatasetSource.bundlePath` field entirely — rather than a
 *  dataset remembering the bundle-relative path it was resolved FROM (and
 *  the serializer re-resolving THAT to compare identities), the
 *  bundle-relative form is derived FRESH from the live `path` at every
 *  save. Both `projectDir` and `sourcePath` are normalized to forward
 *  slashes — case is NEVER folded (the reviewed bug: two differently-cased
 *  spellings of the same directory on a case-sensitive volume must not be
 *  treated as identical, or a bundle reference could be written against a
 *  path that does not exist) — and a trailing separator on `projectDir` is
 *  stripped before an EXACT, case-sensitive prefix compare against
 *  `${projectDir}/sources/`. Returns the bundle-relative remainder
 *  ("sources/<suffix>") only when it also passes `isBundleRelativePath`;
 *  `null` (write an absolute `kind: "path"` instead) for an empty/unknown
 *  `projectDir`, a path that doesn't sit under `<projectDir>/sources/`, or
 *  a remainder that fails validation. */
export function deriveBundleRelativePath(projectDir: string, sourcePath: string): string | null {
  if (!projectDir) return null;
  const dir = normalizedProjectDir(projectDir);
  const path = toForwardSlashes(sourcePath);
  const prefix = `${dir}/${SOURCES_DIR}/`;
  if (!path.startsWith(prefix)) return null;
  const rel = path.slice(dir.length + 1);
  return isBundleRelativePath(rel) ? rel : null;
}
