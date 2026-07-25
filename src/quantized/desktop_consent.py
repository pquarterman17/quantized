"""User-consented file paths (MAIN_PLAN #31).

``/import`` confines reads to a few allowed roots (home / cwd / temp) so the
localhost API cannot be turned into an arbitrary-file reader by a page that
happens to be pointed at it. That guard is correct and stays.

It is also, on its own, too narrow for the thing #31 exists to fix. The plan
names "long network-drive paths" as a headline pain point, and a UNC share or a
second drive is by definition outside home/cwd/temp — so a user who picked a
file from one in a native dialog would watch the import 403.

This module is the narrow, explicit widening: a path lands here ONLY when the
user physically chose it in a native OS file dialog opened by the desktop
shell. That is precisely the trust model the browser file picker already grants
``/upload`` — the user hands over a specific file — with the single difference
that we keep the path instead of only the bytes.

What it is NOT:
  * Not reachable from the web page. Entries are added by the in-process
    pywebview ``js_api`` bridge AFTER a modal OS dialog returns; there is no
    HTTP route that grants consent, so a hostile page cannot self-authorize.
  * Not a prefix rule. Consent is per exact resolved path, so consenting to
    ``/mnt/share/run1.dat`` grants nothing about its siblings or its directory.
  * Not unbounded or permanent. Entries are capped and live only for the
    process, so a long desktop session cannot accumulate an ever-growing
    ambient allowlist.
"""

from __future__ import annotations

import os
from collections import OrderedDict
from collections.abc import Iterable

__all__ = ["clear_consent", "consent_count", "grant_paths", "is_consented"]

# Bounded so a very long session cannot grow this without limit. Comfortably
# above any realistic number of files picked by hand in one sitting; the oldest
# entry is evicted first, which at worst costs a re-pick.
_MAX_ENTRIES = 512

# Exact realpath -> None, insertion-ordered so eviction is oldest-first.
_granted: OrderedDict[str, None] = OrderedDict()


def _normalize(path: str) -> str | None:
    """Resolve to the same form the import guard compares against.

    Both sides must agree, or consent silently never matches: ``/import``
    normalizes with ``os.path.realpath`` before its containment check, so this
    does too.
    """
    try:
        return os.path.realpath(path)
    except (OSError, ValueError):
        return None


def grant_paths(paths: Iterable[str]) -> list[str]:
    """Record paths the user just chose in a native dialog. Returns those
    accepted, normalized — callers hand these to the frontend so it imports the
    exact string the guard will later recognize."""
    accepted: list[str] = []
    for raw in paths:
        resolved = _normalize(raw)
        if resolved is None or not os.path.isfile(resolved):
            continue  # a directory or an unreadable entry grants nothing
        _granted.pop(resolved, None)  # re-picking refreshes recency
        _granted[resolved] = None
        accepted.append(resolved)
    while len(_granted) > _MAX_ENTRIES:
        _granted.popitem(last=False)
    return accepted


def is_consented(resolved_path: str) -> bool:
    """True when this EXACT resolved path was granted. Callers must pass an
    already-``realpath``-normalized string (the import route does)."""
    return resolved_path in _granted


def consent_count() -> int:
    return len(_granted)


def clear_consent() -> None:
    """Drop every grant. Used by tests, and available for a future
    "forget picked files" action."""
    _granted.clear()
