"""Synthetic CPYUA (``.opju``) byte builders for the structural-reader tests.

Not a test module (the name never matches ``python_files``) -- same
convention as ``tests/unc_fakes.py``. Every builder writes the layout the
reader documents (``docs/origin_project_format.md`` §3.5/§3.6); nothing here
is copied from a real project file, so the fixtures are safe to commit.

Layout modelled::

    80 <clen:varint> <token stream>          the 147-byte column header,
                                             run-length coded
    18 <u64 24> <u64 body_len> <checksum>    the length block (omitted for
                                             the pre-4.33 form; 0x22-filled
                                             for the length-less classes)
    0a <mode 04|05> <rows:varint> <body>     the record
    [<len> 01 #_MSER_STRINGS_PSET 05 01 …]   the string heap (LZ4 block)
"""

from __future__ import annotations

import math
import struct

HEADER_LEN = 147


def varint(v: int) -> bytes:
    out = bytearray()
    while True:
        b7 = v & 0x7F
        v >>= 7
        out.append(b7 | (0x80 if v else 0))
        if not v:
            return bytes(out)


def zz(n: int) -> bytes:
    """ZigZag-encode a signed int as a varint."""
    return varint((n << 1) if n >= 0 else ((-n) << 1) - 1)


def rle(raw: bytes) -> bytes:
    """Run-length token stream for ``raw`` (literal / zero-run / fill-run)."""
    out = bytearray()
    lit = bytearray()

    def flush() -> None:
        while lit:
            chunk = bytes(lit[:127])
            del lit[:127]
            out.append(len(chunk))
            out.extend(chunk)

    i = 0
    while i < len(raw):
        j = i
        while j < len(raw) and raw[j] == raw[i] and j - i < 66:
            j += 1
        if j - i >= 3:
            flush()
            if raw[i] == 0:
                out.append(0x80 | (j - i - 3))
            else:
                out.extend((0xC0 | (j - i - 3), raw[i]))
            i = j
        else:
            lit.append(raw[i])
            i += 1
    flush()
    return bytes(out)


def block(raw: bytes) -> bytes:
    """``80 <clen:varint> <tokens>`` — one run-length block.

    The header reader accepts the one-byte length (``0x10..0x7f``) and the
    two-byte varint ``[80-ff] 01`` (128..255): a 147-byte header's token
    stream is at most 149 bytes, so nothing longer can occur, and the builder
    refuses to write a length the reader would not read."""
    tokens = rle(raw)
    if len(tokens) > 0xFF:
        raise ValueError(f"a header token stream of {len(tokens)} bytes cannot occur")
    return b"\x80" + varint(len(tokens)) + tokens


def header(
    name: str,
    *,
    kind: int,
    total: int,
    used: int,
    size: int,
    flags: int = 0,
    noise: bool = False,
) -> bytes:
    """The 147-byte column-storage header (only the fields the reader uses).

    ``noise=True`` fills the bytes the reader ignores with a non-repeating
    pattern, so the run-length coder finds no runs and the token stream
    exceeds 127 bytes (the two-byte length form)."""
    if noise:
        h = bytearray((i * 37 + 11) % 251 + 1 for i in range(HEADER_LEN))
    else:
        h = bytearray(HEADER_LEN)
    h[0x02] = 0x01
    h[0x16] = 0x21
    h[0x17] = kind
    h[0x19:0x1D] = total.to_bytes(4, "little")
    h[0x21:0x25] = used.to_bytes(4, "little")
    h[0x3D] = size
    h[0x3F] = flags
    nm = name.encode("latin1")
    h[0x58 : 0x58 + len(nm)] = nm
    if noise:
        h[0x58 + len(nm)] = 0x00  # the name's terminator
    return bytes(h)


def dataset(
    name: str,
    body: bytes,
    *,
    kind: int,
    total: int,
    used: int,
    size: int,
    flags: int = 0,
    mode: int = 5,
    length: bool | int = True,
    length_block: bool = True,
    attach: bytes = b"\x00",
    noise: bool = False,
) -> bytes:
    """One dataset: header block + (length block) + record + attachment.

    ``length=True`` writes the true body length, ``False`` the ``0x22`` fill
    of the length-less storage classes, an ``int`` a deliberately wrong
    length; ``length_block=False`` is the pre-4.33 form (lead ``00``).
    """
    rec = bytes([mode]) + varint(total) + body
    out = block(
        header(name, kind=kind, total=total, used=used, size=size, flags=flags, noise=noise)
    )
    if not length_block:
        return out + b"\x00" + rec + attach
    if length is False:
        fields = b"\x22" * 16
    else:
        n = len(rec) if length is True else int(length)
        fields = n.to_bytes(8, "little") + checksum(rec)
    return out + b"\x18" + (24).to_bytes(8, "little") + fields + b"\x0a" + rec + attach


