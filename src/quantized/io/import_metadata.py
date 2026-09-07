"""P1.6 Part A: structured preamble metadata.

``io/import_preview.py``'s ``_preamble_comments`` already retains every
un-consumed preamble line (above ``ImportSettings.data_start_line``, not
eaten by ``header_line``/``units_line``/``label_line``) verbatim in
``metadata["comments"]`` -- searchable, but flat text, so nothing can look
up "what temperature was this scan" without grepping. This module adds a
second, STRICTLY ADDITIVE parse of those same lines into an ordered
``dict[str, str]`` (``metadata["header_fields"]``): recognizes
``key: value`` and ``key = value`` (optional leading comment marker
``# % // ;``, whitespace trimmed off both halves). A line with no
separator, an empty key, or an empty value is not a field -- it stays
comments-only, same as today.

Split out of ``import_preview.py`` purely to stay under the 500-line
god-module ceiling (CLAUDE.md) -- ``preamble_comments`` moved here WITH its
existing caller's behaviour UNCHANGED (still capped at
``MAX_PREAMBLE_COMMENTS``, still the exact same retained lines); the
call site in ``import_preview._preamble_comments`` is now a thin wrapper.

Pure ``io`` layer -- no fastapi/pydantic/starlette imports (CLAUDE.md).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from typing import Any

__all__ = [
    "MAX_HEADER_FIELDS",
    "MAX_PREAMBLE_COMMENTS",
    "parse_header_fields",
    "preamble_comments",
]

# Moved verbatim from `import_preview._MAX_PREAMBLE_COMMENTS` (review round
# P3(b)): `data_start_line` is wizard-user-settable (unlike `io/delimited.py`'s
# auto-sniffed preamble, bounded by how far the sniffer looks), so an
# oversized value (typo, or a stale saved filter) can't balloon
# `metadata["comments"]` to the size of the whole file.
MAX_PREAMBLE_COMMENTS = 500

# Fields are a PARSE of the (already-capped) comment lines, so this cap is
# redundant with `MAX_PREAMBLE_COMMENTS` in practice -- but it is enforced
# independently, on the DISTINCT-KEY count, so a future change to the
# comment cap can never silently move this one. 200 gives an instrument
# preamble generous headroom (real ones carry a handful to a few dozen
# `key: value` lines) while still bounding a pathological file.
MAX_HEADER_FIELDS = 200

_MARKERS = ("//", "#", "%", ";")
_SEPARATOR_RE = re.compile(r"[:=]")


def preamble_comments(
    lines: Sequence[str], data_start: int, consumed: Iterable[int | None]
) -> list[str]:
    """Every non-blank line of ``lines`` below index ``data_start`` whose
    index is not in ``consumed`` (the header/units/label rows), stripped and
    retained verbatim, capped at ``MAX_PREAMBLE_COMMENTS``. Moved here
    unchanged from ``import_preview._preamble_comments``'s original body --
    see that function's docstring for the full rationale."""
    consumed_set = set(consumed)
    out: list[str] = []
    # Iterate the LINES THAT EXIST, not `range(data_start)`: the cap below
    # bounds what is COLLECTED, not how long the walk takes, and
    # `data_start_line` is free text in the wizard -- a `data_start` of 10^10
    # spent ~15 minutes stepping past EOF to collect nothing. Slicing bounds
    # the loop by the file itself, so an oversized value costs O(file), not
    # O(the number the user typed).
    for i, line in enumerate(lines[:data_start]):
        if len(out) >= MAX_PREAMBLE_COMMENTS:
            break
        if i in consumed_set:
            continue
        raw = line.strip()
        if raw:
            out.append(raw)
    return out


def _strip_marker(line: str) -> str:
    """Strip every REPEATED leading comment marker, not just one. JCAMP-DX
    (already parsed elsewhere in this repo, ``io/jcamp.py``) prefixes its
    ``##KEY=value`` records with a DOUBLE ``#``, and a plain ``## Sample:
    NbAu``-style preamble line is common too -- stopping after a single
    marker left the leading ``#`` glued onto the key (``"# Sample"`` instead
    of ``"Sample"``). Only LEADING markers are ever touched: a value that
    legitimately contains a ``#`` (or any other marker character) later in
    the line is left exactly as written."""
    s = line.strip()
    stripped = True
    while stripped:
        stripped = False
        for marker in _MARKERS:
            if s.startswith(marker):
                s = s[len(marker) :].strip()
                stripped = True
                break
    return s


def _split_field(line: str) -> tuple[str, str] | None:
    """``key: value`` / ``key = value`` -> ``(key, value)``; ``None`` when
    there's no separator or either half is empty (not a field)."""
    m = _SEPARATOR_RE.search(line)
    if m is None:
        return None
    key = line[: m.start()].strip()
    value = line[m.end() :].strip()
    if not key or not value:
        return None
    return key, value


def parse_header_fields(lines: Sequence[str]) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """Parse ``lines`` (the SAME retained-comment lines ``metadata["comments"]``
    already carries) into an ordered ``key -> value`` map.

    Keys are kept VERBATIM (never lowercased/normalized -- an instrument key
    like ``"H (Oe)"`` is meaningful as written). A key that repeats is
    handled deterministically -- the LAST occurrence's value wins -- and the
    KEY is recorded ONCE in the returned problems list, on its first repeat
    (``{"type": "duplicate_header_field", "key": ...}``, the same structured
    "problems channel" convention this PR's Part C introduces for
    categorical columns and P1.6 PR 1 introduced for error bindings) so a
    caller (the wizard) can surface that a value was silently overwritten
    rather than the overwrite happening with no trace anywhere. A THIRD (or
    later) occurrence of the same key overwrites the value again but is not
    reported again -- one problem entry per key, not one per duplicate
    occurrence, is enough to tell the wizard which keys need a look.

    Capped at ``MAX_HEADER_FIELDS`` distinct keys -- once reached, further
    lines (including further duplicates of an already-seen key) are not
    parsed. Never raises; a line that doesn't parse as a field is just
    skipped (it stays comments-only, unaffected).
    """
    fields: dict[str, str] = {}
    problems: list[dict[str, Any]] = []
    dupes_seen: set[str] = set()
    for raw in lines:
        if len(fields) >= MAX_HEADER_FIELDS:
            break
        parsed = _split_field(_strip_marker(raw))
        if parsed is None:
            continue
        key, value = parsed
        if key in fields and key not in dupes_seen:
            problems.append({"type": "duplicate_header_field", "key": key})
            dupes_seen.add(key)
        fields[key] = value
    return fields, problems
