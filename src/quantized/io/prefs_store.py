"""The GUI preferences file: namespaced JSON slots in the user config dir.

Owner decision 2026-11-25 (PREFS_AUDIT P0-1): the frontend's preferences are
persisted by the SERVER as one JSON file, so they survive a port change (a new
browser origin, which has empty ``localStorage``) and desktop launches. The
browser's ``localStorage`` stays as a fast cache; this file is the copy that
outlives an origin.

Shape on disk::

    {"version": 1, "slots": {"qz.prefs": {...}, "qz.fitPrefs": {...}}}

A *slot* is one frontend ``localStorage`` key whose value is a JSON object.
Slot names are validated by pattern (:data:`SLOT_KEY_RE`), not by an
allowlist, so a later frontend lane can sync a new slot without a backend
change; the size caps below bound what any of them can store.

- **Location:** :func:`quantized.io.import_filters.config_dir` (the existing
  per-user config dir, ``QZ_CONFIG_DIR`` overrides it), file ``prefs.json``.
- **Atomic write:** a temp file in the same directory, flushed and fsynced,
  then ``os.replace``; a crash mid-write leaves the previous file whole.
- **Corrupt file:** not JSON, or not the shape above, is moved aside to
  ``prefs.json.corrupt-<UTC stamp>`` (kept for the user, never deleted) and
  loading continues from empty. Never fatal.
- **Fail closed:** an update that is not an object of valid slots, or that
  would make the file larger than :data:`MAX_PREFS_BYTES`, raises
  :class:`PrefsError` and changes nothing.

Pure ``io`` layer: no fastapi/pydantic imports. ``routes/prefs.py`` is the
thin adapter.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from quantized.io.import_filters import config_dir

__all__ = [
    "MAX_PREFS_BYTES",
    "MAX_SLOTS",
    "PREFS_FILENAME",
    "SLOT_KEY_RE",
    "LoadResult",
    "PrefsError",
    "apply_update",
    "load_prefs",
    "prefs_path",
    "save_prefs",
    "validate_update",
]

PREFS_FILENAME = "prefs.json"
FILE_VERSION = 1
# The whole file, serialized. Today's slots total about 2 KB (24 qz.prefs
# fields plus four one-field side slots); 256 KiB leaves room for every lane
# in PREFS_AUDIT section 6 while refusing a runaway writer.
MAX_PREFS_BYTES = 256 * 1024
MAX_SLOTS = 64
# "qz." then a letter, then up to 63 of [A-Za-z0-9_.-]: the frontend's own key
# convention (frontend/src/lib/storageKeys.ts).
SLOT_KEY_RE = re.compile(r"^qz\.[A-Za-z][A-Za-z0-9_.-]{0,63}$")

_LOCK = threading.Lock()


class PrefsError(ValueError):
    """An update refused before anything was written (the reason is the message)."""


@dataclass(frozen=True)
class LoadResult:
    """The slots read from disk, plus where a corrupt file was moved (else None)."""

    slots: dict[str, dict[str, Any]]
    moved_aside: Path | None = None


def prefs_path() -> Path:
    """``<config dir>/prefs.json`` (``QZ_CONFIG_DIR`` overrides the dir)."""
    return config_dir() / PREFS_FILENAME


def _move_aside(path: Path) -> Path | None:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    target = path.with_name(f"{path.name}.corrupt-{stamp}")
    try:
        os.replace(path, target)
    except OSError:
        return None
    return target


def _valid_slots(raw: object) -> dict[str, dict[str, Any]] | None:
    """The slot map of a decoded file, or None when the shape is wrong.
    Individual entries with a bad name or a non-object value are dropped."""
    if not isinstance(raw, dict):
        return None
    slots = raw.get("slots")
    if not isinstance(slots, dict):
        return None
    return {
        k: v
        for k, v in slots.items()
        if isinstance(k, str) and SLOT_KEY_RE.match(k) and isinstance(v, dict)
    }


def load_prefs(path: Path | None = None) -> LoadResult:
    """Read the prefs file. Missing -> empty. Corrupt -> moved aside, empty."""
    target = path if path is not None else prefs_path()
    if not target.is_file():
        return LoadResult({})
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return LoadResult({}, _move_aside(target))
    except OSError:
        return LoadResult({})  # unreadable (permissions): keep it, start empty
    slots = _valid_slots(raw)
    if slots is None:
        return LoadResult({}, _move_aside(target))
    return LoadResult(slots)


def _serialize(slots: dict[str, dict[str, Any]]) -> str:
    return json.dumps({"version": FILE_VERSION, "slots": slots}, indent=1, sort_keys=True)


def save_prefs(slots: dict[str, dict[str, Any]], path: Path | None = None) -> None:
    """Write ``slots`` atomically (temp file + fsync + ``os.replace``)."""
    target = path if path is not None else prefs_path()
    text = _serialize(slots)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".prefs-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def validate_update(obj: object) -> dict[str, dict[str, Any] | None]:
    """An update is an object of ``slot name -> object`` (store) or ``null``
    (delete). Anything else raises :class:`PrefsError` naming the reason."""
    if not isinstance(obj, dict):
        raise PrefsError("slots must be a JSON object of slot name to object")
    if len(obj) > MAX_SLOTS:
        raise PrefsError(f"at most {MAX_SLOTS} slots per update")
    out: dict[str, dict[str, Any] | None] = {}
    for key, value in obj.items():
        if not isinstance(key, str) or not SLOT_KEY_RE.match(key):
            raise PrefsError(f"invalid slot name {str(key)[:80]!r} (expected qz.<name>)")
        if value is not None and not isinstance(value, dict):
            raise PrefsError(f"slot {key!r} must be a JSON object or null")
        out[key] = value
    return out


def apply_update(update: object, path: Path | None = None) -> dict[str, dict[str, Any]]:
    """Validate ``update``, merge it into the file (``null`` deletes a slot) and
    write it. Returns the merged slots. Raises :class:`PrefsError` (nothing
    written) on a bad update or one that would exceed the caps."""
    clean = validate_update(update)
    with _LOCK:
        slots = dict(load_prefs(path).slots)
        for key, value in clean.items():
            if value is None:
                slots.pop(key, None)
            else:
                slots[key] = value
        if len(slots) > MAX_SLOTS:
            raise PrefsError(f"at most {MAX_SLOTS} slots in the prefs file")
        if len(_serialize(slots).encode("utf-8")) > MAX_PREFS_BYTES:
            raise PrefsError(f"prefs would exceed {MAX_PREFS_BYTES // 1024} KiB")
        save_prefs(slots, path)
    return slots