def checksum(body: bytes) -> bytes:
    """The record checksum (the documented Fletcher-style pair over
    little-endian u32 words, the last zero-padded), written independently of
    the reader's numpy version."""
    padded = body + bytes(-len(body) % 4)
    a = b = 0
    for i in range(0, len(padded), 4):
        a = (a + int.from_bytes(padded[i : i + 4], "little")) & 0xFFFFFFFF
        b = (b + a) & 0xFFFFFFFF
    return a.to_bytes(4, "little") + b.to_bytes(4, "little")


def spec(x: float) -> bytes:
    """A value-spec: bare zero / missing tag, else the shortest top-n form."""
    if isinstance(x, float) and math.isnan(x):
        return b"\x65"
    if x == 0.0:
        return b"\x64"
    raw = struct.pack("<d", x)
    n = 8
    while n > 1 and raw[8 - n] == 0:
        n -= 1
    return bytes([8 + 9 * n]) + raw[8 - n :]


def fpc(values: list[float]) -> bytes:
    """``0c`` + the canonical-FPC stream the decoder implements."""
    mask = (1 << 64) - 1
    fcm: dict[int, int] = {}
    dfcm: dict[int, int] = {}
    fh = dh = last = 0
    nibbles: list[int] = []
    payloads: list[bytes] = []
    for x in values:
        val = struct.unpack("<Q", struct.pack("<d", x))[0]
        xor_f = val ^ fcm.get(fh, 0)
        xor_d = val ^ ((last + dfcm.get(dh, 0)) & mask)
        use_d = xor_d < xor_f
        resid = xor_d if use_d else xor_f
        nbytes = (resid.bit_length() + 7) // 8
        if nbytes == 4:
            nbytes = 5  # canonical FPC skips the 4-byte case
        nibbles.append((nbytes if nbytes < 4 else nbytes - 1) | (0x8 if use_d else 0))
        payloads.append(resid.to_bytes(8, "little")[:nbytes])
        stride = (val - last) & mask
        fcm[fh] = val
        dfcm[dh] = stride
        fh = ((fh << 6) ^ (val >> 48)) & 0xFFF
        dh = ((dh << 2) ^ (stride >> 40)) & 0xFFF
        last = val
    if len(nibbles) % 2:
        nibbles.append(0)
    out = bytearray(b"\x0c")
    for i in range(0, len(nibbles), 2):
        out.append(nibbles[i] | (nibbles[i + 1] << 4))
        for k in (i, i + 1):
            if k < len(values):
                out += payloads[k]
    return bytes(out)


def seg_fpc(values: list[float]) -> bytes:
    return zz(-len(values)) + fpc(values)


def seg_repeat(count: int, *values: float) -> bytes:
    return zz(count) + b"".join(spec(v) for v in values)


def cell_num(x: float) -> bytes:
    return b"\x00\x00" + spec(x)


def cell_text(ref: int) -> bytes:
    return b"\x01\x00" + varint(ref)


def run_num(n: int, segments: bytes) -> bytes:
    return b"\xff\xff" + varint(n) + b"\x00" + segments


def run_text(n: int, segments: bytes) -> bytes:
    return b"\xff\xff" + varint(n) + b"\x01" + segments


CELLS_END = b"\xce\xfa"


def heap(strings: list[str], *, before: bytes = b"") -> tuple[bytes, dict[str, int]]:
    """The attachment block holding the ``#_MSER_STRINGS_PSET`` entry for
    ``strings`` (after any ``before`` entries) plus the cell reference
    (1 + byte offset) of each string."""
    data = bytearray()
    refs: dict[str, int] = {}
    for s in strings:
        refs[s] = len(data) + 1
        data += s.encode("utf-8") + b"\x00"
    raw = (
        b"\x77\x11\x11\x11\x02\x00\x01\x00"
        + (4).to_bytes(4, "little")
        + (1).to_bytes(4, "little")
        + len(data).to_bytes(4, "little")
        + len(strings).to_bytes(4, "little")
        + bytes(data)
        + bytes(4)
    )
    lz4 = lz4_literals(raw)
    payload = (
        b"\x01"
        + before
        + b"#_MSER_STRINGS_PSET\x05\x01"
        + varint(4 + len(lz4))
        + b"\x00"
        + len(raw).to_bytes(4, "little")
        + lz4
        + b"\x00"
    )
    return varint(len(payload)) + payload, refs


def lz4_literals(raw: bytes) -> bytes:
    """``raw`` as a single literals-only LZ4 sequence."""
    n = len(raw)
    if n < 15:
        return bytes([n << 4]) + raw
    out = bytearray([0xF0])
    rest = n - 15
    while rest >= 255:
        out.append(255)
        rest -= 255
    out.append(rest)
    return bytes(out) + raw


def project(*datasets: bytes, tail: bytes = b"") -> bytes:
    """A minimal CPYUA file: header line + datasets + windows-section tail."""
    return b"CPYUA 4.3380 188\n" + b"\x00\x0a" + b"\x00\x00\x00".join(datasets) + tail
