"""Saved import filters: persist an :class:`~quantized.io.import_preview.ImportSettings`
under a name + glob pattern so a messy instrument file only needs the import
wizard's manual setup once (ORIGIN_GAP_PLAN #40).

Persistence lives in the SERVER user config directory (via ``platformdirs``,
MIT-licensed), never in the browser — the registry (a headless, server-side
chokepoint; see :mod:`quantized.io.registry`) must be able to see saved
filters, which rules out frontend-only storage. The directory is overridable
via the ``QZ_CONFIG_DIR`` environment variable so tests never touch the real
user config (and so a packaged app can be pointed at a portable location).

Pure ``io`` layer — no fastapi/pydantic imports; :mod:`quantized.routes.import_wizard`
is the thin adapter that exposes this as CRUD + "import with filter" endpoints.
"""

from __future__ import annotations

import fnmatch
import json
import os
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import platformdirs

from quantized.io.import_preview import ImportSettings

__all__ = [
    "ImportFilter",
    "config_dir",
    "delete_filter",
    "load_filters",
    "match_filter",
    "save_filter",
]

_ENV_OVERRIDE = "QZ_CONFIG_DIR"
_APP_NAME = "quantized"
_FILTERS_FILENAME = "import_filters.json"


@dataclass(frozen=True)
class ImportFilter:
    """A saved, named :class:`ImportSettings` bound to a filename glob.

    ``updated`` is an ISO-8601 UTC timestamp, stamped by :func:`save_filter`;
    it is the tie-break key in :func:`match_filter` (see there).
    """

    name: str
    glob: str
    settings: ImportSettings
    updated: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "glob": self.glob,
            "settings": self.settings.to_dict(),
            "updated": self.updated,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> ImportFilter:
        return cls(
            name=str(payload.get("name", "")),
            glob=str(payload.get("glob", "*")),
            settings=ImportSettings.from_dict(payload.get("settings") or {}),
            updated=str(payload.get("updated", "")),
        )


def config_dir() -> Path:
    """The user config directory quantized persists filters (and later,
    plugin state) under. ``QZ_CONFIG_DIR`` overrides it (tests set this to a
    ``tmp_path`` so they never touch the real user config directory).
    """
    override = os.environ.get(_ENV_OVERRIDE)
    base = Path(override) if override else Path(
        platformdirs.user_config_dir(_APP_NAME, appauthor=False)
    )
    base.mkdir(parents=True, exist_ok=True)
    return base


def _filters_path() -> Path:
    return config_dir() / _FILTERS_FILENAME


def load_filters() -> list[ImportFilter]:
    """All saved filters. Missing or corrupt files -> ``[]`` (never raises);
    a malformed individual entry is skipped, not fatal to the rest."""
    path = _filters_path()
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        return []
    if not isinstance(raw, list):
        return []
    filters: list[ImportFilter] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            filters.append(ImportFilter.from_dict(item))
        except (TypeError, ValueError):
            continue
    return filters


def _write_filters(filters: list[ImportFilter]) -> None:
    payload = [f.to_dict() for f in filters]
    _filters_path().write_text(json.dumps(payload, indent=2), encoding="utf-8")


def save_filter(filt: ImportFilter) -> ImportFilter:
    """Upsert ``filt`` by name (case-sensitive) and persist it.

    Stamps ``updated`` to now (UTC), overriding whatever was passed in, so the
    tie-break in :func:`match_filter` always reflects the true save order.
    """
    if not filt.name.strip():
        raise ValueError("filter name must not be empty")
    stamped = replace(filt, updated=datetime.now(UTC).isoformat())
    remaining = [f for f in load_filters() if f.name != stamped.name]
    remaining.append(stamped)
    _write_filters(remaining)
    return stamped


def delete_filter(name: str) -> bool:
    """Remove the filter named ``name``. Returns whether one was removed."""
    filters = load_filters()
    remaining = [f for f in filters if f.name != name]
    if len(remaining) == len(filters):
        return False
    _write_filters(remaining)
    return True


def _specificity(pattern: str) -> int:
    """Rough glob specificity: count of literal (non-wildcard) characters.

    ``"XYZ9000_*.dat"`` (11 literal chars) outranks ``"*.dat"`` (4) so a
    narrowly-targeted saved filter wins over a broad one.
    """
    return sum(1 for c in pattern if c not in "*?")


def match_filter(
    path: str | Path, filters: list[ImportFilter] | None = None
) -> ImportFilter | None:
    """The best saved filter for ``path``'s filename, or ``None``.

    Matching is case-insensitive glob (:mod:`fnmatch`) against the filename
    only (not the full path). When more than one saved filter matches:

    - the most SPECIFIC glob wins (highest literal-character count, per
      :func:`_specificity`) — a filter aimed at one instrument's naming
      convention should beat a catch-all;
    - ties in specificity are broken by the most RECENTLY saved filter
      (``updated``, ISO-8601 so it sorts lexicographically) — the user's
      latest edit reflects their current intent.

    ``filters`` lets callers pass an already-loaded list (e.g. the registry,
    to avoid re-reading the JSON file per candidate extension); defaults to
    :func:`load_filters`.
    """
    name = Path(path).name.lower()
    candidates = load_filters() if filters is None else filters
    matches = [f for f in candidates if fnmatch.fnmatch(name, f.glob.lower())]
    if not matches:
        return None
    return max(matches, key=lambda f: (_specificity(f.glob), f.updated))
