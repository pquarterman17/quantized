"""Cut a growing text file's bytes back to its last COMPLETE line.

The live source watch (``routes/_liveimport.py``) re-reads a file an
instrument is still appending to. A buffered logger flushes mid-line, so the
bytes read can end in half a row ("1.5,2" of "1.5,2.75"), which a parser
would happily turn into a wrong number. :func:`complete_lines` drops that
unterminated tail from the bytes ACTUALLY read -- not from an earlier peek at
the file, which a writer can outrun between the peek and the read.

Encoding-aware in the same way :func:`quantized.io.base.decode_text` is: a
UTF-16 byte-order mark means two-byte code units (a ``\\n`` is ``0A 00`` in
little-endian, so a byte search for ``\\n`` would cut a character in half and
a NUL in the tail means nothing); everything else is ASCII-compatible
(UTF-8, latin-1), where the line terminators are single bytes. ``\\n``,
``\\r\\n`` and a bare ``\\r`` (classic Mac / some instrument exports) all end
a line. A file ending in ``\\r`` keeps that line: its content is complete
whichever terminator follows, and the next read re-parses the whole file.

:func:`snapshot_text` is the live re-read itself: one read of the bytes, a
stat before and after it (any change -> :class:`FileChangedError`), then the
cut. The route (``routes/_liveimport.py``) only maps these to HTTP.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "FileChangedError",
    "NoCompleteLineError",
    "TextSnapshot",
    "complete_lines",
    "ensure_unchanged",
    "sha256_file",
    "snapshot_text",
    "source_stamp",
]

_UTF16_LE_BOM = b"\xff\xfe"
_UTF16_BE_BOM = b"\xfe\xff"


def _cut_utf16(raw: bytes, *, little: bool) -> int:
    """End offset of the last complete UTF-16 line, BOM included (2 = none)."""
    nl = b"\n\x00" if little else b"\x00\n"
    cr = b"\r\x00" if little else b"\x00\r"
    end = len(raw) - (len(raw) % 2)  # a trailing odd byte is half a code unit
    pos = end - 2
    while pos >= 2:  # offset 0 is the BOM
        unit = raw[pos : pos + 2]
        if unit in (nl, cr):
            return pos + 2
        pos -= 2
    return 2


def complete_lines(raw: bytes) -> tuple[bytes, bool]:
    """``(bytes up to and including the last line terminator, whether a tail was dropped)``.

    A buffer with no terminator at all is ALL partial: ``(b"", True)`` (or the
    bare byte-order mark, which parses as an empty file). An empty buffer, or
    one already ending in a terminator, comes back unchanged with ``False``.
    """
    if raw.startswith((_UTF16_LE_BOM, _UTF16_BE_BOM)):
        cut = _cut_utf16(raw, little=raw.startswith(_UTF16_LE_BOM))
        return (raw, False) if cut == len(raw) else (raw[:cut], True)
    cut = max(raw.rfind(b"\n"), raw.rfind(b"\r")) + 1
    if cut == len(raw):
        return raw, False
    return raw[:cut], True


# -- the live re-read's byte snapshot (routes/_liveimport.py adapts it to HTTP) --

_CHUNK = 1 << 20
#: What ``complete_lines`` keeps of a buffer with no complete line (a UTF-16 one keeps its BOM).
_NOTHING_KEPT = (b"", _UTF16_LE_BOM, _UTF16_BE_BOM)


class FileChangedError(Exception):
    """The file changed while it was being read: the read is not one consistent state."""


class NoCompleteLineError(Exception):
    """A held read of a file that has no complete line yet: nothing to parse."""


@dataclass(frozen=True)
class TextSnapshot:
    """One consistent read of a text file, cut back to its last complete line."""

    data: bytes
    stat: os.stat_result
    checksum: str  # "sha256:<hex>" of ALL the bytes read (the file, not just ``data``)
    held: bool


def source_stamp(st: os.stat_result) -> str:
    """The change stamp the watcher compares: mtime, size and identity (inode +
    ctime), so a same-size, same-mtime replacement still reads as changed."""
    return f"{st.st_mtime_ns}:{st.st_size}:{st.st_ino}:{st.st_ctime_ns}"


def sha256_file(path: str | Path) -> str:
    """``sha256:<hex>`` of a whole file, read in chunks (bounded memory)."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:  # noqa: PTH123 -- callers pass an already-confined path
        for chunk in iter(lambda: fh.read(_CHUNK), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def ensure_unchanged(path: Path, before: os.stat_result) -> None:
    """Raise :class:`FileChangedError` when ``path`` no longer has ``before``'s stamp."""
    if source_stamp(os.stat(path)) != source_stamp(before):
        raise FileChangedError(path.name)


def snapshot_text(path: Path, *, hold_partial: bool) -> TextSnapshot:
    """Read ``path`` once, refuse a read the file changed under, and (``hold_partial``)
    cut an unterminated last line from the bytes actually read."""
    before = os.stat(path)
    raw = path.read_bytes()
    ensure_unchanged(path, before)
    kept, held = complete_lines(raw) if hold_partial else (raw, False)
    if held and kept in _NOTHING_KEPT:
        raise NoCompleteLineError(path.name)
    return TextSnapshot(kept, before, f"sha256:{hashlib.sha256(raw).hexdigest()}", held)
