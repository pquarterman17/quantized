"""Cut a growing text file's bytes back to its last COMPLETE line (pure).

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
"""

from __future__ import annotations

__all__ = ["complete_lines"]

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
