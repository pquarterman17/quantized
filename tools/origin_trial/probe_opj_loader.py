"""Item-34 loader-RE probe kit: does real Origin load a crafted `.opj`?

Builds variant files from the local corpus (Moke.opj + SLD_DoubleY.otp) and
loads each through one COM instance, printing ``RESULT <name> load= books=``
lines. The probe matrix, derived loader model, and decoded tail grammar live
in ``docs/origin_re/validation_log.md`` (2026-07-04 entry) — read that first.

Usage (one COM script at a time; taskkill Origin64.exe if a variant hangs a
modal in the invisible instance):

    uv run python tools/origin_trial/probe_opj_loader.py build
    uv run python tools/origin_trial/probe_opj_loader.py run P1_moke_copy.opj ...

Variants land in ``../test-data/origin/probes/`` (local corpus — never
pushed). ``build`` re-creates the informative subset of the 2026-07-04
matrix; extend ``build_variants`` for the next iteration (window-section
boundary re-cut — see the validation log's "Open blocker").
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

CORPUS = Path(r"C:\Users\patri\OneDrive\Coding\git\test-data\origin")
PROBES = CORPUS / "probes"
MOKE_TRAILER = 645420  # Parameters-section start in Moke.opj (v4.3380)
OTP_TAIL = 90422  # global-storage epilogue start in SLD_DoubleY.otp
FH_SIZE_FIELD = 22 + 5 + 115  # u32 file-size field inside the 123B fh block


def _blk(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


_NULL = b"\x00\x00\x00\x00\n"


def _fix_size(data: bytes) -> bytes:
    out = bytearray(data)
    struct.pack_into("<I", out, FH_SIZE_FIELD, len(out))
    return bytes(out)


def synth_tail(moke_tail: bytes, otp_tail: bytes, *, project: bytes, n_windows: int) -> bytes:
    """The minimal synthesized post-stream tail (PS1/PR2 recipe, unproven —
    blocked on the stream-side books=0 issue; see the validation log)."""
    t = moke_tail
    out = bytearray()
    out += t[:58]  # params + 00 0a terminator
    out += _NULL + _blk(t[68:156]) + _NULL  # project record + empty note list
    out += _blk(struct.pack("<I", 0x46C)) + _blk(t[1969:1985]) + _blk(t[1991:2023])
    out += _NULL + _blk(project + b"\x00")
    out += struct.pack("<I", 2) + b"\n"  # bare value fragment (not a size)
    out += _blk(t[2050:2086]) + _blk(t[2092:2187])  # 47/4D 11 11 11 records
    out += _blk(struct.pack("<I", 0)) + _blk(struct.pack("<I", 0))  # scalar, 0 subfolders
    out += _blk(struct.pack("<I", n_windows))
    for i in range(n_windows):
        out += _NULL + _blk(struct.pack("<II", 0, i)) + _NULL
    out += otp_tail  # global-storage epilogue + terminating nulls
    return bytes(out)


def build_variants() -> None:
    PROBES.mkdir(exist_ok=True)
    moke = (CORPUS / "Moke.opj").read_bytes()
    otp = (CORPUS / "SLD_DoubleY.otp").read_bytes()
    (PROBES / "P1_moke_copy.opj").write_bytes(moke)
    (PROBES / "P2_moke_no_trailer.opj").write_bytes(moke[:MOKE_TRAILER])
    (PROBES / "PT2_minus_last_byte.opj").write_bytes(moke[:-1])
    tail = synth_tail(moke[MOKE_TRAILER:], otp[OTP_TAIL:], project=b"Moke", n_windows=1)
    (PROBES / "PS_tail_only_demo.bin").write_bytes(tail)
    print(f"variants in {PROBES}")


# ---------------------------------------------------------------------------
# PN series (2026-07-07): the storage <-> stream CONSISTENCY hypothesis.
#
# Reframe of the 2026-07-04 results: "all four slots emptied -> False" ran on
# the FULL 19-window Moke, and PR6 (real epilogue on a 1-window stream) ->
# books=0. Both fit a consistency check (storage content must not reference
# more pages than the stream has), not a minimum-content rule. PR4's synth
# failed with the .otp epilogue — a GRAPH TEMPLATE's storage on a 1-workbook
# stream. Discriminating experiment: a 1-book stream + a project-shaped
# storage section that is EMPTY-but-well-formed (count=8, idx0..4 len 0,
# idx5/6/7 = the corpus-constant records).
# ---------------------------------------------------------------------------

# Byte-identical across Moke/XRD/MnN/SuperlatticeFits (map_opj_tail2 sweep):
_STORAGE_IDX5 = bytes.fromhex("3e111111" + "01000000" + "00" * 16)
_STORAGE_IDX6 = bytes(4)
_STORAGE_IDX7 = bytes.fromhex("5d111111" + "01000100" + "00" * 24)
_ID_BLOB = bytes.fromhex("de361003") + bytes(12)  # constant across the corpus


def _storage_record(idx: int, data: bytes) -> bytes:
    return (
        b"\x00\x10\x00\x00"
        + struct.pack("<II", idx, len(data))
        + bytes(16)
        + b"\n"
        + data
        + b"\n"
    )


def _storage_section(slots: dict[int, bytes] | None = None) -> bytes:
    """NULL + count record + 8 indexed records (idx0..7). ``slots`` overrides
    per-index content; default is empty idx0..4 + the constant idx5/6/7."""
    content = {5: _STORAGE_IDX5, 6: _STORAGE_IDX6, 7: _STORAGE_IDX7}
    if slots:
        content.update(slots)
    out = bytearray(_NULL)
    out += _blk(b"\x00\x10\x00\x00" + struct.pack("<I", 8))
    for idx in range(8):
        out += _storage_record(idx, content.get(idx, b""))
    return bytes(out)


def _walk_positions(b: bytes) -> list[tuple[int, int, bytes]]:
    """(pos, size, payload) for every stream block, ending at the tail break."""
    pos = b.find(b"\n") + 1
    out: list[tuple[int, int, bytes]] = []
    n = len(b)
    while pos + 5 <= n:
        size = int.from_bytes(b[pos : pos + 4], "little")
        if b[pos + 4] != 0x0A:
            break
        if size == 0:
            out.append((pos, 0, b""))
            pos += 5
            continue
        end = pos + 5 + size
        if end >= n or b[end] != 0x0A:
            break
        out.append((pos, size, b[pos + 5 : end]))
        pos = end + 1
    return out


def _block_span(blocks: list[tuple[int, int, bytes]], i: int) -> tuple[int, int]:
    pos, size, _ = blocks[i]
    return pos, pos + 5 + (size + 1 if size else 0)


def _is_real_window_header(payload: bytes) -> bool:
    import re

    if len(payload) < 150 or payload[0] or payload[1]:
        return False
    end = payload.find(b"\x00", 2, 66)
    if end <= 2:
        return False
    raw = payload[2:end]
    return bool(re.fullmatch(rb"[A-Za-z0-9][A-Za-z0-9_-]{0,62}", raw))


def _cut_book(moke: bytes, book: str) -> tuple[bytes, bytes]:
    """(dataset triples bytes, window-section bytes) for one workbook,
    cut from the real stream with the PR3 grammar."""
    blocks = _walk_positions(moke)
    prefix = f"{book}_".encode("latin1")
    triples = bytearray()
    for i, (_pos, size, payload) in enumerate(blocks):
        if size == 147 and payload[88 : 88 + len(prefix)] == prefix:
            s0, _ = _block_span(blocks, i - 1)  # leading NULL spacer
            _, e2 = _block_span(blocks, i + 1)  # data block
            assert blocks[i - 1][1] == 0, "expected NULL before column header"
            triples += moke[s0:e2]
    win_idx = [
        i
        for i, (_p, s, pl) in enumerate(blocks)
        if s and _is_real_window_header(pl) and pl[2 : 2 + len(book) + 1] != prefix
    ]
    hdr_i = next(
        i
        for i, (_p, s, pl) in enumerate(blocks)
        if s and _is_real_window_header(pl) and pl[2 : 3 + len(book)] == book.encode() + b"\x00"
    )
    nxt = next(i for i in win_idx if i > hdr_i)
    last = nxt - 1
    while blocks[last][1] == 0:
        last -= 1
    s0, _ = _block_span(blocks, hdr_i)
    _, e1 = _block_span(blocks, last)
    return bytes(triples), moke[s0:e1]


def _moke_tail_pieces(moke: bytes) -> dict[str, bytes]:
    """Params / project-record / tree building blocks parsed live from Moke's
    real tail (grammar: tree.py + validation_log.md)."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
    from quantized.io.origin_project.tree import (
        _find_tail_start,
        _read_block,
        _skip_notes,
        _skip_params,
    )

    t0 = _find_tail_start(moke)
    p = _skip_params(moke, t0)
    params = moke[t0:p]
    size, _pl, p2 = _read_block(moke, p)
    assert size == 0
    size, projrec, p2 = _read_block(moke, p2)
    p = _skip_notes(moke, p2)
    _s, _pl, p = _read_block(moke, p)  # leading scalar
    _s, _pl, p = _read_block(moke, p)  # id blob
    # root folder pieces
    s, hdr32, p = _read_block(moke, p)
    assert s == 32
    s, _pl, p = _read_block(moke, p)
    assert s == 0
    _s, name, p = _read_block(moke, p)
    assert moke[p : p + 4] == struct.pack("<I", 2)
    p += 5
    _s, attrs, p = _read_block(moke, p)
    _s, storage, p = _read_block(moke, p)
    return {
        "params": params,
        "projrec": projrec,
        "hdr32": hdr32,
        "root_name": name,
        "attrs": attrs,
        "folder_storage": storage,
    }


