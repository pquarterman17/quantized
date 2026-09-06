"""P1.7 "Pack Project" — exact-path source dedup, filesystem-identity
collapse.

Split out of :mod:`quantized.portable.manifest` to keep that module under
the repo's 500-line god-module ceiling; a pure extension of it, same purity
constraints (no filesystem access, no fastapi/pydantic/starlette imports)
apply. This module owns the ONLY place ``probe``/``consented`` are ever
invoked for the dry-run manifest, and it invokes each exactly once per
distinct original-path spelling.

## The bug this fixes (PR #305 review finding)

The prior implementation grouped datasets by ``layout.path_key`` (case-
folded, NFC-normalized, separator-normalized) and treated every dataset
whose original path FOLDED to the same key as one shared source — probing
only the lexicographically-chosen spelling and mapping every dataset in the
group to that one row. On a case-sensitive filesystem ``/data/A.csv`` and
``/data/a.csv`` are two DIFFERENT files; folding them together silently
merged two datasets onto one packed copy — the packed project would then
point both datasets at whichever single file got copied, discarding the
other's actual content with no warning at all.

## The fix

1. **Dedup by EXACT path string, never by folded key.** Two datasets whose
   ``source.path`` strings are byte-identical share one group (unchanged —
   that was always a safe dedup, since it is the same string). Every other
   distinct spelling — even one that only differs by case, Unicode
   normalization form, or separator style — gets its own group, and
   :func:`group_and_collapse_sources` calls ``probe``/``consented`` exactly
   once per distinct spelling, never once per folded key.
2. **Collapse ONLY on proven filesystem identity.** After every spelling has
   been classified, two (or more) spellings' groups merge into one final
   source row IF AND ONLY IF every one of them classified as ``"ok"`` AND
   reported the identical, NON-ZERO ``(dev, ino)`` pair (see
   :func:`quantized.desktop_source_probe.probe_source_path`'s own doc for
   why zero means "unknown identity" and must never be treated as a match).
   A spelling whose probe is not ``ok``, or whose identity is unknown, is
   never merged with anything — including another spelling that merely
   folds to the same ``path_key``. Groups that fold to the same key but are
   NOT provably one file stay separate rows; the existing collision-suffix
   machinery in :mod:`quantized.portable.naming` then gives them visibly
   distinct destinations (``A.csv`` and ``a (2).csv``) instead of silently
   sharing one.

## Determinism

Classification happens once per distinct spelling, in a fixed
``(path_key, spelling)`` order — arbitrary but reproducible, so a caller
whose ``probe``/``consented`` have any observable side effect (a counting
probe in a test, say) sees a call sequence that does not depend on payload
order. Collapse is symmetric and order-independent: it groups spellings by
the VALUE of their ``(dev, ino)`` pair (an equivalence relation on that
value, not a chain of pairwise merges), so which spelling happened to be
probed or listed first never affects which spellings end up sharing a row.
Within a merged row, ``original_path`` is the canonical spelling
(lexicographically least by ``(NFC-normalized string, raw string)``) and
``original_path_variants`` lists every distinct spelling in the group
(empty when there was only one); ``size``/``mtime``/``checksum`` come from
the CANONICAL spelling's own classification, never an arbitrary member's,
so the row content itself does not depend on collection order either.
``members`` (the per-dataset provenance entries feeding ``shared_by``) are
re-sorted into original PAYLOAD order (via each member's
``_payload_index``) regardless of which spelling's group they arrived
through.

## Downstream note (for the future "PR 3" project-rewrite work)

Anything that maps a dataset back onto a manifest row (e.g. a future
``project_rewrite.rewrite_payload_for_bundle``) MUST match by exact
``original_path`` OR membership in ``original_path_variants`` — never by
folded ``path_key`` — for the identical reason: two case/separator variants
sharing a folded key are not guaranteed to be the same file.
"""

from __future__ import annotations

import ntpath
import posixpath
import re
import unicodedata
from collections.abc import Callable, Mapping
from typing import Any

from .layout import path_key

__all__ = [
    "Consented",
    "Probe",
    "group_and_collapse_sources",
]

Probe = Callable[[str], Mapping[str, Any]]
Consented = Callable[[str], bool]

# The states `probe` is contractually allowed to report (mirrors
# `desktop_source_probe.probe_source_path`'s own set). Anything else is a
# caller bug -- degrade it to "invalid" rather than let an unrecognized
# string silently become "packable" or otherwise misclassified.
_KNOWN_PROBE_STATES = {"ok", "missing", "offline", "invalid", "permission_denied"}

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1f\x7f]")
_DRIVE_OR_UNC_RE = re.compile(r"^[A-Za-z]:[\\/]")


def _has_control_chars(s: str) -> bool:
    return bool(_CONTROL_CHAR_RE.search(s))


def _looks_absolute(path: str) -> bool:
    """Is ``path`` absolute under EITHER host convention?

    Never ``os.path.isabs`` alone: that only recognizes the RUNNING
    platform's own convention, and on Python 3.13 ``os.path`` is
    ``ntpath`` on Windows -- where ``ntpath.isabs("/data/x.csv")`` is
    FALSE (no drive, so ntpath does not consider a bare leading slash
    absolute), which would misclassify an ordinary POSIX path as relative
    on a Windows host. This checks ``posixpath.isabs`` and ``ntpath.isabs``
    EXPLICITLY, regardless of the host platform, plus the drive-letter and
    UNC shapes below as belt-and-suspenders -- a workspace payload can
    legitimately declare a source recorded on a different OS than the one
    validating it right now.
    """
    if posixpath.isabs(path) or ntpath.isabs(path):
        return True
    if _DRIVE_OR_UNC_RE.match(path):
        return True
    return path.startswith("\\\\") or path.startswith("//")


