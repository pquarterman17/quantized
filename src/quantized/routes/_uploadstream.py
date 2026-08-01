"""Bounded, chunked streaming of an uploaded file to disk.

ROBUSTNESS_PLAN #3 / ``local-server-hardening.md`` §2: never buffer a whole
upload in memory (``await file.read()``), and reject anything past a
generous, evidence-based per-file cap before it lands on disk. Starlette
already spools large uploads to a temp file on its own side, so the single
``.read()`` this replaces was the entire memory spike, not a necessary one.

Pure I/O -- no fastapi/starlette import, so this is unit-testable with a
plain fake reader instead of a real ``UploadFile``/TestClient round trip.
Starlette's ``UploadFile`` satisfies :class:`AsyncChunkReader` structurally
(``async def read(self, size: int = -1) -> bytes``), so routes pass it
straight through.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

__all__ = [
    "CHUNK_SIZE",
    "MAX_UPLOAD_BYTES",
    "AsyncChunkReader",
    "UploadTooLargeError",
    "stream_to_path",
]

# 1 MiB -- the local-server-hardening.md pattern:
#   while chunk := await up.read(1 << 20): ...
CHUNK_SIZE = 1 << 20

# Evidence (ROBUSTNESS_PLAN #3, corpus measured 2026-07-31): the largest real
# file in the instrument corpus (../test-data) is PNR.opj, an Origin project
# at ~127.5 MB; 1M-row CSV imports run ~70-100 MB
# (docs/performance_envelope.md: "CSV import 1M×8 ... 70.0 MB"). 512 MiB
# is ~4x headroom over the largest known real file -- generous for what this
# app actually imports, not a generic web-service default. Referenced by
# call-time lookup (never baked into a default parameter), so tests can
# monkeypatch this module attribute and have it take effect.
MAX_UPLOAD_BYTES = 512 * 1024 * 1024


class UploadTooLargeError(ValueError):
    """Raised when a streamed upload exceeds its byte cap.

    Subclasses ``ValueError`` (matching ``OriginProjectError`` / ``CodecError``
    elsewhere in ``io/``), but routes must catch it BEFORE the generic
    ``ValueError`` handler so it maps to 413, not 422.
    """

    def __init__(self, filename: str, limit: int) -> None:
        self.filename = filename
        self.limit = limit
        super().__init__(f"{filename!r} exceeds the {limit // (1024 * 1024)} MB upload limit")


class AsyncChunkReader(Protocol):
    """Structural type for anything streamable in fixed-size chunks.

    Starlette's ``UploadFile`` satisfies this without needing to be imported
    here (which would violate the pure-layer no-fastapi/starlette rule).
    """

    async def read(self, size: int = -1) -> bytes: ...


async def stream_to_path(
    source: AsyncChunkReader,
    dest: Path,
    *,
    filename: str,
    max_bytes: int | None = None,
    chunk_size: int = CHUNK_SIZE,
) -> int:
    """Copy ``source`` to ``dest`` in ``chunk_size``-byte chunks.

    Holds at most one chunk in memory at a time. Aborts once the running
    total exceeds ``max_bytes`` (default :data:`MAX_UPLOAD_BYTES`, resolved
    at call time so tests can override the module constant). On overflow the
    partial file is deleted and :class:`UploadTooLargeError` is raised --
    callers (routes) translate that to HTTP 413. Returns the total bytes
    written on success.
    """
    limit = MAX_UPLOAD_BYTES if max_bytes is None else max_bytes
    total = 0
    try:
        with dest.open("wb") as out:
            while chunk := await source.read(chunk_size):
                total += len(chunk)
                if total > limit:
                    raise UploadTooLargeError(filename, limit)
                out.write(chunk)
    except UploadTooLargeError:
        # The `with` block's __exit__ already closed the handle by the time
        # this except runs, so unlinking here is safe on Windows too (an
        # open handle blocks deletion there).
        dest.unlink(missing_ok=True)
        raise
    return total
