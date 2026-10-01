"""Pack Project: flag sources that need the user's attention before bundling.

A ``.dwk`` is untrusted input: it can declare ANY path as a dataset source,
and Pack Project copies those bytes into a bundle the user may then share.
A project that names ``~/.ssh/id_rsa`` or a file outside the user's data
folders would otherwise ride along silently. So every PACKABLE manifest row
gains an ``attention`` list of ``{"code", "reason"}`` entries:

- ``outside_data_roots`` -- the source resolves outside the allowed data
  folders (``quantized.data_roots``, the same list the import routes use).
- ``unrecognised_extension`` -- the file name is not one the parser registry
  would import (``quantized.io.registry.is_recognised_data_name``).

``reason`` is a short, path-free sentence fragment for the UI. Unpackable
rows are never inspected (they are never copied, and may not be consented,
so this module must not hand their paths to a predicate that does I/O).

:func:`exclude_flagged` is the default at pack start: flagged rows become
unpackable (blocker ``excluded_needs_attention``) unless the user explicitly
chose to include them.

Pure library: both predicates are injected; nothing here touches the
filesystem. Both functions return a deep copy and never mutate their input.
"""

from __future__ import annotations

import copy
from collections.abc import Callable, Mapping
from typing import Any

from .layout import basename_of

__all__ = ["ATTENTION_REASONS", "EXCLUDED_BLOCKER", "annotate_attention", "exclude_flagged"]

ATTENTION_REASONS: dict[str, str] = {
    "outside_data_roots": "outside your data folders",
    "unrecognised_extension": "not a recognised data file type",
}
EXCLUDED_BLOCKER = "excluded_needs_attention"


def _rows(manifest: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw = manifest.get("sources")
    return [r for r in raw if isinstance(r, dict)] if isinstance(raw, list) else []


def annotate_attention(
    manifest: Mapping[str, Any],
    *,
    inside_roots: Callable[[str], bool],
    recognised: Callable[[str], bool],
) -> dict[str, Any]:
    """A copy of ``manifest`` with ``attention`` on every source row and
    ``summary["attention"]`` counting the flagged rows.

    ``inside_roots`` receives the row's ``original_path``; ``recognised``
    receives its bare file name."""
    out = copy.deepcopy(dict(manifest))
    flagged = 0
    for row in _rows(out):
        attention: list[dict[str, str]] = []
        path = row.get("original_path")
        if row.get("packable") is True and isinstance(path, str):
            codes = []
            if not inside_roots(path):
                codes.append("outside_data_roots")
            if not recognised(basename_of(path)):
                codes.append("unrecognised_extension")
            attention = [{"code": c, "reason": ATTENTION_REASONS[c]} for c in codes]
        row["attention"] = attention
        flagged += bool(attention)
    summary = out.get("summary")
    if isinstance(summary, dict):
        summary["attention"] = flagged
    return out


def exclude_flagged(manifest: Mapping[str, Any]) -> dict[str, Any]:
    """A copy of ``manifest`` in which every flagged packable row is no longer
    packable, so staging never copies it."""
    out = copy.deepcopy(dict(manifest))
    for row in _rows(out):
        if row.get("packable") is True and row.get("attention"):
            row["packable"] = False
            blockers = row.get("blockers")
            row["blockers"] = [*(blockers if isinstance(blockers, list) else []), EXCLUDED_BLOCKER]
    return out
