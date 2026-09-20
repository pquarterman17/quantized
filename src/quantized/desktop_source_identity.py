"""Filesystem-identity checks for raw-source write protection.

Path canonicalisation catches ordinary aliases (``..`` and symlinks), but a
hard link has no canonical name: two different directory entries name the
same file.  ``matches_declared_source`` keeps the cheap path checks first and
uses :func:`os.path.samestat` for the cases where the filesystem can make two
spellings refer to one file.

The identity pass is deliberately narrow.  An ordinary existing destination
with one link cannot be a hard-linked alias, so unrelated source paths are not
``stat``-ed on every quick-save.  A case- or Unicode-normalisation-equivalent
spelling is still checked even with one link, covering normalization-insensitive
macOS filesystems and case-insensitive filesystems without assuming that every
filesystem on an OS has those semantics.
"""

from __future__ import annotations

import os
import unicodedata
from collections.abc import Iterable

__all__ = ["matches_declared_source"]


def _spelling_key(path: str) -> str:
    """A comparison key used only to decide whether an identity check is needed.

    Equality here never declares two files equal: case-sensitive filesystems
    may legitimately contain both spellings, so :func:`os.path.samestat` is
    still the authority.
    """

    return unicodedata.normalize("NFC", os.path.normcase(path)).casefold()


def matches_declared_source(resolved_dest: str, source_paths: Iterable[str]) -> bool:
    """Return whether ``resolved_dest`` names any declared source file.

    ``resolved_dest`` must already be ``realpath``-resolved by the caller.
    Exact and symlink-equivalent paths take the no-extra-I/O fast path.  File
    identity is compared with the platform implementation of ``stat`` /
    ``samestat`` (device + inode/file index), which is supported on Windows,
    macOS, and Linux.

    A missing source cannot be the existing destination and is skipped.  When
    identity can matter (a multiply-linked destination or an equivalent
    spelling), any other identity error is treated as a match (fail closed):
    an unreadable or transiently unavailable source must not turn uncertainty
    into permission to overwrite a possible alias.  Sources on another Windows
    drive or UNC root are skipped before ``realpath``/``stat`` because hard
    links cannot cross volumes; this preserves the no-SMB-timeout path for an
    offline source unrelated to a local save destination.
    """

    dest_norm = os.path.normcase(os.path.normpath(resolved_dest))
    dest_root = os.path.normcase(os.path.splitdrive(dest_norm)[0])
    candidates: list[str] = []
    unresolved_candidates: list[str] = []

    for raw in source_paths:
        try:
            candidate = os.path.normcase(os.path.abspath(raw))
        except (OSError, ValueError):
            continue
        if candidate == dest_norm:
            return True
        if os.path.normcase(os.path.splitdrive(candidate)[0]) != dest_root:
            continue
        try:
            real = os.path.realpath(raw)
        except ValueError:
            continue
        except OSError:
            # Preserve ordinary saves with an offline source.  Once the
            # destination is known below, uncertainty fails closed only when
            # it could actually conceal an alias (multiple links or an
            # equivalent spelling).
            unresolved_candidates.append(candidate)
            continue
        real_norm = os.path.normcase(os.path.normpath(real))
        if real == resolved_dest or real_norm == dest_norm:
            return True
        candidates.append(real)

    if not candidates and not unresolved_candidates:
        return False

    try:
        dest_stat = os.stat(resolved_dest)
    except (FileNotFoundError, NotADirectoryError):
        # A path that does not exist cannot yet be a hard-linked alias.
        return False
    except OSError:
        return True

    check_all_identities = dest_stat.st_nlink > 1
    dest_spelling = _spelling_key(dest_norm)
    if unresolved_candidates and (
        check_all_identities
        or any(_spelling_key(candidate) == dest_spelling for candidate in unresolved_candidates)
    ):
        return True
    for candidate in candidates:
        candidate_norm = os.path.normcase(os.path.normpath(candidate))
        if not check_all_identities and _spelling_key(candidate_norm) != dest_spelling:
            continue
        try:
            source_stat = os.stat(candidate)
        except (FileNotFoundError, NotADirectoryError):
            continue
        except OSError:
            return True
        if os.path.samestat(dest_stat, source_stat):
            return True
    return False
