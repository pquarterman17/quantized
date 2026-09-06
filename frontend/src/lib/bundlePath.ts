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
// `resolveBundlePath` is the sanctioned way to turn such a path back into
// a real filesystem path, mirroring `join_bundle_path`'s "validate, then
// join" shape but returning `null` on failure (this side never throws for
// what is, here, an ordinary "malformed/hand-edited .dwk" degrade — see
// lib/datasetSource.ts's `parseDatasetSource`) rather than raising.
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
// importing them; `bundlePathsMatch` duplicates its `pathKey` identity
// check the same way. Keep both duplicates in sync with `lib/relink.ts` by
// comment if either side's join/identity rule ever changes.

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

/** Identity for "do these two path strings name the same file" — mirrors
 *  `lib/relink.ts`'s `pathKey` (duplicated, not imported — see module doc
 *  above): split on either separator, drop empty segments, case-fold,
 *  rejoin with "/". Exported so `lib/workspaceSerialize.ts` can compare a
 *  live `source.path` against what a `bundlePath` would resolve to without
 *  itself importing `lib/relink.ts`. */
export function bundlePathsMatch(a: string, b: string): boolean {
  const key = (p: string): string =>
    p
      .split(/[\\/]+/)
      .filter(Boolean)
      .map((s) => s.toLowerCase())
      .join("/");
  return key(a) === key(b);
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
  if (new TextEncoder().encode(seg).length > 200) return false;
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
 *  `rel` fails `isBundleRelativePath` — never throws, since a stale/hand-
 *  edited `.dwk` degrading to "no bundle path" (lib/datasetSource.ts's
 *  documented fallback) is the expected outcome here, not an error.
 *
 *  Joins using `projectDir`'s OWN separator convention (so a Windows
 *  project directory yields a backslash-joined result, a POSIX one a
 *  forward-slash one) — see the module doc for why this duplicates rather
 *  than imports `lib/relink.ts`'s equivalent `joinUnderRoot`. */
export function resolveBundlePath(projectDir: string, rel: string): string | null {
  if (!isBundleRelativePath(rel)) return null;
  return joinUnderProjectDir(projectDir, rel.split("/"));
}
