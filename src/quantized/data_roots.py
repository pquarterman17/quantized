"""The allowed data folders: where the app may read user data from by path.

The user's home, the current working directory, and the system temp dir,
widened with the ``QZ_DATA_ROOTS`` env var (``os.pathsep``-separated). The
path-import routes (``routes/parsers.py`` and the routes that reuse its
``_allowed_prefixes``) gate every read on this list, and Pack Project flags
a declared source outside it before copying it into a shareable bundle.

Pure library: no fastapi/pydantic imports, so the desktop bridge can use it
without pulling in the HTTP layer.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

__all__ = ["allowed_data_prefixes", "allowed_data_roots", "is_inside_data_roots"]


def allowed_data_roots() -> tuple[str, ...]:
    """Real (symlink-resolved) absolute paths of the allowed data folders."""
    raw = [Path.home(), Path.cwd(), Path(tempfile.gettempdir())]
    raw += [Path(p) for p in os.environ.get("QZ_DATA_ROOTS", "").split(os.pathsep) if p.strip()]
    roots: list[str] = []
    for r in raw:
        try:
            roots.append(os.path.realpath(r))
        except OSError:
            continue
    return tuple(roots)


def allowed_data_prefixes() -> tuple[str, ...]:
    """``allowed_data_roots`` as separator-terminated prefixes, so
    ``startswith`` is a true containment test (``/data/`` never matches
    ``/data-other/``). See ``routes/parsers.py``'s ``_allowed_prefixes``."""
    return tuple(root.rstrip(os.sep) + os.sep for root in allowed_data_roots())


def is_inside_data_roots(path: str) -> bool:
    """True when ``path`` resolves (symlinks followed) inside an allowed root."""
    try:
        resolved = os.path.realpath(path)
    except (OSError, ValueError):
        return False
    return resolved.startswith(allowed_data_prefixes())
