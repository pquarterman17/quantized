"""The vectorised / indexed Origin import helpers answer exactly what the scalar
code they replaced answered (synthetic bytes; no timing)."""

from __future__ import annotations

import random

import numpy as np

from quantized.io.origin_project import opju_codec
from quantized.io.origin_project.opju_anchor_index import AnchorSearcher
from quantized.io.origin_project.opju_blocks import find_headers


def _noise(rng: random.Random, n: int) -> bytearray:
    # zero-heavy so the 00 00 / NUL shapes occur by chance too
    return bytearray(rng.choice((0, 0, 0, 65, 66, 255, 7)) for _ in range(n))


def test_anchor_searcher_matches_bytes_find() -> None:
    rng = random.Random(7)
    names = [b"Book1", b"Sheet_A", b"abcd", b"x", b"Zz\xe9q", b"A" * 70, b"Book12"]
    for _trial in range(4):
        buf = _noise(rng, 5000)
        for _ in range(40):
            nm = rng.choice(names)
            at = rng.randrange(0, len(buf) - 100)
            if rng.random() < 0.5:
                pat = bytes([len(nm) + 2]) + b"\x00\x00" + nm
            else:
                pat = bytes([len(nm) + 1]) + nm + b"\x00"
            buf[at : at + len(pat)] = pat
        b = bytes(buf)
        from_pos = 300
        searcher = AnchorSearcher(b, from_pos)
        for _q in range(60):  # past the direct-query threshold: the index is used
            for nm in [*names, b"missing", b"Boo"]:
                for sf in (from_pos, from_pos + rng.randrange(0, 4000)):
                    p1 = bytes([len(nm) + 2]) + b"\x00\x00" + nm
                    p2 = bytes([len(nm) + 1]) + nm + b"\x00"
                    assert searcher.find_form1(nm, sf) == b.find(p1, sf)
                    if len(nm) >= 4:
                        assert searcher.find_form2(nm, sf) == b.find(p2, sf)
            if _q > 2:
                break
        assert searcher.find_form1(b"Book1", 0) == b.find(b"\x07\x00\x00Book1", 0)  # below index


def _decode_reference(stream: bytes, nrows: int) -> tuple[list[int], int]:
    """The scalar FPC decode as it was before the locals were hoisted."""
    mask = (1 << 64) - 1
    fcm: dict[int, int] = {}
    dfcm: dict[int, int] = {}
    fh = dh = last = pos = 0
    out: list[int] = []
    while len(out) < nrows:
        ctrl = stream[pos]
        pos += 1
        for nibble in (ctrl & 0xF, ctrl >> 4):
            c = nibble & 7
            width = c if c < 4 else c + 1
            resid = int.from_bytes(stream[pos : pos + width] + b"\x00" * (8 - width), "little")
            pos += width
            pred = (last + dfcm.get(dh, 0)) & mask if nibble & 8 else fcm.get(fh, 0)
            val = pred ^ resid
            out.append(val)
            stride = (val - last) & mask
            fcm[fh] = val
            dfcm[dh] = stride
            fh = ((fh << opju_codec._FCM_SHIFT) ^ (val >> opju_codec._FCM_DROP)) & (
                opju_codec._TABLE_MASK
            )
            dh = ((dh << opju_codec._DFCM_SHIFT) ^ (stride >> opju_codec._DFCM_DROP)) & (
                opju_codec._TABLE_MASK
            )
            last = val
            if len(out) >= nrows:
                break
    return out, pos


def test_fpc_decode_matches_scalar_reference() -> None:
    rng = random.Random(3)
    for nrows in (1, 2, 7, 64, 301):
        stream = bytes(rng.randrange(256) for _ in range(nrows * 9 + 16))
        vals, used = opju_codec._decode(stream, nrows)
        ref, ref_used = _decode_reference(stream, nrows)
        assert used == ref_used
        raw = np.asarray(ref, dtype="<u8").tobytes()
        want = np.frombuffer(raw, dtype="<f8").copy()
        want[want == opju_codec.ORIGIN_MISSING] = np.nan
        assert np.array_equal(vals, want, equal_nan=True)


def test_find_headers_memo_serves_the_same_answer_and_unread() -> None:
    b = bytes(random.Random(1).randrange(256) for _ in range(4000))
    first_unread: list[tuple[str, int]] = []
    first = find_headers(b, first_unread)
    again_unread: list[tuple[str, int]] = []
    again = find_headers(b, again_unread)
    assert again == first and again_unread == first_unread
    again.append(None)  # type: ignore[arg-type]  # a caller's list is its own
    assert find_headers(b) == first
