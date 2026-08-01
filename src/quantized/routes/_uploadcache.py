"""Bounded, on-disk staging for multi-book Origin project uploads (lazy
per-book transport, ``ORIGIN_FILE_DECODE_PLAN`` #38).

``/api/parsers/upload``'s ordinary path stages the file in an ephemeral
``tempfile.TemporaryDirectory`` that is deleted before the response returns --
fine for a one-shot full import, but a lazy import needs the bytes to survive
until the browser later activates a non-primary book and fetches its full
data (``routes/books.py``). Origin project uploads are staged here instead: a
stable temp path plus an opaque token the frontend echoes back on that fetch.

Bounded to the last few uploads (LRU eviction, by unlinking the oldest staged
file once the count is exceeded) -- this is a single-user desktop tool, not a
multi-tenant server, so keeping a handful of recent uploads on disk is cheap
and avoids unbounded growth from repeated re-imports.
"""

from __future__ import annotations

import secrets
import tempfile
from collections import OrderedDict
from pathlib import Path

from quantized.routes._uploadstream import AsyncChunkReader, UploadTooLargeError, stream_to_path

__all__ = ["stage_upload", "stage_upload_stream", "resolve_upload_token"]

_MAX_STAGED = 8
_root = Path(tempfile.gettempdir()) / "qz_origin_uploads"
_tokens: OrderedDict[str, Path] = OrderedDict()


def _reserve(name: str) -> tuple[Path, str]:
    """A fresh token's own subdirectory (so same-name re-uploads never
    collide) and the destination path within it, not yet registered."""
    _root.mkdir(parents=True, exist_ok=True)
    token = secrets.token_hex(8)
    staged_dir = _root / token
    staged_dir.mkdir(parents=True, exist_ok=True)
    return staged_dir / name, token


def _commit(token: str, dest: Path) -> None:
    """Register a successfully-staged upload and evict the oldest once more
    than ``_MAX_STAGED`` are held."""
    _tokens[token] = dest
    _tokens.move_to_end(token)
    while len(_tokens) > _MAX_STAGED:
        _, old_path = _tokens.popitem(last=False)
        old_path.unlink(missing_ok=True)
        try:
            old_path.parent.rmdir()
        except OSError:
            pass  # not empty / already gone -- best-effort cleanup only


def stage_upload(name: str, content: bytes) -> tuple[Path, str]:
    """Persist an already-in-memory ``content`` and return ``(path, token)``.

    For callers that already have the whole upload as ``bytes`` (tests, and
    any future non-streaming caller). New HTTP upload paths should prefer
    :func:`stage_upload_stream`, which never holds the whole file in memory.
    """
    dest, token = _reserve(name)
    dest.write_bytes(content)
    _commit(token, dest)
    return dest, token


async def stage_upload_stream(
    name: str, source: AsyncChunkReader, *, max_bytes: int | None = None
) -> tuple[Path, str]:
    """Streaming counterpart of :func:`stage_upload`.

    Writes ``source`` to disk in bounded chunks (``_uploadstream.stream_to_path``)
    instead of holding the whole upload in memory first, then registers the
    staged path the same way. On an oversize upload the partial file and its
    token directory are cleaned up and :class:`UploadTooLargeError` propagates
    for the route to translate to HTTP 413.
    """
    dest, token = _reserve(name)
    try:
        await stream_to_path(source, dest, filename=name, max_bytes=max_bytes)
    except UploadTooLargeError:
        try:
            dest.parent.rmdir()
        except OSError:
            pass  # not empty / already gone -- best-effort cleanup only
        raise
    _commit(token, dest)
    return dest, token


def resolve_upload_token(token: str) -> Path | None:
    """The staged file path for ``token``, or ``None`` if unknown, expired
    (evicted), or the file has since been removed out-of-band."""
    path = _tokens.get(token)
    if path is None or not path.is_file():
        return None
    return path