def _coerce_metadata(source: Mapping[str, Any]) -> dict[str, Any]:
    """Type-validate a size/mtime/checksum-shaped mapping the same way
    regardless of whether it came from a recorded-provenance source object
    or a live ``probe`` response: checksum must be ``str``, size/mtime must
    be ``int``/``float``, anything else (a probe returning a stringified
    size, say) is treated as absent rather than trusted or allowed to
    crash a downstream arithmetic summary."""
    raw_checksum = source.get("checksum")
    raw_mtime = source.get("mtime")
    raw_size = source.get("size")
    return {
        "checksum": raw_checksum if isinstance(raw_checksum, str) else None,
        "mtime": raw_mtime if isinstance(raw_mtime, (int, float)) else None,
        "size": raw_size if isinstance(raw_size, (int, float)) else None,
    }


_UNKNOWN_IDENTITY_ROW = {
    "size": None,
    "mtime": None,
    "checksum": None,
    "dev": 0,
    "ino": 0,
}


def _probe_row_status(original_path: str, consented_fn: Consented, probe: Probe) -> dict[str, Any]:
    """Classify ONE already-deduped-by-exact-spelling path: invalid shape ->
    not_consented -> probe. Called at most once per distinct spelling
    (never once per folded :func:`quantized.portable.layout.path_key`) --
    see this module's own docstring for why that distinction is the whole
    point of the PR #305 review fix.

    Always returns ``dev``/``ino`` (``0`` when unknown, per
    :func:`quantized.desktop_source_probe.probe_source_path`'s own "zero
    means unknown identity" contract) alongside the existing
    ``status``/``size``/``mtime``/``checksum`` fields --
    :func:`group_and_collapse_sources` uses the former pair to decide
    whether two spellings may collapse into one source row; the manifest
    itself never exposes ``dev``/``ino``."""
    if _has_control_chars(original_path) or not _looks_absolute(original_path):
        return {"status": "invalid", **_UNKNOWN_IDENTITY_ROW}
    if not consented_fn(original_path):
        # Checked BEFORE `probe` is called at all: an unconsented path is
        # never handed to a probe implementation that may do real I/O
        # (review finding #8).
        return {"status": "not_consented", **_UNKNOWN_IDENTITY_ROW}
    probed = probe(original_path)
    state = probed.get("state")
    status = state if state in _KNOWN_PROBE_STATES else "invalid"
    if status != "ok":
        return {"status": status, **_UNKNOWN_IDENTITY_ROW}
    coerced = _coerce_metadata(probed)
    raw_dev = probed.get("dev")
    raw_ino = probed.get("ino")
    dev = raw_dev if isinstance(raw_dev, int) else 0
    ino = raw_ino if isinstance(raw_ino, int) else 0
    return {
        "status": status,
        "size": coerced["size"],
        "mtime": coerced["mtime"],
        "checksum": coerced["checksum"],
        "dev": dev,
        "ino": ino,
    }


def group_and_collapse_sources(
    spellings_in_order: list[str],
    members_by_spelling: dict[str, list[dict[str, Any]]],
    probe: Probe,
    consented_fn: Consented,
) -> list[dict[str, Any]]:
    """Classify every distinct spelling in ``spellings_in_order`` exactly
    once (via ``probe``/``consented_fn``, see :func:`_probe_row_status`),
    then collapse spellings that provably name one physical file into a
    single source row.

    ``members_by_spelling`` maps each distinct spelling to its list of
    per-dataset member dicts (``dataset_id``/``name``/``recorded``, plus an
    internal ``_payload_index`` used only to restore payload order after a
    merge).

    Returns one dict per final source row (order is not yet the manifest's
    final deterministic order — the caller sorts by
    ``(path_key(original_path), original_path)`` itself), each carrying
    ``original_path``, ``original_path_variants``, ``members``, ``status``,
    ``size``, ``mtime``, ``checksum``.
    """
    ordered_spellings = sorted(spellings_in_order, key=lambda p: (path_key(p), p))
    classification = {p: _probe_row_status(p, consented_fn, probe) for p in ordered_spellings}

    # Group by collapse key: an `ok` probe reporting a non-zero (dev, ino)
    # collapses with every OTHER spelling reporting that exact same pair;
    # anything else (not `ok`, or an unknown/zero identity) is its own
    # solo group, keyed by the spelling itself so it can never accidentally
    # collide with another solo spelling's key.
    collapse_groups: dict[tuple[Any, ...], list[str]] = {}
    for p in ordered_spellings:
        c = classification[p]
        dev = c.get("dev") or 0
        ino = c.get("ino") or 0
        has_identity = c["status"] == "ok" and dev and ino
        key: tuple[Any, ...] = ("identity", dev, ino) if has_identity else ("solo", p)
        collapse_groups.setdefault(key, []).append(p)

    rows: list[dict[str, Any]] = []
    for spellings in collapse_groups.values():
        canonical = min(spellings, key=lambda p: (unicodedata.normalize("NFC", p), p))
        variants = sorted(spellings) if len(spellings) > 1 else []
        c = classification[canonical]
        members: list[dict[str, Any]] = []
        for p in spellings:
            members.extend(members_by_spelling[p])
        members.sort(key=lambda m: m["_payload_index"])
        rows.append(
            {
                "original_path": canonical,
                "original_path_variants": variants,
                "members": members,
                "status": c["status"],
                "size": c["size"],
                "mtime": c["mtime"],
                "checksum": c["checksum"],
            }
        )
    return rows
