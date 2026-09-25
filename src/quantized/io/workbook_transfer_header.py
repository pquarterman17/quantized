"""On-disk header of one large-workbook transfer package (Group F).

Split out of :mod:`quantized.io.workbook_transfer_store` (500-line module
ceiling): this is the read-only half -- encode a header, and classify a
package file by reading one back. It never writes or removes anything; the
store owns every filesystem write.

A package file is a FIXED ``HEADER_BYTES`` block -- ASCII JSON padded with
spaces and terminated by ``\\n`` -- followed by the payload bytes verbatim.
Fixed width lets the writer reserve it before the payload streams in and
fill it once the size is known, and lets a reader find the payload without
parsing anything else.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

__all__ = [
    "HEADER_BYTES",
    "HEADER_FORMAT",
    "HEADER_VERSION",
    "Entry",
    "encode_header",
    "read_entry",
    "token_digest",
]

HEADER_FORMAT = "quantized-transfer-store"
HEADER_VERSION = 1
HEADER_BYTES = 1024
_DIGEST_RE = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True)
class Entry:
    """A readable package of this format and version."""

    package_id: str
    path: Path
    created_at: float
    expires_at: float
    size: int
    token_sha256: str


def token_digest(token: str) -> str:
    """SHA-256 of a token -- what is stored, never the token itself."""
    return hashlib.sha256(token.encode("utf-8", "surrogatepass")).hexdigest()


def encode_header(*, created_at: float, expires_at: float, size: int, token: str) -> bytes:
    """The fixed-width header block for a package of ``size`` bytes."""
    header = json.dumps(
        {
            "format": HEADER_FORMAT,
            "version": HEADER_VERSION,
            "created_at": created_at,
            "expires_at": expires_at,
            "size": size,
            "token_sha256": token_digest(token),
        },
        separators=(",", ":"),
    ).encode("ascii")
    return header.ljust(HEADER_BYTES - 1) + b"\n"


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def read_entry(path: Path) -> Entry | str:
    """The package header at ``path``, or why not: ``"gone"`` (unreadable --
    removed, or in use), ``"foreign"`` (not a header this build knows:
    another format or version, or no header at all), or ``"corrupt"`` (THIS
    format and version, but inconsistent -- e.g. a payload length that
    disagrees with the header, which an atomic publish never produces, or a
    digest that is not 64 hex digits, which ``hmac.compare_digest`` would
    raise TypeError on if it were non-ASCII)."""
    try:
        with path.open("rb") as fh:
            head = fh.read(HEADER_BYTES)
            total = os.fstat(fh.fileno()).st_size
    except OSError:
        return "gone"
    if len(head) < HEADER_BYTES or not head.endswith(b"\n"):
        return "foreign"
    try:
        header = json.loads(head.decode("ascii"))
    except (UnicodeDecodeError, ValueError):
        return "foreign"
    if (
        not isinstance(header, dict)
        or header.get("format") != HEADER_FORMAT
        or header.get("version") != HEADER_VERSION
    ):
        return "foreign"
    created, expires = _num(header.get("created_at")), _num(header.get("expires_at"))
    size, digest = header.get("size"), header.get("token_sha256")
    if (
        created is None
        or expires is None
        or not isinstance(size, int)
        or not isinstance(digest, str)
        or _DIGEST_RE.fullmatch(digest) is None
        or total - HEADER_BYTES != size
    ):
        return "corrupt"
    return Entry(path.stem, path, created, expires, size, digest)
