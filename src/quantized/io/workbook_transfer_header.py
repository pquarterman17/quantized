"""On-disk header of one large-workbook transfer package (Group F).

Split out of :mod:`quantized.io.workbook_transfer_store` (500-line module
ceiling): the read-only half -- encode a header, classify a package file
by reading one back -- plus the store's value types and errors. It never
writes or removes anything; the store owns every filesystem write.

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
    "PACKAGE_SUFFIX",
    "CleanupReport",
    "EmptyPackage",
    "Entry",
    "InvalidPackageId",
    "PackageExpired",
    "PackageNotFound",
    "PackageTooLarge",
    "PackageTooSmall",
    "StoreFull",
    "StoredPackage",
    "TransferStoreError",
    "encode_header",
    "is_package_name",
    "is_valid_package_id",
    "read_entry",
    "token_digest",
]

HEADER_FORMAT = "quantized-transfer-store"
HEADER_VERSION = 1
HEADER_BYTES = 1024
_DIGEST_RE = re.compile(r"[0-9a-f]{64}")
PACKAGE_SUFFIX = ".qzxfer"
_ID_RE = re.compile(r"[0-9a-f]{32}")


class TransferStoreError(Exception):
    """Base class: the store could not do what was asked."""


class InvalidPackageId(TransferStoreError):
    """The id is not a well-formed package id (never forms a path)."""


class PackageTooLarge(TransferStoreError):
    """The package exceeds the per-package byte cap."""


class EmptyPackage(TransferStoreError):
    """A zero-byte package was offered."""


class PackageTooSmall(TransferStoreError):
    """Smaller than any package the client ever stores (it copies inline
    below 8 M characters) -- refused so junk cannot occupy entry slots."""


class StoreFull(TransferStoreError):
    """The entry cap is reached with unexpired packages, or in-flight writes
    leave no room. Refused rather than evicting someone's live copy."""


class PackageNotFound(TransferStoreError):
    """No such package, or the token does not match (deliberately the same
    answer, so a wrong token is not an existence oracle)."""


class PackageExpired(TransferStoreError):
    """The package existed, the token matched, but its lifetime is over."""


@dataclass(frozen=True)
class StoredPackage:
    package_id: str
    token: str
    size: int
    created_at: float
    expires_at: float


@dataclass(frozen=True)
class CleanupReport:
    expired: int = 0
    stale: int = 0
    corrupt: int = 0


@dataclass(frozen=True)
class Entry:
    """A readable package of this format and version."""

    package_id: str
    path: Path
    created_at: float
    expires_at: float
    size: int
    token_sha256: str


def is_valid_package_id(package_id: object) -> bool:
    return isinstance(package_id, str) and _ID_RE.fullmatch(package_id) is not None


def is_package_name(name: str) -> bool:
    """``<32 hex>.qzxfer`` -- the only package names the store touches."""
    return name.endswith(PACKAGE_SUFFIX) and is_valid_package_id(name[: -len(PACKAGE_SUFFIX)])


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