def _synth_tail2(
    pieces: dict[str, bytes],
    *,
    n_windows: int,
    with_note: bool,
    storage: bytes,
) -> bytes:
    tree = bytearray()
    tree += _blk(pieces["hdr32"]) + _NULL + _blk(pieces["root_name"])
    tree += struct.pack("<I", 2) + b"\n"
    tree += _blk(pieces["attrs"]) + _blk(pieces["folder_storage"])
    tree += _blk(struct.pack("<I", n_windows))
    for i in range(n_windows):
        tree += _NULL + _blk(struct.pack("<II", 0, i)) + _NULL
    tree += _blk(struct.pack("<I", 0))  # nsub
    out = bytearray()
    out += pieces["params"]
    out += _NULL + _blk(pieces["projrec"])
    if with_note:
        out += _blk(b"ResultsLog") + _blk(b" ")
    out += _NULL  # note-list terminator
    out += _blk(struct.pack("<I", 37 + len(tree))) + _blk(_ID_BLOB)
    out += tree
    out += storage
    return bytes(out)


def build_pn_variants() -> None:
    PROBES.mkdir(exist_ok=True)
    moke = (CORPUS / "Moke.opj").read_bytes()
    hdr_line_end = moke.find(b"\n") + 1
    fh_end = hdr_line_end + 5 + 123 + 1
    head = moke[:fh_end]
    triples, winsec = _cut_book(moke, "Book2")
    pieces = _moke_tail_pieces(moke)
    stream = head + triples + _NULL * 2 + winsec + _NULL * 3

    real_storage_start = moke.rindex(b"\x00\x10\x00\x00\x08\x00\x00\x00") - 10
    real_storage = moke[real_storage_start:]
    real_idx0_start = moke.index(b"<OriginStorage><LAYMANAGE>", real_storage_start)
    real_idx0 = moke[real_idx0_start : moke.index(b"</OriginStorage>\x00", real_idx0_start) + 17]

    variants = {
        # empty-but-well-formed storage on a 1-book stream (the hypothesis)
        "PN1_min_storage.opj": _synth_tail2(
            pieces, n_windows=1, with_note=True, storage=_storage_section()
        ),
        # + count-0 skeletons for the idx2/idx3 binary families
        "PN2_skeleton23.opj": _synth_tail2(
            pieces,
            n_windows=1,
            with_note=True,
            storage=_storage_section(
                {
                    2: bytes.fromhex("25111111000001000000000000000000") + bytes(4),
                    3: bytes.fromhex("28111111000001000000000000000000") + bytes(4),
                }
            ),
        ),
        # Moke's real idx0 dialog-state XML (references windows the stream
        # lacks) — tests whether idx0 content is lax
        "PN3_real_idx0.opj": _synth_tail2(
            pieces, n_windows=1, with_note=True, storage=_storage_section({0: real_idx0})
        ),
        # no note on the minimal file (re-tests the note requirement)
        "PN4_no_note.opj": _synth_tail2(
            pieces, n_windows=1, with_note=False, storage=_storage_section()
        ),
        # Moke's real full storage on the 1-book stream (expected False —
        # the PR6 analogue; confirms consistency is the axis)
        "PN5_real_storage.opj": _synth_tail2(
            pieces, n_windows=1, with_note=True, storage=real_storage
        ),
    }
    for name, tail in variants.items():
        (PROBES / name).write_bytes(_fix_size(stream + tail))
    print(f"PN variants in {PROBES}: {', '.join(variants)}")
    print(f"  stream={len(stream)} triples={len(triples)} winsec={len(winsec)}")


