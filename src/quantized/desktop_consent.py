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

P1.1 adds a SECOND, separate grant kind for WRITES (``grant_write_path`` /
``is_write_consented`` / ``consented_write_path``), used by the native
Save/Save As project flow. It follows the exact same rules above — granted
only from an in-process dialog result, per exact path, capped — with one
difference: a write grant does not require the path to already exist, since
a Save As destination usually does not yet. Read and write grants are
tracked independently: opening a file never authorizes overwriting it, and
choosing a save destination never authorizes reading an unrelated file.

C1 (relink consent) adds a THIRD grant kind: READ-ONLY directory grants
(``grant_read_dir`` / ``is_dir_consented``), for exactly one gesture — the
relink panel's native "Browse..." folder picker
(``desktop_bridge_dialogs.pick_relink_directory``). Everything above is
per-EXACT-file; this is the one deliberate exception, and it stays narrow:

  * Minted ONLY from that picker's return, same "the dialog IS the consent"
    rule ``pick_files`` already follows for single files — never from a
    typed/pasted path, and there is no HTTP route or other js_api method
    that can set one.
  * Read-only and permits only CANONICAL DESCENDANTS of the granted root:
    both the root (at grant time) and the queried path (at check time) are
    ``realpath``-resolved, so a sibling whose name merely shares a text
    prefix (``/data/proj`` vs ``/data/proj2``), a ``..`` traversal, or a
    symlink/junction that resolves outside the granted tree all fail the
    containment check — none of them produce a resolved path that is
    actually still under the root. It NEVER answers a write-consent
    question (``is_write_consented``/``consented_write_path`` never
    consult it), matching the read/write isolation rule above.
  * Session-scoped and revoked explicitly, not just process-lifetime: the
    relink panel closing (``desktop_bridge_dialogs.revoke_relink_dir``), the
    open project changing (``desktop_bridge_dialogs._read_granted``, the
    same wholesale-replace moment ``set_declared_sources`` already uses),
    and app exit (``server_launch._run_desktop``'s window-closed cleanup)
    all call ``clear_dir_grants``. ``clear_consent`` (the existing
    clear-everything primitive) clears it too.
"""

from __future__ import annotations

import os
from collections import OrderedDict
from collections.abc import Iterable

__all__ = [
    "clear_consent",
    "clear_dir_grants",
    "consent_count",
    "consented_path",
    "consented_write_path",
    "declared_source_count",
    "dir_grant_count",
    "grant_paths",
    "grant_read_dir",
    "grant_write_path",
    "is_consented",
    "is_declared_source",
    "is_dir_consented",
    "is_write_consented",
    "set_declared_sources",
    "write_consent_count",
]

# Bounded so a very long session cannot grow this without limit. Comfortably
# above any realistic number of files picked by hand in one sitting; the oldest
# entry is evicted first, which at worst costs a re-pick.
_MAX_ENTRIES = 512

# Exact realpath -> that same realpath, insertion-ordered so eviction is
# oldest-first. The value is not redundant: `consented_path` hands the STORED
# string back to the caller so an accepted import reads the path this module
# recorded, never the one the request supplied (see its docstring).
_granted: OrderedDict[str, str] = OrderedDict()

# P1.1: a SEPARATE store for WRITE consent (native "Save"/"Save As" project
# dialogs), never merged with `_granted` above. The two are not
# interchangeable: `_granted` only ever accepts a path that ALREADY EXISTS
# (`grant_paths` requires `os.path.isfile`), which is correct for something
# the user just opened, but wrong for something they are about to CREATE —
# a "Save As" path chosen in a native save dialog is routinely a file that
# does not exist yet. Keeping the two sets apart also means read access to
# an arbitrary existing file can never be granted merely by having picked a
# save destination near it, and vice versa: picking a file to open never
# grants permission to overwrite it.
_write_granted: OrderedDict[str, str] = OrderedDict()


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
        _granted[resolved] = resolved
        accepted.append(resolved)
    while len(_granted) > _MAX_ENTRIES:
        _granted.popitem(last=False)
    return accepted


def is_consented(resolved_path: str) -> bool:
    """True when this EXACT resolved path was granted. Callers must pass an
    already-``realpath``-normalized string (the import route does)."""
    return resolved_path in _granted


def consented_path(resolved_path: str) -> str | None:
    """The GRANTED string for an exact consented path, or ``None``.

    Prefer this over ``is_consented`` anywhere the path is about to be opened.
    The difference is which string the caller then uses: ``is_consented`` is a
    yes/no on the request's own string, so the caller goes on to open the value
    it was handed; this returns the path *this module* recorded when the user
    picked it in the native dialog, so the bytes read are the bytes consented
    to. The two are equal whenever the lookup hits -- that is the point. It
    means the check and the open cannot drift apart, and it keeps the opened
    path out of the request's control entirely, which is also what lets static
    analysis see that no request-controlled string reaches the filesystem.
    """
    return _granted.get(resolved_path)


def consent_count() -> int:
    return len(_granted)


# -- write consent (P1.1: native Save / Save As project dialogs) ------------


def grant_write_path(path: str) -> str | None:
    """Record a path the user just chose in a native SAVE dialog. Unlike
    `grant_paths`, this does NOT require the path to already exist — a Save
    As destination is normally new. Returns the normalized path (what the
    frontend should send back on the write call), or `None` when the path
    cannot even be resolved."""
    resolved = _normalize(path)
    if resolved is None:
        return None
    _write_granted.pop(resolved, None)  # re-picking refreshes recency
    _write_granted[resolved] = resolved
    while len(_write_granted) > _MAX_ENTRIES:
        _write_granted.popitem(last=False)
    return resolved


def is_write_consented(resolved_path: str) -> bool:
    """True when this EXACT resolved path was granted for WRITING."""
    return resolved_path in _write_granted


def consented_write_path(resolved_path: str) -> str | None:
    """The GRANTED string for an exact write-consented path, or `None`. Same
    "use the stored string, not the request's" rationale as `consented_path`
    — see that function's docstring."""
    return _write_granted.get(resolved_path)


def write_consent_count() -> int:
    return len(_write_granted)


# -- declared sources (P1.7: server-side enforcement for grant_source_paths) -
#
# The adversarial-review fix: `grant_source_paths` (desktop_bridge.py) used
# to be a bare passthrough to `grant_paths` — an unconditional arbitrary-
# file-read-consent oracle, since NOTHING checked that the paths it was
# asked to grant had anything to do with the project the user actually has
# open. `store/relink.ts` computes its argument list from the frontend's own
# in-memory `datasets` array, which is exactly the kind of caller-supplied
# input this repo's whole `desktop_consent` design otherwise never trusts.
#
# The fix is NOT a new consent kind — it is a narrower ELIGIBILITY set that
# `grant_source_paths` must intersect its request against before handing
# anything to `grant_paths`. A path is eligible only when it is one this
# project's own OPENED PAYLOAD named as a dataset's source — recorded here,
# backend-side, the moment `desktop_bridge.py`'s `_read_granted` successfully
# reads a project file (i.e. `open_project_file`/`read_project_file`, both of
# which already required a real native OPEN dialog earlier). The frontend's
# argument list to `grant_source_paths` is therefore a REQUEST against this
# set, never an authority of its own — exactly mirroring how `grant_paths`
# itself only ever accepts what a real dialog returned.
#
# Wholesale REPLACE on every project open/reopen (never accumulated): opening
# project B must not leave project A's declared sources still eligible. There
# is no HTTP route that can set this, and no js_api the frontend can call to
# set it directly either — it is populated ONLY as a side effect of a
# successful project-file READ inside this process, the same "only from a
# real dialog result" discipline every other grant in this module follows.
_declared_sources: set[str] = set()


def set_declared_sources(paths: Iterable[str]) -> None:
    """Replace the declared-source set with exactly what a just-opened
    project's OWN payload names. Called only by `desktop_bridge.py`'s
    `_read_granted`, never from an HTTP route or a frontend-settable js_api
    — see this section's module doc for the full ruling."""
    global _declared_sources
    _declared_sources = {r for p in paths if (r := _normalize(p)) is not None}


def is_declared_source(resolved_path: str) -> bool:
    """True when `resolved_path` was named as a dataset source by the
    CURRENTLY open project's own payload. Callers must pass an already-
    ``realpath``-normalized string, same convention as `is_consented`."""
    return resolved_path in _declared_sources


def declared_source_count() -> int:
    return len(_declared_sources)


# -- directory grants (C1: relink "Browse..." folder picker) ----------------
#
# See the module doc above for the full ruling. Bounded the same way as the
# other two grant kinds, but far smaller: one relink session picks at most a
# handful of roots by hand, never hundreds of individual files.
_MAX_DIR_ENTRIES = 32

# Canonical realpath root -> that same string, insertion-ordered (oldest
# evicted first), same shape as `_granted`/`_write_granted` above.
_dir_granted: OrderedDict[str, str] = OrderedDict()


def grant_read_dir(path: str) -> str | None:
    """Record a directory root the user just chose in a NATIVE FOLDER
    dialog for READ-ONLY inspection of it and its descendants, this process,
    until revoked (see the module doc's revocation list). Returns the
    canonicalized root, or `None` when `path` cannot be resolved or is not
    an actual directory — mirroring `grant_paths`' "a directory or an
    unreadable entry grants nothing" rule in the opposite direction (there,
    a directory is refused; here, only a directory is accepted)."""
    resolved = _normalize(path)
    if resolved is None or not os.path.isdir(resolved):
        return None
    _dir_granted.pop(resolved, None)  # re-picking refreshes recency
    _dir_granted[resolved] = resolved
    while len(_dir_granted) > _MAX_DIR_ENTRIES:
        _dir_granted.popitem(last=False)
    return resolved


def _is_within(root: str, resolved: str) -> bool:
    """Segment-aware containment, NOT a bare `str.startswith` — that would
    let `/data/proj2` pass for a grant on `/data/proj`. Compared with
    `os.path.normcase` on both sides so a Windows drive-letter or
    backslash/forward-slash case difference between the two `realpath`
    calls (grant time vs. check time) cannot itself defeat containment;
    POSIX's `normcase` is a no-op, so this is exactly the plain comparison
    there."""
    nroot = os.path.normcase(root)
    ncand = os.path.normcase(resolved)
    if ncand == nroot:
        return True
    sep = os.path.normcase(os.sep)
    return ncand.startswith(nroot.rstrip(sep) + sep)


def is_dir_consented(path: str) -> bool:
    """True when `path` resolves to the granted root itself or a canonical
    descendant of one. `path` is `realpath`-resolved HERE (unlike
    `is_consented`, which requires an already-normalized caller) so a `..`
    segment or a symlink/junction pointing outside the granted tree is
    resolved to its real target BEFORE the containment check runs — both
    fail it, because neither one's resolved form is actually still under
    the root. Never true for a path that merely shares the root's text
    prefix (see `_is_within`)."""
    resolved = _normalize(path)
    if resolved is None:
        return False
    return any(_is_within(root, resolved) for root in _dir_granted)


def dir_grant_count() -> int:
    return len(_dir_granted)


def clear_dir_grants() -> None:
    """Revoke every directory grant — narrower than `clear_consent` below
    (read/write single-path grants and declared sources are untouched).
    Called at every point the module doc's revocation list names: relink
    panel close, project change, and app exit. Idempotent."""
    _dir_granted.clear()


def clear_consent() -> None:
    """Drop every grant — read, write, AND directory — AND the declared-
    source set. Used by tests, and available for a future "forget picked
    files" action."""
    _granted.clear()
    _write_granted.clear()
    _declared_sources.clear()
    _dir_granted.clear()
