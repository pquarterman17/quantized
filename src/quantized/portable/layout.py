"""P1.7 "Pack Project" bundle contract — the pure path/naming rules every
other portable-bundle module builds on.

## What a bundle is (PR 1 defines the contract; PR 2/PR 3 do the actual
copying and atomic publish — nothing here reads or writes file content)

A portable bundle is a directory holding:

    <bundle dir>/<project stem>.dwk         # a packed copy of the project
    <bundle dir>/quantized-bundle.json      # this module's MANIFEST_FILENAME
    <bundle dir>/sources/<bundle-relative>  # copied dataset source files

Every path recorded *inside* the manifest as a bundle destination is
**bundle-relative**: forward-slash-separated, relative to the bundle
directory (the same directory the packed ``.dwk`` lives in), always rooted
at ``sources/`` (:data:`SOURCES_DIR`) — e.g. ``sources/run1.csv`` or
``sources/subdir/run2.csv``. A bundle-relative path never carries drive
letters, UNC prefixes, or ``.``/``..`` segments; :func:`is_bundle_relative`
is the one predicate every consumer (this PR's manifest builder, PR 2's
copier, PR 3's opener) must apply before turning a manifest path back into a
filesystem path, and :func:`join_bundle_path` is the one sanctioned way to
do that turning.

Original (source) paths are a completely different namespace — real,
absolute, host filesystem paths that may not even exist on THIS machine
(the bundle is meant to move to a machine that never had them). They appear
in the manifest only as provenance (``original_path``), never as a bundle
destination: :mod:`quantized.portable.manifest` builds every bundle
destination from a *sanitized basename*, never from any part of the
original directory structure.

## Cross-platform naming (`sanitize_component`)

A bundle must open cleanly on Windows, macOS, and Linux, so a source's
original basename may not be safe to reuse verbatim as a bundle filename:
Windows forbids `<>:"|?*` and control characters, rejects a small set of
reserved device names regardless of extension, and drops trailing dots and
spaces silently (which would otherwise let two visually-identical names
collide); all three platforms have practical path-length limits, so a name
whose UTF-8 encoding is unreasonably long is truncated with a content hash
suffix rather than passed through and risk a copy failing on the target
machine. ``sanitize_component`` never silently drops information: whenever
it changes anything it also says why (the ``reason`` half of its return
value), so the manifest builder can decide whether to warn.
"""

from __future__ import annotations

import hashlib
import os
import re
import unicodedata

__all__ = [
    "BUNDLE_FORMAT",
    "MANIFEST_VERSION",
    "MANIFEST_FILENAME",
    "SOURCES_DIR",
    "SUPPORTED_MANIFEST_VERSIONS",
    "MAX_COMPONENT_BYTES",
    "basename_of",
    "path_key",
    "sanitize_component",
    "is_bundle_relative",
    "join_bundle_path",
]

BUNDLE_FORMAT = "quantized-portable-bundle"
MANIFEST_VERSION = 1
MANIFEST_FILENAME = "quantized-bundle.json"
SOURCES_DIR = "sources"
SUPPORTED_MANIFEST_VERSIONS = (1,)

# The byte budget a single sanitized path component must fit inside (UTF-8
# encoded) before `sanitize_component` truncates it. Chosen well under every
# mainstream filesystem's per-component ceiling (255 bytes on ext4/APFS/NTFS)
# to leave headroom for a `sources/` prefix and a copier's own temp-file
# decoration, without being so small that ordinary scientific filenames
# (long instrument-generated names, Unicode sample labels) trip it often.
MAX_COMPONENT_BYTES = 200


def basename_of(path: str) -> str:
    """Last path component, tolerant of either separator.

    Mirrors ``frontend/src/lib/importEntry.ts``'s ``baseName`` exactly (same
    "last of either separator" rule) so a path recorded by either side of
    the Python/TypeScript boundary yields the same basename.
    """
    cut = max(path.rfind("/"), path.rfind("\\"))
    return path[cut + 1 :] if cut >= 0 else path


def path_key(path: str) -> str:
    """Identity for "do these two path strings name the same thing" — used
    to dedup sources by original path and to detect destination-name
    collisions, never to build a filesystem path.

    Mirrors ``frontend/src/lib/relink.ts``'s ``pathKey`` (split on either
    separator, drop empty segments, case-fold, rejoin with ``/``) plus one
    addition that module doesn't need: Unicode NFC normalization. The
    frontend only ever compares paths reported by the SAME OS within one
    relink session; this key also has to compare a path a macOS volume
    reports in NFD form (HFS+/APFS decompose accented characters on the way
    out of the filesystem API) against the NFC form the same string would
    take if typed or reported by Windows/Linux, so two spellings of one
    visually-identical name must key identically here even though
    ``relink.ts`` never has to make that call.
    """
    segments = [s for s in re.split(r"[\\/]+", path) if s]
    normalized = [unicodedata.normalize("NFC", s).casefold() for s in segments]
    return "/".join(normalized)


# Characters illegal in a filename on at least one of Windows/macOS/Linux,
# plus C0 controls and DEL — replaced with "_" rather than dropped, so
# "a<b>c" becomes "a_b_c" (still recognizable, no accidental collision with
# an unrelated "abc").
_ILLEGAL_CHARS_RE = re.compile(r'[<>:"|?*\x00-\x1f\x7f]')

# Windows reserved device names (case-insensitive), matched against the
# component's stem (the part before its first "."), so both "CON" and
# "CON.csv" are caught.
_RESERVED_STEMS = {"CON", "PRN", "AUX", "NUL"} | {f"COM{i}" for i in range(1, 10)} | {
    f"LPT{i}" for i in range(1, 10)
}

