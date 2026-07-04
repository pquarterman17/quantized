"""Origin project (.opj / .opju) reader — M1 worksheet-data decode.

Two layers:
  * a **synthetic** CPY fixture built in-test (no private data) that exercises the
    block-framing walker + column decoder in CI;
  * a **realdata**-marked check against the local Origin corpus (auto-skips where
    the corpus is absent, e.g. CI) pinning a couple of decoded values as
    regression anchors.

Format: see docs/origin_project_format.md.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pytest

from quantized.io.origin_project import OriginProjectError, read_origin_project
from quantized.io.registry import import_auto, resolve_parser

# ── synthetic CPY .opj builder ────────────────────────────────────────────────


def _block(payload: bytes) -> bytes:
    """One CPY block: <uint32 size LE><0x0A><payload><0x0A>."""
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _zero() -> bytes:
    """A section-spacer block (size 0, no payload)."""
    return struct.pack("<I", 0) + b"\n"


def _data(values: list[float]) -> bytes:
    """A column data block: 10-byte <uint16 mask=0><float64> records."""
    return _block(b"".join(b"\x00\x00" + struct.pack("<d", v) for v in values))


def _header(name: str) -> bytes:
    """A column-header block carrying '<book>_<col>\\0'; size kept off a /10 so the
    walker classifies it as a header, not data."""
    payload = b"\x00" * 40 + name.encode("latin1") + b"\x00" + b"\x00" * 6
    if len(payload) % 10 == 0:
        payload += b"\x00"
    return _block(payload)


def _synthetic_opj() -> bytes:
    """A minimal valid CPYA project: Book1 with column A (x) and B (y)."""
    return (
        b"CPYA 4.3380 188 W64 #\n"
        + _block(b"\x00" * 32)  # file-header block (content irrelevant here)
        + _zero()
        + _header("Book1_A") + _data([1.0, 2.0, 3.0])
        + _zero()
        + _header("Book1_B") + _data([10.0, 20.0, 30.0])
    )


def _write(tmp_path: Path, name: str, data: bytes) -> Path:
    p = tmp_path / name
    p.write_bytes(data)
    return p


# ── synthetic decode (runs in CI) ─────────────────────────────────────────────


def test_registry_resolves_origin_extensions(tmp_path) -> None:
    for ext in (".opj", ".opju", ".OPJ", ".OpjU"):  # resolve lowercases the suffix
        f = _write(tmp_path, f"p{ext}", b"\x00\x00")
        assert resolve_parser(f) is read_origin_project


def test_decodes_worksheet_data_from_a_synthetic_opj(tmp_path) -> None:
    ds = import_auto(_write(tmp_path, "synth.opj", _synthetic_opj()))
    # column A → x (time); column B → the single value column.
    assert list(ds.time) == [1.0, 2.0, 3.0]
    assert ds.values.shape == (3, 1)
    assert list(ds.values[:, 0]) == [10.0, 20.0, 30.0]
    assert ds.labels == ("B",)
    assert ds.metadata["source_format"] == "origin_opj"
    assert ds.metadata["origin_book"] == "Book1"
    assert ds.metadata["origin_books"] == [
        {"name": "Book1", "long_name": "Book1", "ncols": 2, "nrows": 3}
    ]


def _window_header(book: str) -> bytes:
    """A worksheet window-header block: 00 00 <Book> 00 …, >=150 B."""
    payload = b"\x00\x00" + book.encode() + b"\x00"
    payload += b"\x00" * (165 - len(payload))  # not a multiple of 10
    return _block(payload)


def _prop_block(short: str, designation: int) -> bytes:
    """A 519-byte column-property block (designation@0x11, short name@0x12)."""
    p = bytearray(519)
    p[0x06] = 0x0B
    p[0x11] = designation
    p[0x12 : 0x12 + len(short) + 1] = short.encode() + b"\x00"
    p[0x25] = 0x21
    return _block(bytes(p))


def _label_block(long_name: str, unit: str) -> bytes:
    payload = f"{long_name}\r\n{unit}".encode() + b"\x00"
    if len(payload) % 10 == 0:
        payload += b"\x00"
    return _block(payload)


def test_windows_section_supplies_names_units_and_x_designation(tmp_path) -> None:
    data = (
        _synthetic_opj()
        + _zero()
        + _window_header("Book1")
        + _prop_block("A", 3)  # designation X
        + _label_block("Field", "Oe")
        + _prop_block("B", 0)  # designation Y
        + _label_block("Moment", "emu")
    )
    ds = import_auto(_write(tmp_path, "named.opj", data))
    assert ds.labels == ("Moment",)
    assert ds.units == ("emu",)
    assert ds.metadata["x_column_long"] == "Field"
    assert ds.metadata["x_unit"] == "Oe"
    assert ds.metadata["column_designations"] == {"A": "X", "B": "Y"}
    # data itself is unchanged by the metadata
    assert list(ds.time) == [1.0, 2.0, 3.0]
    assert list(ds.values[:, 0]) == [10.0, 20.0, 30.0]


def test_read_origin_books_returns_every_workbook(tmp_path) -> None:
    data = (
        b"CPYA 4.3380 188 W64 #\n" + _block(b"\x00" * 32) + _zero()
        + _header("Alpha_A") + _data([1.0, 2.0])
        + _zero()
        + _header("Alpha_B") + _data([5.0, 6.0])
        + _zero()
        + _header("Beta_A") + _data([7.0, 8.0, 9.0])
    )
    from quantized.io.origin_project import read_origin_books

    books = read_origin_books(_write(tmp_path, "two.opj", data))
    assert [b.metadata["origin_book"] for b in books] == ["Alpha", "Beta"]
    assert list(books[0].time) == [1.0, 2.0]
    assert list(books[0].values[:, 0]) == [5.0, 6.0]
    assert books[1].values.shape == (3, 0)  # single-column book: X only
    # shared inventory on every book
    assert [i["name"] for i in books[1].metadata["origin_books"]] == ["Alpha", "Beta"]


def test_ragged_columns_pad_with_nan(tmp_path) -> None:
    data = (
        b"CPYA 4.3380 188 W64 #\n" + _block(b"\x00" * 8) + _zero()
        + _header("B_A") + _data([1.0, 2.0, 3.0])
        + _zero()
        + _header("B_B") + _data([9.0])  # shorter → padded to len 3
    )
    ds = import_auto(_write(tmp_path, "ragged.opj", data))
    assert ds.values.shape == (3, 1)
    assert ds.values[0, 0] == 9.0
    assert np.isnan(ds.values[1, 0]) and np.isnan(ds.values[2, 0])


def test_non_cpya_opj_raises_actionable_guidance(tmp_path) -> None:
    with pytest.raises(OriginProjectError) as exc:
        import_auto(_write(tmp_path, "bogus.opj", b"not an origin file"))
    msg = str(exc.value)
    assert "bogus.opj" in msg and "Origin Viewer" in msg and "CSV" in msg


def test_opju_still_guides_until_m2(tmp_path) -> None:
    with pytest.raises(OriginProjectError) as exc:
        import_auto(_write(tmp_path, "recent.opju", b"CPYUA 4.3380 188"))
    assert "recent.opju" in str(exc.value) and "Origin Viewer" in str(exc.value)


def test_error_is_a_valueerror_so_the_route_maps_it_to_422() -> None:
    assert issubclass(OriginProjectError, ValueError)


# ── realdata (skips in CI / where the corpus is absent) ───────────────────────

_CORPUS = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_moke_field_ramp() -> None:
    ds = import_auto(_CORPUS / "Moke.opj")
    # the largest MOKE book's X column is the field sweep, first point ≈ -6796.22 Oe
    assert ds.time[0] == pytest.approx(-6796.22, abs=0.1)
    assert np.isfinite(ds.time).sum() > 100  # most of the ramp is real (empties → NaN)
    assert ds.values.shape[1] >= 1


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_moke_all_books_recovered() -> None:
    from quantized.io.origin_project import read_origin_books

    books = read_origin_books(_CORPUS / "Moke.opj")
    names = [b.metadata["origin_book"] for b in books]
    assert len(books) >= 5 and len(set(names)) == len(names)
    # book display titles (sample names) recovered
    assert any("MnN" in b.metadata["origin_book_long"] for b in books)


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_xrd_column_names_units_from_windows_section() -> None:
    """The windows-section metadata (RE item 1) reaches the DataStruct."""
    ds = import_auto(_CORPUS / "XRD.opj")
    # every XRD book: A = X "2Theta"/"degrees", B = Y "I"/"arb. units", C = Y "dI"
    assert ds.metadata["x_column_long"] == "2Theta"
    assert ds.metadata["x_unit"] == "degrees"
    assert ds.labels[0] == "I"
    assert ds.units[0] == "arb. units"
    assert ds.metadata["column_designations"]["A"] == "X"
    # long book names (source filenames) recovered from window headers
    assert any(
        b["long_name"] != b["name"] for b in ds.metadata["origin_books"]
    )


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_xrd_two_theta_scan() -> None:
    ds = import_auto(_CORPUS / "XRD.opj")
    # a fine θ–2θ scan: X starts at 20° and increases monotonically over the real
    # rows (trailing empty cells decode to NaN, not Origin's -1.23e-300 sentinel).
    assert ds.time[0] == pytest.approx(20.0, abs=0.05)
    assert ds.time.shape[0] > 1000
    real = ds.time[np.isfinite(ds.time)]
    assert (np.diff(real) > 0).all()
    assert np.isnan(ds.time[-1])  # sentinel-filled tail mapped to NaN


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_figures_extracted_as_plot_states() -> None:
    """Plan items 12/13: graph windows -> plot-state snapshots."""
    from quantized.io.origin_project.figures import extract_figures

    xrd = extract_figures((_CORPUS / "XRD.opj").read_bytes())
    assert len(xrd) == 1
    f = xrd[0]
    assert (f["x_from"], f["x_to"]) == (18.0, 100.0)
    assert f["y_log"] is True and f["x_log"] is False  # log-intensity XRD plot
    assert f["n_curves"] == 3
    assert any("Si (004)" in a for a in f["annotations"])  # peak label survives

    moke = extract_figures((_CORPUS / "Moke.opj").read_bytes())
    assert len(moke) == 12
    g = next(x for x in moke if x["name"] == "Graph3")
    assert g["x_from"] == -7000.0 and g["x_to"] == 7000.0  # field-symmetric loop


def test_figures_absent_on_plain_synthetic(tmp_path) -> None:
    from quantized.io.origin_project.figures import extract_figures

    assert extract_figures(_synthetic_opj()) == []


def test_extra_sheet_datasets_become_pseudo_books(tmp_path) -> None:
    data = (
        b"CPYA 4.3380 188 W64 #\n" + _block(b"\x00" * 32) + _zero()
        + _header("Bk_A") + _data([1.0, 2.0])
        + _zero()
        + _header("Bk_A@2") + _data([9.0, 8.0, 7.0])
    )
    from quantized.io.origin_project import read_origin_books

    books = read_origin_books(_write(tmp_path, "sheets.opj", data))
    names = {b.metadata["origin_book"] for b in books}
    assert names == {"Bk", "Bk@2"}
    s2 = next(b for b in books if b.metadata["origin_book"] == "Bk@2")
    assert list(s2.time) == [9.0, 8.0, 7.0]


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_moke_fit_sheets_recovered() -> None:
    from quantized.io.origin_project import read_origin_books

    books = {b.metadata["origin_book"]: b for b in read_origin_books(_CORPUS / "Moke.opj")}
    assert "Book4@2" in books and "Book4@3" in books  # FitLinear sheets
    assert books["Book4@3"].values.shape[0] == 1000  # fit-curve table
    assert "(sheet 2)" in books["Book4@2"].metadata["origin_book_long"]


# ── synthetic .opju FPC codec round-trip (runs in CI) ─────────────────────────
#
# A test-local FPC *encoder* mirroring the decoder's model (canonical
# Burtscher FPC: FCM value-hash + DFCM stride-hash, 2^12 tables, canonical
# bcode widths where codes 0-3 store 0-3 bytes and 4-7 store 5-8). Encoding
# synthetic columns and decoding them pins the width table — the low codes
# were misread as (c&7)+1 until 2026-07-04 and only ultra-smooth data
# exercises them (the "DFCM-collision" drop-outs, plan item 32).


def _varint(v: int) -> bytes:
    out = bytearray()
    while True:
        b7 = v & 0x7F
        v >>= 7
        out.append(b7 | (0x80 if v else 0))
        if not v:
            return bytes(out)


def _zz(n: int) -> bytes:
    """ZigZag-encode a signed int as a varint."""
    return _varint((n << 1) ^ (n >> 63) if n >= 0 else ((-n) << 1) - 1)


def _fpc_encode(values: list[float]) -> bytes:
    """Encode float64s with the canonical-FPC model the decoder implements."""
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
        code = nbytes if nbytes < 4 else nbytes - 1
        nibbles.append(code | (0x8 if use_d else 0))
        payloads.append(resid.to_bytes(8, "little")[:nbytes])
        stride = (val - last) & mask
        fcm[fh] = val
        dfcm[dh] = stride
        fh = ((fh << 6) ^ (val >> 48)) & 0xFFF
        dh = ((dh << 2) ^ (stride >> 40)) & 0xFFF
        last = val
    if len(nibbles) % 2:
        nibbles.append(0)
    out = bytearray()
    pi = 0
    for i in range(0, len(nibbles), 2):
        out.append(nibbles[i] | (nibbles[i + 1] << 4))
        for k in (i, i + 1):
            if k < len(values):
                out += payloads[k]
                pi += 1
    return bytes(out)


def _opju_record(name: str, segments: list[tuple], stream: bytes) -> bytes:
    """A named .opju column record: name + `0a 05 … ff ff` framing + segments."""
    nrows = sum(c for _, c, *_ in segments)
    fields = bytearray()
    for seg in segments:
        kind, count = seg[0], seg[1]
        if kind == "fpc":
            fields += _zz(-count)
        else:
            fields += _zz(count)
            value = seg[2]
            if value == 0.0:
                fields.append(0x64)
            else:
                fields += b"\x50" + struct.pack("<d", value)
    body = b"\xff\xff" + _varint(nrows) + b"\x00" + bytes(fields)
    if stream:
        body += b"\x0c" + stream
    nm = name.encode("latin1")
    return bytes([len(nm)]) + nm + b"\x0a\x05" + _varint(nrows) + body


def test_opju_codec_low_width_codes_round_trip() -> None:
    """Ultra-smooth data exercises 0-3-byte residual codes (the 2026-07-04 fix)."""
    from quantized.io.origin_project.opju_codec import scan_columns

    # near-constant stride ramp → tiny residuals → low bcodes
    values = [846.551 + 0.517 * i + 1e-9 * (i % 3) for i in range(40)]
    blob = b"CPYUA 4.3380 188\n" + _opju_record("TBook_A", [("fpc", 40)], _fpc_encode(values))
    cols = scan_columns(blob)
    assert len(cols) == 1 and cols[0][0] == "TBook_A"
    assert np.array_equal(cols[0][1], np.asarray(values))


def test_opju_segment_grammar_prefix_run_and_constant() -> None:
    """Repeat-run segments: plateau prefix (0x50 f64), zero run (0x64), and a
    stream-less constant column decode alongside a plain column."""
    from quantized.io.origin_project.opju_codec import scan_columns

    tail = [1.00355 - 0.001 * i for i in range(20)]
    plateau = _opju_record(
        "TBook_B", [("rep", 11, 1.00355), ("fpc", 20)], _fpc_encode(tail)
    )
    zeros = _opju_record("TBook_C", [("rep", 5, 0.0), ("fpc", 20)], _fpc_encode(tail))
    const = _opju_record("TBook_D", [("rep", 8, 2.5)], b"")
    blob = b"CPYUA 4.3380 188\n" + plateau + zeros + const
    cols = dict(scan_columns(blob))
    assert set(cols) == {"TBook_B", "TBook_C", "TBook_D"}
    assert np.array_equal(cols["TBook_B"], np.asarray([1.00355] * 11 + tail))
    assert np.array_equal(cols["TBook_C"], np.asarray([0.0] * 5 + tail))
    assert np.array_equal(cols["TBook_D"], np.full(8, 2.5))


def test_opju_chunked_staircase_record() -> None:
    """Interleaved repeat-runs + FPC bursts (logger staircase data), with a
    fresh predictor state per stream and the 1-byte 0x11 value tag."""
    from quantized.io.origin_project.opju_codec import scan_columns

    burst1 = [2.0, 3.0, 2.5]
    burst2 = [4.0, 4.5]
    # inline-stream layout: [-3][0c s1][+6][11 40][-2][0c s2][+4][64]
    nm = b"\x07TBook_E"
    body = (
        b"\xff\xff" + _varint(15) + b"\x00"
        + _zz(-3) + b"\x0c" + _fpc_encode(burst1)
        + _zz(6) + b"\x11\x40"  # 6 rows of 2.0 via the 1-byte top-byte tag
        + _zz(-2) + b"\x0c" + _fpc_encode(burst2)  # fresh state per stream
        + _zz(4) + b"\x64"  # 4 rows of 0.0
    )
    blob = b"CPYUA 4.3380 188\n" + nm + b"\x0a\x05" + _varint(15) + body
    cols = dict(scan_columns(blob))
    assert "TBook_E" in cols
    expect = burst1 + [2.0] * 6 + burst2 + [0.0] * 4
    assert np.array_equal(cols["TBook_E"], np.asarray(expect))


def test_opj_drops_non_double_garbage_columns(tmp_path) -> None:
    """A text column's bytes reinterpret as absurd float64s — drop the column,
    never emit garbage (item 4's honest-absent contract; type decode is open)."""
    text_block = _block((b"\x00\x00" + b"Comment!") * 3)  # ASCII payload, 10-byte records
    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _block(b"\x00" * 32)
        + _zero()
        + _header("Book1_A") + _data([1.0, 2.0, 3.0])
        + _zero()
        + _header("Book1_B") + text_block
        + _zero()
        + _header("Book1_C") + _data([10.0, 20.0, 30.0])
    )
    ds = read_origin_project(_write(tmp_path, "mixed.opj", blob))
    labels = set(ds.labels) | {str(ds.metadata.get("x_column_name", ""))}
    assert "B" not in labels  # the garbage column is gone
    assert ds.values.shape[1] >= 1  # the real columns survive