def build_pq_variants() -> None:
    """PQ series: the NEW writer's own output (writer_blocks templates),
    end-to-end — real-corpus data (PQ3/PQ5) and fully synthetic (PQ6)."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
    import numpy as np

    from quantized.datastruct import DataStruct
    from quantized.io.origin_project import read_origin_books
    from quantized.io.origin_project.writer import opj_bytes

    PROBES.mkdir(exist_ok=True)
    books = {
        ds.metadata["origin_book"]: ds for ds in read_origin_books(CORPUS / "Moke.opj")
    }
    (PROBES / "PQ3_writer_book2.opj").write_bytes(opj_bytes([books["Book2"]]))
    (PROBES / "PQ5_writer_2books.opj").write_bytes(
        opj_bytes([books["Book2"], books["Book3"]])
    )
    synth = DataStruct(
        time=np.array([1.0, 2.0, 3.0, 4.0]),
        values=np.column_stack([[10.0, 20.0, 30.0, 40.0], [0.1, 0.2, np.nan, 0.4]]),
        labels=("Moment", "Error"),
        units=("emu", "emu"),
        metadata={
            "origin_book": "Loop1",
            "origin_book_long": "30 nm sample",
            "x_column_long": "Field",
            "x_unit": "Oe",
        },
    )
    (PROBES / "PQ6_writer_synth.opj").write_bytes(opj_bytes([synth]))
    print(f"PQ variants in {PROBES}")


def run(names: list[str]) -> None:
    import win32com.client as wc

    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0
    for name in names:
        print(f"PROBE {name} ...", flush=True)
        try:
            ok = bool(app.Load(str(PROBES / name)))
        except Exception as exc:
            print(f"RESULT {name} EXCEPTION {exc}", flush=True)
            continue
        nb = -1
        try:
            app.Execute("double __nw = 0;")
            app.Execute("doc -e W { __nw = __nw + 1; }")
            nb = int(app.LTVar("__nw"))
        except Exception:
            pass
        print(f"RESULT {name} load={ok} books={nb}", flush=True)
        try:
            app.NewProject()
        except Exception:
            pass
    print("ALL DONE", flush=True)


def verify(name: str, books: list[str]) -> None:
    """Load a probe in real Origin, expASC every book, print the CSVs —
    the item-34 data-integrity leg (values/names/units survive the loader)."""
    import win32com.client as wc

    app = wc.gencache.EnsureDispatch("Origin.ApplicationSI")
    app.Visible = 0
    ok = bool(app.Load(str(PROBES / name)))
    print(f"LOAD {name} -> {ok}", flush=True)
    outdir = PROBES / "verify"
    outdir.mkdir(exist_ok=True)
    for book in books:
        csv = outdir / f"{name}.{book}.csv"
        csv.unlink(missing_ok=True)  # a silent expASC failure must not read stale bytes
        app.Execute(
            f"expASC iw:=[{book}]1! type:=csv overwrite:=1 "
            f'path:="{str(csv).replace(chr(92), "/")}";'
        )
        print(f"--- {book} ---")
        print(csv.read_text(encoding="latin1") if csv.exists() else "(no csv)")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "build":
        build_variants()
    elif len(sys.argv) > 1 and sys.argv[1] == "build-pn":
        build_pn_variants()
    elif len(sys.argv) > 1 and sys.argv[1] == "build-pq":
        build_pq_variants()
    elif len(sys.argv) > 1 and sys.argv[1] == "run":
        run(sys.argv[2:])
    elif len(sys.argv) > 2 and sys.argv[1] == "verify":
        verify(sys.argv[2], sys.argv[3:])
    else:
        print(__doc__)