# Order the joined reason string is rendered in when several rules fire on
# one name — arbitrary but fixed, so `sanitize_component` is deterministic
# and its own tests can assert an exact string.
_REASON_ORDER = (
    "illegal_characters",
    "reserved_name",
    "trailing_dot_or_space",
    "empty",
    "too_long",
)


def _split_ext(name: str) -> tuple[str, str]:
    dot = name.rfind(".")
    if dot > 0:  # a leading dot ("`.gitignore`") is not an extension
        return name[:dot], name[dot:]
    return name, ""


def sanitize_component(name: str) -> tuple[str, str | None]:
    """Make ``name`` safe as a single path component on Windows/macOS/Linux.

    Returns ``(portable_name, reason)`` — ``reason`` is ``None`` when
    ``name`` needed no change at all, otherwise the rule(s) that fired,
    joined with ``"+"`` in :data:`_REASON_ORDER` when more than one applies
    (e.g. an illegal-character name that is ALSO a reserved device name).
    """
    if name in ("", ".", ".."):
        return "_", "empty"

    reasons: set[str] = set()
    working = name

    replaced = _ILLEGAL_CHARS_RE.sub("_", working)
    if replaced != working:
        reasons.add("illegal_characters")
    working = replaced

    stripped = working.rstrip(" .")
    if stripped != working:
        reasons.add("trailing_dot_or_space")
    working = stripped

    if working == "":
        # Stripped down to nothing (e.g. the original was all dots/spaces).
        working = "_"
        reasons.add("empty")

    stem_check = _split_ext(working)[0].upper()
    if stem_check in _RESERVED_STEMS:
        working = "_" + working
        reasons.add("reserved_name")

    if len(working.encode("utf-8")) > MAX_COMPONENT_BYTES:
        stem, ext = _split_ext(working)
        # Hashed from the ORIGINAL name, not the working value, so the
        # truncated result is stable regardless of which earlier rules fired.
        digest = hashlib.sha256(name.encode("utf-8")).hexdigest()[:8]
        suffix = f"~{digest}"
        budget = MAX_COMPONENT_BYTES - len(ext.encode("utf-8")) - len(suffix.encode("utf-8"))
        stem_bytes = stem.encode("utf-8")[: max(budget, 0)]
        # Decode leniently: a naive byte-slice can land mid-codepoint on a
        # multi-byte UTF-8 character; drop the fragment rather than raise.
        truncated_stem = stem_bytes.decode("utf-8", errors="ignore")
        working = f"{truncated_stem}{suffix}{ext}"
        reasons.add("too_long")

    if not reasons:
        return working, None
    ordered = [r for r in _REASON_ORDER if r in reasons]
    return working, "+".join(ordered)


# Control characters (including NUL) disallowed anywhere in a bundle-relative
# path string, on top of the structural rules below.
_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")

_DRIVE_LETTER_RE = re.compile(r"^[A-Za-z]:")


def is_bundle_relative(rel: str) -> bool:
    """Is ``rel`` a well-formed bundle-relative path?

    True only when ``rel`` is non-empty, uses ONLY ``/`` as a separator (a
    literal backslash anywhere is rejected outright — never reinterpreted as
    a separator here, unlike the tolerant either-separator matching
    :func:`path_key`/``relink.ts`` use for comparing RECORDED paths), has no
    empty/``.``/``..`` segment, is not absolute in any platform's sense (no
    leading ``/``, no drive letter, no ``//``/``\\\\`` UNC prefix), carries
    no NUL or control character, and its first segment is exactly
    :data:`SOURCES_DIR`.

    This is the one containment rule every consumer must apply before
    joining a manifest-supplied path onto a real bundle directory —
    :func:`join_bundle_path` is the sanctioned way to do that joining.
    """
    if not rel:
        return False
    if "\\" in rel:
        return False
    if _CONTROL_CHAR_RE.search(rel):
        return False
    if rel.startswith("/") or rel.startswith("//"):
        return False
    if _DRIVE_LETTER_RE.match(rel):
        return False
    segments = rel.split("/")
    if any(seg in ("", ".", "..") for seg in segments):
        return False
    return segments[0] == SOURCES_DIR


def join_bundle_path(bundle_root: str, rel: str) -> str:
    """Turn a manifest-supplied bundle-relative path into a real filesystem
    path under ``bundle_root``.

    Raises ``ValueError`` when ``rel`` fails :func:`is_bundle_relative`, or
    when the joined-and-normalized result would not actually live under
    ``bundle_root`` (a defense-in-depth check — every rejected shape in
    ``is_bundle_relative`` should already make this impossible, but a path
    is only as safe as its weakest check, so this asserts the OUTCOME too
    rather than trusting the individual rules never to have a gap).

    Never resolves symlinks — that is deliberately left to whichever future
    PR actually touches the filesystem (PR 2's staged copy, PR 3's
    open-time resolution); this function only computes a string.
    """
    if not is_bundle_relative(rel):
        raise ValueError(f"not a bundle-relative path: {rel!r}")
    joined = os.path.join(bundle_root, *rel.split("/"))
    normalized_root = os.path.normpath(bundle_root)
    normalized_joined = os.path.normpath(joined)
    try:
        common = os.path.commonpath([normalized_root, normalized_joined])
    except ValueError:
        # Different drives on Windows, or otherwise incomparable — cannot be
        # "under" bundle_root by definition.
        raise ValueError(f"bundle path escapes bundle root: {rel!r}") from None
    if common != normalized_root:
        raise ValueError(f"bundle path escapes bundle root: {rel!r}")
    return joined
