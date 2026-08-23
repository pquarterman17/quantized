"""Record types + (de)serialization for the project lock file.

Split from ``desktop_project_lock`` (P0-3/P1-1) purely to keep that module
under the enforced 500-line ceiling after the Windows release-tombstone and
orphan-inode fixes; see its module docstring for the full lock design. This
module is pure data + path/string helpers: no filesystem mutation, no OS
locks.
"""

from __future__ import annotations

import json
import os
import secrets
import socket
from dataclasses import dataclass
from typing import Any

LOCK_VERSION = 1

@dataclass(frozen=True)
class LockRecord:
    """The lock file's parsed content. Field order matches the JSON key
    order the frozen contract specifies."""

    version: int
    token: str
    instance_id: str
    hostname: str
    pid: int
    acquired_at: float
    heartbeat_at: float


@dataclass(frozen=True)
class UnverifiableLock:
    """The lock file exists but could not be trusted (corrupt, unparseable,
    or an I/O error mid-read) — NEVER raised; see this module's doc. Callers
    must treat this exactly like "someone else might hold it"."""

    reason: str


@dataclass(frozen=True)
class Contended:
    """The lock file's content is (or would be) perfectly trustworthy, but
    it could not be READ or the exclusive OS lock could not be ACQUIRED
    right now because another live handle genuinely holds it — as opposed
    to `UnverifiableLock`'s "content IS accessible but cannot be trusted".

    **Why this exists as its own outcome (the R1 follow-up fix).** On
    Windows, `msvcrt` region locks are MANDATORY: while one handle holds
    the exclusive lock this package uses, ANY other handle's plain,
    unprotected read of that byte range — no locking attempted, just an
    ordinary `open()`+`read()` — fails immediately with `PermissionError`.
    That is a completely different situation from a corrupt lock file, and
    conflating the two (the pre-fix behavior: both landed on
    `UnverifiableLock`) had a real consequence: `refresh`'s heartbeat call
    would report its own healthy holder's lock "unverifiable" — which
    reads as "lost" to a caller — every time a normal, healthy save was
    merely in progress on Windows. On POSIX, `fcntl.flock` is advisory, so
    a plain read never raises for this reason at all; `Contended` there
    can only come from the bounded OS-lock ACQUIRE retry loop timing out
    (`_open_locked`), which is a real, platform-neutral "busy right now"
    condition on both OSes.

    Callers must still treat this conservatively for anything that is NOT
    the recurring heartbeat (a one-shot acquire/read/takeover reports this
    as "cannot verify right now", same as `UnverifiableLock`, which is
    already the correct fail-closed default). `refresh` is the one
    exception with bespoke handling — see its own doc and
    `desktop_bridge.py::project_lock_refresh`'s "soft success" mapping."""

    reason: str


# `(success, resulting_or_current_record)` — the shape every mutating
# function below returns. Named so those signatures fit the line-length
# gate without folding the union onto its own awkward line.
CasResult = tuple[bool, "LockRecord | UnverifiableLock | Contended | None"]


def _lock_path(project_path: str) -> str:
    return f"{project_path}.lock"


def _make_record(instance_id: str, now: float, hostname: str | None, pid: int | None) -> LockRecord:
    return LockRecord(
        version=LOCK_VERSION,
        token=secrets.token_urlsafe(24),
        instance_id=instance_id,
        hostname=hostname if hostname is not None else socket.gethostname(),
        pid=pid if pid is not None else os.getpid(),
        acquired_at=now,
        heartbeat_at=now,
    )


def _record_to_dict(record: LockRecord) -> dict[str, Any]:
    return {
        "version": record.version,
        "token": record.token,
        "instance_id": record.instance_id,
        "hostname": record.hostname,
        "pid": record.pid,
        "acquired_at": record.acquired_at,
        "heartbeat_at": record.heartbeat_at,
    }


def _parse_record(raw: str) -> LockRecord | UnverifiableLock | None:
    """`None` is deliberately NOT returned for an empty/whitespace-only
    file — the file EXISTS (unlike a missing lock file, which `read`
    reports as `None` before ever reaching this function), so an empty
    read is a torn/mid-write state, reported `UnverifiableLock` like any
    other corrupt content."""
    if raw.strip() == "":
        return UnverifiableLock("empty lock file")
    try:
        obj = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        return UnverifiableLock(f"corrupt lock file: {exc}")
    if not isinstance(obj, dict):
        return UnverifiableLock("lock file is not a JSON object")
    if obj.get("released") is True:
        # A release TOMBSTONE (see `release`): on Windows the releasing
        # process cannot delete a file it still holds open+locked, so it
        # overwrites the record with this sentinel instead -- semantically
        # identical to "no lock file". `acquire` CAS-replaces a tombstone
        # rather than O_EXCL-creating over it.
        return None
    try:
        return LockRecord(
            version=int(obj["version"]),
            token=str(obj["token"]),
            instance_id=str(obj["instance_id"]),
            hostname=str(obj["hostname"]),
            pid=int(obj["pid"]),
            acquired_at=float(obj["acquired_at"]),
            heartbeat_at=float(obj["heartbeat_at"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        return UnverifiableLock(f"malformed lock record: {exc}")
