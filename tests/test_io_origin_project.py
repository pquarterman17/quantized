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


def _text_data(strings: list[str], *, tag: int = 0x01) -> bytes:
    """A column data block: 10-byte <uint16 mask><value> records where the
    8-byte value area holds a NUL-terminated string + a tag byte (0x00 or
    0x01) + zero padding — the inline-text "Text & Numeric" shape
    `decode_inline_text` recognizes (plan item 4)."""
    records = bytearray()
    for s in strings:
        raw = s.encode("latin1")
        if len(raw) > 6:
            raise ValueError("inline text must fit <string><NUL><tag> in 8 bytes")
        value = raw + b"\x00" + bytes([tag]) + b"\x00" * (8 - len(raw) - 2)
        records += b"\x00\x00" + value
    return _block(bytes(records))


def _report_data(strings: list[str], *, width: int | None = None) -> bytes:
    """A column data block: Origin's report-sheet record shape --
    ``<uint16 mask=1><NUL-terminated string><zero padding>`` at a WIDTH
    reserved uniformly for the whole column (unlike the double/inline-text
    10-byte record) — the `decode_report_strings` shape (plan item 4's
    `decode_inline_text` overflow residue, e.g. a FitLinear/NLFit report
    sheet's ``"cell://Parameters.Slope.Value"`` reference columns).

    ``width`` defaults to the minimal fit; the walker that dispatches a data
    block to the numeric/text/report decoders only recognizes it as DATA (not
    a column-HEADER block) when its total byte size is a multiple of 10 (a
    property real report sheets happen to satisfy — every width/row-count
    combination in the corpus multiplies out evenly) — pass an explicit
    ``width`` when the minimal one doesn't, same as a real file would need a
    compatible row count.
    """
    w = width if width is not None else 2 + max((len(s) for s in strings), default=0) + 1
    records = bytearray()
    for s in strings:
        raw = s.encode("latin1")
        records += b"\x01\x00" + raw + b"\x00" * (w - 2 - len(raw))
    return _block(bytes(records))


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


def _prop_block(short: str, designation: int, *, flavor: int = 0x0B) -> bytes:
    """A 519-byte column-property block (designation@0x11, short name@0x12).

    ``flavor`` (byte 0x06) is ``0x0B`` by default -- a formula/derived column
    or a report-sheet column; a plain, never-recalculated sheet-1 column uses
    ``0x09`` instead (both are real column-property blocks; see
    `windows._is_column_block`)."""
    p = bytearray(519)
    p[0x06] = flavor
    p[0x11] = designation
    p[0x12 : 0x12 + len(short) + 1] = short.encode() + b"\x00"
    p[0x25] = 0x21
    return _block(bytes(p))


def _label_block(long_name: str, unit: str) -> bytes:
    payload = f"{long_name}\r\n{unit}".encode() + b"\x00"
    if len(payload) % 10 == 0:
        payload += b"\x00"
    return _block(payload)


def _sheet_header(name: str) -> bytes:
    """A per-sheet/per-layer sub-header: fixed 365 B, carrying NUL-terminated
    ``Pd<Name>`` at offset 0xD0 -- the real sheet-boundary signal (report-sheet
    leak fix). One appears at the start of every worksheet sheet; the *second*
    one inside a window's span marks the start of sheet 2+ (a report/curve
    sheet auto-added by FitLinear/NLFit, e.g.), which must never pollute the
    primary sheet's column mapping."""
    p = bytearray(365)  # matches the real corpus sheet/layer sub-header size
    p[0xD0 : 0xD0 + 2] = b"Pd"
    p[0xD0 + 2 : 0xD0 + 2 + len(name) + 1] = name.encode() + b"\x00"
    return _block(bytes(p))


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
    # Canonical downstream key (plot + .ogs export read `x_column_unit`), mirrors
    # `x_unit` so the x-axis unit isn't silently blank on Origin-project plots.
    assert ds.metadata["x_column_unit"] == "Oe"
    assert ds.metadata["column_designations"] == {"A": "X", "B": "Y"}
    # value-channel letters in channel order (curve->column binding support)
    assert ds.metadata["x_column_name"] == "A"
    assert ds.metadata["origin_column_names"] == ["B"]
    # data itself is unchanged by the metadata
    assert list(ds.time) == [1.0, 2.0, 3.0]
    assert list(ds.values[:, 0]) == [10.0, 20.0, 30.0]


def test_windows_section_multi_book_names_stay_isolated(tmp_path) -> None:
    """Plan item 19 gap fill: two books' windows-section metadata land in
    separate BookMeta entries with no cross-book bleed -- previously only
    exercised implicitly via the real multi-book corpus (Moke/XRD)."""
    data = (
        b"CPYA 4.3380 188 W64 #\n" + _block(b"\x00" * 32) + _zero()
        + _header("Alpha_A") + _data([1.0, 2.0])
        + _zero()
        + _header("Alpha_B") + _data([10.0, 20.0])
        + _zero()
        + _header("Beta_A") + _data([3.0, 4.0, 5.0])
        + _zero()
        + _header("Beta_B") + _data([30.0, 40.0, 50.0])
        + _zero()
        + _window_header("Alpha")
        + _prop_block("A", 3) + _label_block("Time", "s")
        + _prop_block("B", 0) + _label_block("Signal", "V")
        + _zero()
        + _window_header("Beta")
        + _prop_block("A", 3) + _label_block("Cycle", "n")
        + _prop_block("B", 0) + _label_block("Count", "counts")
    )
    from quantized.io.origin_project import read_origin_books
    from quantized.io.origin_project.windows import window_metadata

    meta = window_metadata(data)
    assert set(meta) == {"Alpha", "Beta"}
    assert meta["Alpha"].columns["B"].long_name == "Signal"
    assert meta["Alpha"].columns["B"].unit == "V"
    assert meta["Beta"].columns["B"].long_name == "Count"
    assert meta["Beta"].columns["B"].unit == "counts"

    path = _write(tmp_path, "multi.opj", data)
    books = {b.metadata["origin_book"]: b for b in read_origin_books(path)}
    assert books["Alpha"].labels == ("Signal",)
    assert books["Alpha"].units == ("V",)
    assert books["Beta"].labels == ("Count",)
    assert books["Beta"].units == ("counts",)


def test_windows_section_multi_sheet_guard_keeps_only_primary_sheet() -> None:
    """Plan item 19 gap fill: a window whose block stream repeats a short
    column name (sheet 2 restarting at column A) stops mapping after the
    primary sheet -- the repeated-short guard in `window_metadata` (the
    boundary item 5 relies on), previously only exercised via Moke.opj's
    fit-table sheets (realdata). No `_sheet_header` marker here on purpose:
    this pins the *fallback* path for containers with no such marker (the
    real signal is covered by
    `test_windows_section_report_sheet_never_leaks_into_primary_mapping`)."""
    data = (
        b"CPYA 4.3380 188 W64 #\n"
        + _window_header("Book4")
        + _prop_block("A", 3) + _label_block("Field", "Oe")
        + _prop_block("B", 0) + _label_block("Moment", "emu")
        # sheet 2 restarts at column A -- must NOT overwrite the primary mapping
        + _prop_block("A", 3) + _label_block("FitX", "")
        + _prop_block("B", 0) + _label_block("FitY", "")
    )
    from quantized.io.origin_project.windows import window_metadata

    book = window_metadata(data)["Book4"]
    assert book.columns["A"].long_name == "Field"  # sheet-1 name preserved
    assert book.columns["B"].long_name == "Moment"
    assert set(book.columns) == {"A", "B"}  # sheet 2's columns never added/overwritten


def test_windows_section_report_sheet_never_leaks_into_primary_mapping() -> None:
    """The report-sheet-leak bug (Moke.opj Book4): a workbook with a real
    data sheet (Sheet1) followed by a FitLinear-style report sheet whose own
    property/label blocks (mostly ``disregard``-designated, "Input X Data
    Source"/"Notes"/"Range"-style labels) must never reach the primary
    mapping -- even though the report sheet also restarts lettering at "A"
    and shares the 0x0B property-block byte with a formula column, so the
    repeated-short fallback alone is not an early-enough signal (see the
    module docstring). The `_sheet_header` ("Pd<Name>") marker between the
    two sheets is what stops collection immediately, before the report
    sheet's first property block is ever seen. Sheet1's columns use the
    ``0x09`` storage flavour (the common case measured on Moke.opj -- 14/15
    of a real sheet's columns), the report sheet's use ``0x0B`` (every
    report-sheet column does, real corpus measurement) -- reproducing both
    root causes of the original bug at once: without the broadened
    ``_is_column_block`` byte check, Sheet1's own columns would be invisible
    and the report sheet's would be mistaken for the primary mapping."""
    data = (
        b"CPYA 4.3380 188 W64 #\n"
        + _window_header("Book4")
        + _sheet_header("Sheet1")
        + _prop_block("A", 3, flavor=0x09) + _label_block("H", "Oe")
        + _prop_block("B", 0, flavor=0x09) + _label_block("Kerr Signal", "(mdeg)")
        # sheet 2: an auto-generated report sheet -- restarts at "A", mostly
        # 'disregard' designated, with report-style labels (never the truth
        # for Sheet1's real columns A/B).
        + _sheet_header("FitLinear1")
        + _prop_block("A", 1, flavor=0x0B) + _label_block("Input X Data Source", "")
        + _prop_block("B", 1, flavor=0x0B) + _label_block("Input Y Data Source", "")
        + _prop_block("C", 1, flavor=0x0B) + _label_block("Range", "")
        + _prop_block("D", 1, flavor=0x0B) + _label_block("Notes", "")
    )
    from quantized.io.origin_project.windows import window_metadata

    book = window_metadata(data)["Book4"]
    assert book.columns["A"].long_name == "H"
    assert book.columns["A"].unit == "Oe"
    assert book.columns["A"].designation == "X"
    assert book.columns["B"].long_name == "Kerr Signal"
    assert book.columns["B"].designation == "Y"
    # neither the report sheet's columns C/D nor its 'disregard' bleed into A/B
    assert set(book.columns) == {"A", "B"}
    assert all(c.designation != "disregard" for c in book.columns.values())
    assert all(
        "Input" not in c.long_name and "Notes" not in c.long_name for c in book.columns.values()
    )


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


def _resolve_corpus_dir() -> Path:
    """The local-only ``../test-data/origin`` corpus.

    ``parents[1] / "../test-data"`` assumes this file sits one level below a
    repo root that is itself a sibling of ``test-data`` -- true for the main
    checkout, but a worktree agent lives an extra ``.claude/worktrees/<name>``
    deep, so that relative path silently resolves to a nonexistent location
    and every realdata test below skips without saying why. Fall back to
    walking up from ``__file__`` for a ``test-data`` sibling (works from any
    nesting depth) before giving up -- mirrors
    ``test_io_origin_figures_opju.py``'s ``_resolve_spec_dir``.
    """
    candidate = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin"
    if candidate.exists():
        return candidate
    for ancestor in Path(__file__).resolve().parents:
        walked = ancestor / "test-data" / "origin"
        if walked.exists():
            return walked
    return candidate  # let downstream `.exists()` checks skip cleanly


_CORPUS = _resolve_corpus_dir()
_GT = _CORPUS / "specimens" / "ground_truth"


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
def test_realdata_moke_book4_sheet1_metadata_matches_ground_truth() -> None:
    """Regression pin for the report-sheet leak bug: Book4 is a 3-sheet
    workbook (Sheet1 real data / FitLinear1 report / FitLinearCurve1 curve
    table) whose windows-section block stream used to bleed FitLinear1's
    property/label blocks into Sheet1's mapping (mostly 'disregard'
    designations, "Input X Data Source"/"Notes"-style labels), because most
    of Sheet1's own property blocks use the 0x09 storage-flavour byte the old
    ``==0x0B``-only detector silently dropped. Checked against Origin's own
    export (``ground_truth/Moke/index.json`` -> ``books[Book4].sheets[0]``,
    "Sheet1") -- every one of the 15 real columns' long name/unit, by letter,
    plus the designation recovered straight from the property blocks (the
    oracle has no designation field, so that part is cross-checked against
    the "H" field-axis long name instead: every column named "H" is the
    sweep's X column, 4 of them -- A/C/E/I)."""
    import json

    from quantized.io.origin_project.windows import window_metadata

    gt_path = _GT / "Moke" / "index.json"
    if not gt_path.exists():
        pytest.skip("Moke ground-truth index.json not present")
    index = json.loads(gt_path.read_text(encoding="utf-8"))
    book4 = next(b for b in index["books"] if b["book"] == "Book4")
    sheet1 = book4["sheets"][0]
    assert sheet1["sheet"] == "Sheet1" and len(sheet1["columns"]) == 15

    columns = window_metadata((_CORPUS / "Moke.opj").read_bytes())["Book4"].columns
    assert set(columns) == {c["dataset"] for c in sheet1["columns"]}  # never FitLinear1's letters
    for col in sheet1["columns"]:
        letter = col["dataset"]
        assert columns[letter].long_name == col["long_name"], f"column {letter} long_name"
        assert columns[letter].unit == col["unit"], f"column {letter} unit"

    field_axis = {c["dataset"] for c in sheet1["columns"] if c["long_name"] == "H"}
    assert field_axis == {"A", "C", "E", "I"}
    assert {k for k, v in columns.items() if v.designation == "X"} == field_axis
    assert all(v.designation != "disregard" for v in columns.values())


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
    """Plan items 12/13: graph windows -> plot-state snapshots. Multi-layer
    windows (item 36) now yield one dict PER LAYER -- Moke has 12 reachable
    graph windows totaling 17 layers (Graph4/Graph7 have 2 each, Graph10 --
    the union of Graph7's + Graph4's layers -- has 4; every other window is
    single-layer)."""
    from quantized.io.origin_project.figures import extract_figures

    xrd = extract_figures((_CORPUS / "XRD.opj").read_bytes())
    assert len(xrd) == 1  # XRD has zero multi-layer windows
    f = xrd[0]
    assert f["layer"] == 1
    assert (f["x_from"], f["x_to"]) == (18.0, 100.0)
    assert f["y_log"] is True and f["x_log"] is False  # log-intensity XRD plot
    assert f["n_curves"] == 3
    assert any("Si (004)" in a for a in f["annotations"])  # peak label survives

    moke = extract_figures((_CORPUS / "Moke.opj").read_bytes())
    assert len(moke) == 17  # 12 windows, 5 of them carrying a 2nd/3rd/4th layer
    g = next(x for x in moke if x["name"] == "Graph3")
    assert g["layer"] == 1
    assert g["x_from"] == -7000.0 and g["x_to"] == 7000.0  # field-symmetric loop
    # the Y-scale flag (`_y_scale_flag`, isolated 2026-07-04 from this exact
    # XRD/Moke byte-diff) must read every Moke window-level graph as linear --
    # not just heuristically (all these ranges are well under 3 decades, so
    # this also passed before the flag; the real regression guard is XRD above).
    assert all(x["y_log"] is False for x in moke)

    # per-layer axis ranges, validated against ground_truth/Moke/index.json:
    # Graph4 (2 layers, both x=(0.9,3.1), y=(-50,3000)/(400,1500)), Graph7
    # (2 layers, both x=(-7000,7000), y=(-1.25,1.25)/(-1.2,1.2)), Graph10 (4
    # layers = Graph7's 2 then Graph4's 2, in that order).
    g4 = [x for x in moke if x["name"] == "Graph4"]
    assert [x["layer"] for x in g4] == [1, 2]
    assert [(x["x_from"], x["x_to"], x["y_from"], x["y_to"]) for x in g4] == [
        (0.9, 3.1, -50.0, 3000.0),
        (0.9, 3.1, 400.0, 1500.0),
    ]
    g7 = [x for x in moke if x["name"] == "Graph7"]
    assert [x["layer"] for x in g7] == [1, 2]
    assert [(x["x_from"], x["x_to"], x["y_from"], x["y_to"]) for x in g7] == [
        (-7000.0, 7000.0, -1.25, 1.25),
        (-7000.0, 7000.0, -1.2, 1.2),
    ]
    g10 = [x for x in moke if x["name"] == "Graph10"]
    assert [x["layer"] for x in g10] == [1, 2, 3, 4]
    assert [(x["x_from"], x["x_to"], x["y_from"], x["y_to"]) for x in g10] == [
        (-7000.0, 7000.0, -1.25, 1.25),
        (-7000.0, 7000.0, -1.2, 1.2),
        (0.9, 3.1, -50.0, 3000.0),
        (0.9, 3.1, 400.0, 1500.0),
    ]


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_xrd_axis_titles_and_legend_labels() -> None:
    """2026-07-05 (axis-title/legend-label routing): XRD.opj's Graph1 has a
    literal Y title, an escaped 2theta X title, and a legend with two curves
    hand-relabeled to sample temperatures ("325"/"525") -- see `figures.py`'s
    module docstring for the byte-level trail."""
    from quantized.io.origin_project.figures import extract_figures

    xrd = extract_figures((_CORPUS / "XRD.opj").read_bytes())
    assert len(xrd) == 1
    f = xrd[0]
    assert "Intensity" in f["y_title"]
    assert f["x_title"] != ""  # the escaped 2theta string, e.g. "2\g(q...)degrees)"
    assert f["legend_labels"] == ["325", "%(2)", "525"]
    # the axis-title text no longer leaks into the flat annotations bucket
    assert "Intensity" not in " ".join(f["annotations"])


def test_figures_absent_on_plain_synthetic(tmp_path) -> None:
    from quantized.io.origin_project.figures import extract_figures

    assert extract_figures(_synthetic_opj()) == []


# ── synthetic .opj figure records (plan item 19 gap fill) ────────────────────
#
# `figures.py` previously had no positive-path synthetic test at all -- only
# the realdata anchors above and the negative "absent" check just above. These
# build the CPYA graph-window + layer-continuation record shape in-test.


def _fig_window_header(name: str) -> bytes:
    """A graph-window header block: 00 00 <Name> 00 …, >=150 B (figures.py's
    `_is_window_header`, shared with windows.py)."""
    payload = b"\x00\x00" + name.encode("latin1") + b"\x00"
    payload += b"\x00" * (160 - len(payload))
    return _block(payload)


def _fig_layer_block(
    x_from: float,
    x_to: float,
    y_from: float,
    y_to: float,
    *,
    hint: str = "",
    y_scale_flag: bytes | None = None,
    head: int = 0x1F,
) -> bytes:
    """The layer-continuation block read immediately after a graph header:
    head `00 00 <head> 00` (0x1f for a window's first layer or a subsequent
    OVERLAID layer, e.g. double-Y; the rarer 0x17 for a subsequent STACKED/
    TILED-PANEL layer -- see `figures.py`'s `_LAYER_HEAD_BYTES`), axis
    (from, to) doubles at 15/23 (X) and 58/66 (Y), an optional `source_hint`
    cstring at offset 208, and an optional 2-byte Y-scale flag at offset 98
    (`01 00` linear / `08 01` log10 -- see `figures.py`'s `_y_scale_flag`;
    left zero/unrecognized by default so existing heuristic-only tests are
    unaffected)."""
    payload = bytearray(240)
    payload[0:4] = bytes([0, 0, head, 0])
    struct.pack_into("<d", payload, 15, x_from)
    struct.pack_into("<d", payload, 23, x_to)
    struct.pack_into("<d", payload, 58, y_from)
    struct.pack_into("<d", payload, 66, y_to)
    if hint:
        hb = hint.encode("latin1")
        payload[208 : 208 + len(hb)] = hb
    if y_scale_flag is not None:
        payload[98:100] = y_scale_flag
    return _block(bytes(payload))


def _fig_curve_block() -> bytes:
    """A 133-byte curve/legend object block: figures.py counts one per curve
    whenever `size == 133` and `payload[2] == 0x07`."""
    payload = bytearray(133)
    payload[2] = 0x07
    return _block(bytes(payload))


def _fig_text_block(text: str) -> bytes:
    return _block(text.encode("latin1"))


def _fig_named_header(name: str, *, type_byte: int = 0x00) -> bytes:
    """A 133-byte graph-child object header carrying its own name at the
    fixed payload offset `figures.py`'s `_OBJ_NAME_OFFSET` (70) reads --
    mirrors the real `YL`/`XB`/`YR`/`Legend`/`TextN`/`LineN` headers (see
    `figures.py`'s module docstring, "Axis-title / legend-label routing")."""
    payload = bytearray(133)
    payload[2] = type_byte
    nb = name.encode("latin1")
    payload[70 : 70 + len(nb)] = nb
    payload[70 + len(nb)] = 0  # NUL terminator (`_cstring` requires one)
    return _block(bytes(payload))


def _fig_format_block() -> bytes:
    """The fixed-size, textless "format" block that always separates a named
    object's header from its own content block in the real corpus (see
    `figures.py`'s module docstring); its exact size varies by object type in
    real data, but nothing reads it, so any small filler works here."""
    return _block(bytes(103))


def test_synthetic_opj_figure_decodes_ranges_curves_and_annotations() -> None:
    from quantized.io.origin_project.figures import extract_figures

    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(0.0, 10.0, 0.0, 100.0, hint="Book1")
        + _fig_curve_block()
        + _fig_curve_block()
        + _fig_text_block("Field Sweep (Oe)")
    )
    figs = extract_figures(blob)
    assert len(figs) == 1
    f = figs[0]
    assert f["name"] == "Graph1"
    assert f["layer"] == 1  # a single-layer window always gets layer=1
    assert (f["x_from"], f["x_to"]) == (0.0, 10.0)
    assert (f["y_from"], f["y_to"]) == (0.0, 100.0)
    assert f["x_log"] is False and f["y_log"] is False
    assert f["n_curves"] == 2  # counted from the two 133-byte curve blocks
    assert f["source_hint"] == "Book1"
    assert "Field Sweep (Oe)" in f["annotations"]


def test_synthetic_opj_two_layer_window_yields_one_figure_per_layer() -> None:
    """Item 36 (multi-layer windows): a window with TWO layer-continuation
    blocks (a double-Y-style overlay, mirroring Moke's real Graph7) yields
    TWO figure dicts -- not one dict merging both layers -- each with its
    own 1-based `layer`, its own axis range/hint, and its own curve count
    scoped to the blocks between its own layer-continuation record and the
    next (or the window's end)."""
    from quantized.io.origin_project.figures import extract_figures

    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(0.0, 10.0, 0.0, 100.0, hint="Book1")
        + _fig_curve_block()
        + _fig_layer_block(0.0, 10.0, -50.0, 50.0, hint="Book2")
        + _fig_curve_block()
        + _fig_curve_block()
    )
    figs = extract_figures(blob)
    assert [f["name"] for f in figs] == ["Graph1", "Graph1"]
    assert [f["layer"] for f in figs] == [1, 2]
    assert (figs[0]["x_from"], figs[0]["x_to"], figs[0]["y_from"], figs[0]["y_to"]) == (
        0.0,
        10.0,
        0.0,
        100.0,
    )
    assert (figs[1]["x_from"], figs[1]["x_to"], figs[1]["y_from"], figs[1]["y_to"]) == (
        0.0,
        10.0,
        -50.0,
        50.0,
    )
    assert figs[0]["source_hint"] == "Book1" and figs[1]["source_hint"] == "Book2"
    assert figs[0]["n_curves"] == 1  # only the curve block BEFORE layer 2's record
    assert figs[1]["n_curves"] == 2  # the two curve blocks AFTER it


def test_synthetic_opj_stacked_panel_layer_head_byte_recognized() -> None:
    """A subsequent layer whose continuation block's head byte is 0x17 (the
    rarer "stacked/tiled panel" marker, mirroring Moke's real Graph4 --
    see `figures.py`'s `_LAYER_HEAD_BYTES`) is recognized as a real layer
    boundary exactly like the ordinary 0x1f overlay marker."""
    from quantized.io.origin_project.figures import extract_figures

    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph4")
        + _fig_layer_block(0.9, 3.1, -50.0, 3000.0, head=0x1F)
        + _fig_curve_block()
        + _fig_curve_block()
        + _fig_layer_block(0.9, 3.1, 400.0, 1500.0, head=0x17)
        + _fig_curve_block()
        + _fig_curve_block()
    )
    figs = extract_figures(blob)
    assert [f["layer"] for f in figs] == [1, 2]
    assert (figs[0]["y_from"], figs[0]["y_to"]) == (-50.0, 3000.0)
    assert (figs[1]["y_from"], figs[1]["y_to"]) == (400.0, 1500.0)
    assert figs[0]["n_curves"] == 2 and figs[1]["n_curves"] == 2


def test_synthetic_opj_multiple_figures_and_log_heuristic() -> None:
    """Two graph windows in one project, and a trailing worksheet window that
    closes the second graph without starting a new figure."""
    from quantized.io.origin_project.figures import extract_figures

    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(1.0, 8.0, 1.0, 5000.0)  # y spans >=3 decades -> log heuristic
        + _zero()
        + _fig_window_header("Graph2")
        + _fig_layer_block(-100.0, 100.0, -50.0, 50.0)
        + _zero()
        + _window_header("Sheet1")  # a worksheet window ends the second graph
    )
    figs = extract_figures(blob)
    assert [f["name"] for f in figs] == ["Graph1", "Graph2"]
    assert figs[0]["x_log"] is False and figs[0]["y_log"] is True
    assert figs[1]["x_log"] is False and figs[1]["y_log"] is False


def test_synthetic_opj_figure_curve_count_from_legend_text() -> None:
    """When no 133-byte curve-count blocks are present, the legend-text
    `\\l(n)` markers (per-curve legend captions) recover the curve count."""
    from quantized.io.origin_project.figures import extract_figures

    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph3")
        + _fig_layer_block(0.0, 1.0, 0.0, 1.0)
        + _fig_text_block(r"\l(1) %(1)\l(2) %(2)")
    )
    figs = extract_figures(blob)
    assert len(figs) == 1
    assert figs[0]["n_curves"] == 2


def test_synthetic_opj_figure_routes_axis_titles_and_legend_labels() -> None:
    """2026-07-05: named graph-child objects (`YL`/`XB`/`YR`/`Legend`/`TextN`)
    route their own content into `y_title`/`x_title`/`y2_title`/
    `legend_labels`/`annotations` instead of one flat bucket -- mirrors the
    real XRD.opj/hc2convert.opj byte layout (see `figures.py`'s module
    docstring). The legend's `\\l(2)` line is left at the untouched auto
    template (`%(2)`) while `\\l(1)` is hand-relabeled to `"Nb"`, exactly the
    hc2convert.opj shape; a genuine `Text1` annotation AFTER the curve
    blocks still lands in `annotations` (the curve-count blocks between
    Legend and Text1 don't disturb the routing -- see the module docstring)."""
    from quantized.io.origin_project.figures import extract_figures

    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(0.0, 10.0, 0.0, 100.0, hint="Book1")
        + _fig_named_header("YL")
        + _fig_format_block()
        + _fig_text_block("Intensity (arb. units)")
        + _fig_named_header("XB")
        + _fig_format_block()
        + _fig_text_block("2theta (degrees)")
        + _fig_named_header("Legend")
        + _fig_format_block()
        + _fig_text_block("\\l(1) Nb\r\n\\l(2) %(2)")
        + _fig_curve_block()
        + _fig_curve_block()
        + _fig_named_header("Text1")
        + _fig_format_block()
        + _fig_text_block("Peak label")
    )
    figs = extract_figures(blob)
    assert len(figs) == 1
    f = figs[0]
    assert f["y_title"] == "Intensity (arb. units)"
    assert f["x_title"] == "2theta (degrees)"
    assert f["y2_title"] == ""  # no YR object in this synthetic layer
    assert f["legend_labels"] == ["Nb", "%(2)"]
    assert f["annotations"] == ["Peak label"]
    # none of the title/legend text leaks into the flat annotations bucket
    assert "Intensity (arb. units)" not in f["annotations"]
    assert "2theta (degrees)" not in f["annotations"]
    assert f["n_curves"] == 2


def test_synthetic_opj_figure_unnamed_header_falls_back_to_annotations() -> None:
    """Fallback (module docstring): a layer with NO resolvable named header
    at all keeps feeding its recovered text into `annotations`, exactly the
    pre-2026-07-05 behavior -- `x_title`/`y_title`/`y2_title`/`legend_labels`
    stay empty rather than losing the text."""
    from quantized.io.origin_project.figures import extract_figures

    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(0.0, 10.0, 0.0, 100.0, hint="Book1")
        + _fig_curve_block()
        + _fig_curve_block()
        + _fig_text_block("Field Sweep (Oe)")
    )
    figs = extract_figures(blob)
    assert len(figs) == 1
    f = figs[0]
    assert f["annotations"] == ["Field Sweep (Oe)"]
    assert f["x_title"] == "" and f["y_title"] == "" and f["y2_title"] == ""
    assert f["legend_labels"] == []


# ── synthetic .opj Y-scale flag (isolated 2026-07-04 against the XRD/Moke
# byte-diff -- see figures.py's `_y_scale_flag` module docstring) ────────────


def test_synthetic_y_scale_flag_log_overrides_heuristic() -> None:
    """The `08 01` flag reads Y as log even though the range itself spans
    under a decade (0.5 -> 2.0) -- the shape the old decade heuristic alone
    would call linear, exactly like several real PNR/SuperlatticeFits
    reflectivity sub-ranges."""
    from quantized.io.origin_project.figures import extract_figures

    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(18.0, 100.0, 0.5, 2.0, y_scale_flag=b"\x08\x01")
    )
    figs = extract_figures(blob)
    assert len(figs) == 1
    assert figs[0]["y_log"] is True


def test_synthetic_y_scale_flag_linear_overrides_heuristic() -> None:
    """The `01 00` flag reads Y as linear even though the range spans 6
    decades (the shape the old decade heuristic alone would call log)."""
    from quantized.io.origin_project.figures import extract_figures

    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(1.0, 8.0, 0.5, 500000.0, y_scale_flag=b"\x01\x00")
    )
    figs = extract_figures(blob)
    assert len(figs) == 1
    assert figs[0]["y_log"] is False


def test_synthetic_y_scale_flag_unrecognized_falls_back_to_heuristic() -> None:
    """A block too short for the flag offset, or an unrecognized 2-byte
    value there, falls back to the decade heuristic unchanged."""
    from quantized.io.origin_project.figures import extract_figures

    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _zero()
        + _fig_window_header("Graph1")
        + _fig_layer_block(1.0, 8.0, 1.0, 5000.0)  # default payload: zero bytes at 98/99
    )
    figs = extract_figures(blob)
    assert len(figs) == 1
    assert figs[0]["y_log"] is True  # 5000/1 >= 1e3 -> decade heuristic, unchanged


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


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_hc2convert_text_columns_recovered() -> None:
    """Plan item 4: non-double "Text & Numeric" columns decode as metadata,
    never garbage. hc2convert.opj holds 58 Hc2-extraction result columns where
    the critical-field fit failed for every row, and Origin stores the
    literal text "NaN" -- previously silently dropped, now recovered."""
    from quantized.io.origin_project import read_origin_books

    books = read_origin_books(_CORPUS / "hc2convert.opj")
    total_text_cols = sum(len(b.metadata.get("origin_text_columns", {})) for b in books)
    assert total_text_cols == 58  # every fit-failure column recovered, no false positives

    da = next(b for b in books if b.metadata["origin_book"] == "A6221LockinDA")
    assert set(da.metadata["origin_text_columns"]) == {"U", "V"}
    assert da.metadata["origin_text_columns"]["U"] == ["NaN"] * 1930
    assert "U" not in da.labels and "V" not in da.labels  # never in the numeric contract


@pytest.mark.realdata
@pytest.mark.skipif(not _CORPUS.exists(), reason="local Origin corpus not present")
def test_realdata_hc2convert_report_sheets_recovered() -> None:
    """Plan item 4 (report-sheet residue): the 407 FitLinear/NLFit report
    columns that `decode_inline_text` honestly dropped (they overflow its
    8-byte value area with variable-length `cell://...` reference strings)
    now decode via the wider, column-specific `decode_report_strings` record
    shape -- recovered as metadata, never `.values`/`.labels`, and every
    previously-still-dropped column is accounted for (no leftover gap, no
    collision with the 58 inline-text/numeric columns)."""
    from quantized.io.origin_project import read_origin_books

    books = read_origin_books(_CORPUS / "hc2convert.opj")
    total_report_cols = sum(len(b.metadata.get("origin_report_sheets", {})) for b in books)
    assert total_report_cols == 407

    book2_2 = next(b for b in books if b.metadata["origin_book"] == "Book2@2")
    reports = book2_2.metadata["origin_report_sheets"]
    assert reports["C"][:2] == ["cell://Notes.Description", "cell://Notes.UserName"]
    assert all(c not in book2_2.labels for c in reports)  # never in the numeric contract

    # A sheet made entirely of report columns (no plausible-numeric column at
    # all) still surfaces as its own pseudo-book instead of being dropped.
    table3 = next(b for b in books if b.metadata["origin_book"] == "Table3")
    assert table3.values.shape == (0, 0)
    assert "cell://" in table3.metadata["origin_report_sheets"]["A"][0]


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


# ── synthetic .opju report-sheet columns (plan item 4, report-sheet residue) ──
#
# `.opju`'s (CPYUA) sibling of `.opj`'s decode_report_strings: a report column
# shares opju_codec's `0a 05 <varint> ff ff <varint>` record header, but the
# byte right after that second varint is 0x01 (not opju_codec's numeric 0x00)
# and what follows is a single ZigZag-varint segment count -m, then m
# consecutive <len:u8><ASCII bytes> strings (len=0 = a blank report cell) --
# pinned against specimens/fitreport2.opju (see opju_reports.py docstring).


def _opju_report_record(name: str, strings: list[str]) -> bytes:
    """A named .opju REPORT column record: name + `0a 05 <varint> ff ff
    <varint> 01 <ZigZag(-m)> <m x <len:u8><str>>` -- the shape
    `opju_reports.scan_report_columns` decodes."""
    m = len(strings)
    payload = bytearray()
    for s in strings:
        raw = s.encode("latin1")
        payload += bytes([len(raw)]) + raw
    body = b"\xff\xff" + _varint(11) + b"\x01" + _zz(-m) + bytes(payload)
    nm = name.encode("latin1")
    return bytes([len(nm)]) + nm + b"\x0a\x05" + _varint(11) + body


def test_opju_decodes_report_sheet_columns() -> None:
    """A report column's `0x01` tag (vs. a numeric column's `0x00`) routes to
    the string-segment grammar instead of opju_codec's FPC/repeat grammar;
    an empty string (len=0) is a valid blank report cell, not a failure."""
    from quantized.io.origin_project.opju_reports import scan_report_columns

    strings = ["cell://Parameters.B.Value", "", "cell://Parameters.xintercept.Value"]
    blob = b"CPYUA 4.3811 222\n" + _opju_report_record("FitBook_H@2", strings)
    cols = scan_report_columns(blob)
    assert cols == [("FitBook_H@2", strings)]


def test_opju_report_record_never_intercepts_a_numeric_column() -> None:
    """The two codecs are mutually exclusive by construction (gated on the
    same tag byte) -- a report scan over a plain numeric record finds
    nothing, and a numeric scan over a report record finds nothing."""
    from quantized.io.origin_project.opju_codec import scan_columns
    from quantized.io.origin_project.opju_reports import scan_report_columns

    numeric_blob = b"CPYUA 4.3811 222\n" + _opju_record(
        "TBook_A", [("fpc", 3)], _fpc_encode([1.0, 2.0, 3.0])
    )
    assert scan_report_columns(numeric_blob) == []

    report_blob = b"CPYUA 4.3811 222\n" + _opju_report_record("TBook_B", ["cell://Notes.Model"])
    assert scan_columns(report_blob) == []


def test_opju_report_positive_segment_stays_an_honest_drop() -> None:
    """A positive ZigZag segment count was observed on 2 of fitreport2.opju's
    28 report columns (its first two, with no cell:// content at all) and
    its shape is not understood -- honestly dropped, never guessed at."""
    from quantized.io.origin_project.opju_reports import scan_report_columns

    nm = b"\x0bFitBook_A@2"
    body = b"\xff\xff" + _varint(11) + b"\x01" + _zz(11)  # positive count -- undecoded shape
    blob = b"CPYUA 4.3811 222\n" + nm + b"\x0a\x05" + _varint(11) + body
    assert scan_report_columns(blob) == []


def test_opju_report_sheet_columns_wired_into_datastruct(tmp_path) -> None:
    """End-to-end: report_cols attach to origin_report_sheets, never
    .values/.labels, exactly like the .opj inline-text/report families."""
    from quantized.io.origin_project import read_origin_project

    strings = ["cell://RegStats.C1.N", "cell://RegStats.C1.DOF"]
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_record("FitBook_A", [("fpc", 2)], _fpc_encode([1.0, 2.0]))
        + _opju_report_record("FitBook_M@2", strings)
    )
    ds = read_origin_project(_write(tmp_path, "report.opju", blob))
    assert ds.metadata["origin_report_sheets"] == {}  # primary book (sheet 1) is untouched


def test_opju_report_only_pseudo_book_still_surfaces(tmp_path) -> None:
    """A sheet made entirely of report-sheet columns (fitreport2.opju's
    FitNL1 -- 0 plausible-numeric columns of its own) still gets its own
    pseudo-book via read_origin_books, an empty-data DataStruct carrying
    only the report metadata."""
    from quantized.io.origin_project import read_origin_books

    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_record("FitBook_A", [("fpc", 2)], _fpc_encode([1.0, 2.0]))
        + _opju_report_record("FitBook_C@2", ["cell://Notes.Description"])
        + _opju_report_record("FitBook_H@2", ["cell://Parameters.B.Value"])
    )
    path = _write(tmp_path, "report_only.opju", blob)
    books = {b.metadata["origin_book"]: b for b in read_origin_books(path)}
    assert "FitBook" in books and "FitBook@2" in books
    report_book = books["FitBook@2"]
    assert report_book.values.shape == (0, 0)
    assert report_book.labels == ()
    assert report_book.metadata["origin_report_sheets"] == {
        "C": ["cell://Notes.Description"],
        "H": ["cell://Parameters.B.Value"],
    }
    names = {entry["name"] for entry in report_book.metadata["origin_books"]}
    assert names == {"FitBook", "FitBook@2"}


@pytest.mark.realdata
def test_realdata_fitreport2_report_sheets_recovered() -> None:
    """The known-content oracle (specimens/fitreport2.opju -- a linear fit
    x=1..8, slope -1.5, intercept 9.5; ground truth:
    specimens/ground_truth/fitreport2/structure.json): FitNL1's 28 report
    columns recover 26 of them (2 are the positive-segment shape, honestly
    dropped -- see test_opju_report_positive_segment_stays_an_honest_drop),
    as their own "FitBook@2" pseudo-book, matching the exact reference
    strings the fit's report sheet is known to hold."""
    from quantized.io.origin_project import read_origin_books

    src = _CORPUS / "specimens" / "fitreport2.opju"
    if not src.exists():
        pytest.skip("fitreport2.opju specimen not present")
    books = {b.metadata["origin_book"]: b for b in read_origin_books(src)}
    assert "FitBook@2" in books
    reports = books["FitBook@2"].metadata["origin_report_sheets"]
    assert len(reports) == 26  # 28 columns minus the 2 honestly-dropped ones
    assert books["FitBook@2"].values.shape == (0, 0)

    all_strings = {s for rows in reports.values() for s in rows if s}
    # the fit's slope/intercept parameters (Origin's default linear-model
    # names A=intercept, B=slope) are both individually addressable
    assert "cell://Parameters.A.Value" in all_strings
    assert "cell://Parameters.B.Value" in all_strings
    assert "cell://Notes.Equation" in all_strings
    assert "cell://RegStats.C1.ReducedChiSq" in all_strings
    # never leak into the numeric data contract
    assert "C" not in books["FitBook@2"].labels


def test_opj_drops_non_double_garbage_columns(tmp_path) -> None:
    """A text column's bytes reinterpret as absurd float64s — drop the column,
    never emit garbage (item 4's honest-absent contract; this byte shape
    matches neither the inline-text nor the report-sheet decode target)."""
    # Real text blocks are raw strings with no <u16 mask><f64> record structure
    # (constant numeric columns DO keep the 00-00 mask stride — hc2convert's
    # lock-in K/Q/R columns of repeated 2.0 — and must survive this gate).
    text_block = _block(b"Comment un" * 3)
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


def test_opj_decodes_inline_text_column_as_metadata(tmp_path) -> None:
    """Plan item 4 (decode half): a short "Text & Numeric" column — every
    record's 8-byte value area is a NUL-terminated string + tag byte, the
    shape validated against hc2convert.opj's 58 fit-failure "NaN" columns —
    decodes into origin_text_columns metadata, never into .values/.labels
    (the DataStruct contract is numeric)."""
    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _block(b"\x00" * 32)
        + _zero()
        + _header("Book1_A") + _data([1.0, 2.0, 3.0])
        + _zero()
        + _header("Book1_B") + _data([10.0, 20.0, 30.0])
        + _zero()
        + _header("Book1_C") + _text_data(["NaN", "NaN", "NaN"])
    )
    ds = read_origin_project(_write(tmp_path, "text_col.opj", blob))
    assert "C" not in ds.labels
    assert ds.values.shape == (3, 1)  # only B is a real value column
    assert ds.metadata["origin_text_columns"] == {"C": ["NaN", "NaN", "NaN"]}


def test_opj_inline_text_supports_varying_short_strings(tmp_path) -> None:
    """Not hardcoded to the literal string "NaN" — any <=6-char printable
    string in the validated tag shape decodes, and a 0x00 tag byte (plain
    zero padding, no sentinel tag) is accepted too."""
    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _block(b"\x00" * 32)
        + _zero()
        + _header("Book1_A") + _data([1.0, 2.0, 3.0])
        + _zero()
        + _header("Book1_B") + _text_data(["low", "mid", "hi"], tag=0x00)
    )
    ds = read_origin_project(_write(tmp_path, "varied_text.opj", blob))
    assert ds.metadata["origin_text_columns"] == {"B": ["low", "mid", "hi"]}


def test_opj_inline_text_overflow_stays_an_honest_drop(tmp_path) -> None:
    """A string too long to fit one 8-byte value slot, in a shape that ALSO
    isn't the wider report-sheet record (no `0x0001` mask stride) -- stays
    an honest drop rather than a partial/misaligned decode. The genuine
    FitLinear/NLFit report-sheet overflow case (Origin's own `0x0001`-mask
    wide record) is what `decode_report_strings` now recovers instead."""
    overflow = _block(b"Comment un")  # 8-byte value has no NUL in range
    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _block(b"\x00" * 32)
        + _zero()
        + _header("Book1_A") + _data([1.0, 2.0])
        + _zero()
        + _header("Book1_B") + overflow
    )
    ds = read_origin_project(_write(tmp_path, "overflow.opj", blob))
    assert ds.metadata.get("origin_text_columns", {}) == {}
    assert ds.metadata.get("origin_report_sheets", {}) == {}
    assert "B" not in ds.labels


def test_opj_text_columns_grouped_per_book(tmp_path) -> None:
    """Inline-text columns are grouped into the right book, same rule as
    numeric columns (read_origin_books, plan item 3)."""
    from quantized.io.origin_project import read_origin_books

    blob = (
        b"CPYA 4.3380 188 W64 #\n" + _block(b"\x00" * 32) + _zero()
        + _header("Alpha_A") + _data([1.0, 2.0])
        + _zero()
        + _header("Alpha_B") + _text_data(["NaN", "NaN"])
        + _zero()
        + _header("Beta_A") + _data([3.0, 4.0, 5.0])
    )
    path = _write(tmp_path, "grp.opj", blob)
    books = {b.metadata["origin_book"]: b for b in read_origin_books(path)}
    assert books["Alpha"].metadata["origin_text_columns"] == {"B": ["NaN", "NaN"]}
    assert books["Beta"].metadata["origin_text_columns"] == {}


# ── synthetic .opj report-sheet columns (plan item 4, report-sheet residue) ──


def test_opj_decodes_report_sheet_columns_as_metadata(tmp_path) -> None:
    """A FitLinear/NLFit-style report column whose cells hold
    ``cell://...`` reference strings too long for `decode_inline_text`'s
    8-byte value area decodes via the WIDER, column-specific record width
    `decode_report_strings` detects -- attaching to
    ``origin_report_sheets`` metadata, never `.values`/`.labels`."""
    strings = ["cell://Parameters.Slope.Value", "", "cell://Parameters.Intercept.Value"]
    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _block(b"\x00" * 32)
        + _zero()
        + _header("Book1_A") + _data([1.0, 2.0, 3.0])
        + _zero()
        + _header("Book1_B") + _report_data(strings, width=40)  # 3 rows x 40 = 120, %10==0
    )
    ds = read_origin_project(_write(tmp_path, "report_col.opj", blob))
    assert "B" not in ds.labels
    assert ds.values.shape == (3, 0)  # only the x column decoded as data
    assert ds.metadata["origin_report_sheets"] == {"B": strings}
    assert ds.metadata.get("origin_text_columns", {}) == {}


def test_opj_report_sheet_columns_never_collide_with_inline_text(tmp_path) -> None:
    """Both non-double shapes coexist in one book without cross-contaminating
    each other's metadata key."""
    blob = (
        b"CPYA 4.3380 188 W64 #\n"
        + _block(b"\x00" * 32)
        + _zero()
        + _header("Book1_A") + _data([1.0, 2.0])
        + _zero()
        + _header("Book1_B") + _text_data(["NaN", "NaN"])
        + _zero()
        + _header("Book1_C")
        + _report_data(["cell://Notes.Equation", "cell://Notes.Model"], width=30)  # 2x30=60
    )
    ds = read_origin_project(_write(tmp_path, "mixed_nondouble.opj", blob))
    assert ds.metadata["origin_text_columns"] == {"B": ["NaN", "NaN"]}
    assert ds.metadata["origin_report_sheets"] == {
        "C": ["cell://Notes.Equation", "cell://Notes.Model"]
    }
    assert "B" not in ds.labels and "C" not in ds.labels


def test_opj_report_only_pseudo_book_still_surfaces(tmp_path) -> None:
    """A sheet made entirely of report-sheet columns (no plausible-numeric
    column of its own -- Origin's real "FitNL"-style report sheets commonly
    look like this, see the hc2convert ``Table3``/``Table15``/``Table17``
    realdata anchor) still gets its own pseudo-book: an empty-data
    DataStruct carrying only the report metadata, not silently dropped."""
    from quantized.io.origin_project import read_origin_books

    blob = (
        b"CPYA 4.3380 188 W64 #\n" + _block(b"\x00" * 32) + _zero()
        + _header("Book1_A") + _data([1.0, 2.0])
        + _zero()
        + _header("Book1_A@2") + _report_data(["cell://Notes.Description"], width=30)  # 1x30
        + _zero()
        + _header("Book1_B@2")
        + _report_data(["cell://Parameters.Slope.Value"], width=40)  # 1x40
    )
    path = _write(tmp_path, "report_only.opj", blob)
    books = {b.metadata["origin_book"]: b for b in read_origin_books(path)}
    assert "Book1" in books and "Book1@2" in books
    report_book = books["Book1@2"]
    assert report_book.values.shape == (0, 0)
    assert report_book.labels == ()
    assert report_book.metadata["origin_report_sheets"] == {
        "A": ["cell://Notes.Description"],
        "B": ["cell://Parameters.Slope.Value"],
    }
    # no window-section metadata in this synthetic blob -> falls back to the
    # raw pseudo-book key, same fallback rule as a normal (non-empty) book
    assert report_book.metadata["origin_book_long"] == "Book1@2"
    # the inventory lists the report-only pseudo-book too, not just Book1
    names = {entry["name"] for entry in report_book.metadata["origin_books"]}
    assert names == {"Book1", "Book1@2"}


# ── synthetic .opju windows-section names/units (plan item 10) ───────────────

_OPJU_MARK = {"X": b"\x21\x51", "Y": b"\x21\x61", "Y-error": b"\x30\x61"}


def _opju_window_section(book: str, columns: list[tuple[str, str, str, str, str]]) -> bytes:
    """A synthetic CPYUA windows-section run: a book-header anchor
    (`<len=namelen+2> 00 00 <name>`, the manually-typed-sheet form) followed by
    one designation-marker + label record per column, matching the byte shape
    pinned in `docs/origin_re/opju_container.md` (marker immediately followed
    by `<len:u8><tag:u8><LongName\\r\\nUnit\\r\\nComment><NUL>`, or a 3-byte
    empty placeholder `02 01 00` for an unlabeled column)."""
    book_b = book.encode("latin1")
    out = bytes([len(book_b) + 2]) + b"\x00\x00" + book_b
    for _short, desig, long_name, unit, comment in columns:
        out += _OPJU_MARK[desig]
        text = "\r\n".join([long_name, unit, comment]).rstrip("\r\n")
        if text:
            body = text.encode("latin1")
            out += bytes([len(body) + 2]) + b"\x0a" + body + b"\x00"
        else:
            out += b"\x02\x01\x00"
    return out


def test_opju_windows_section_supplies_names_units_and_x_designation() -> None:
    """The CPYUA windows-section marker+label grammar (plan item 10)."""
    from quantized.io.origin_project.opj import _group
    from quantized.io.origin_project.opju_codec import scan_columns
    from quantized.io.origin_project.windows_opju import opju_window_metadata

    x_values = [float(i) for i in range(1, 9)]
    y_values = [111.125 * (i + 1) for i in range(8)]
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_record("RBook_A", [("fpc", 8)], _fpc_encode(x_values))
        + _opju_record("RBook_B", [("fpc", 8)], _fpc_encode(y_values))
        + _opju_window_section(
            "RBook",
            [
                ("A", "X", "Field", "Oe", ""),
                ("B", "Y", "Moment", "emu", "As deposited"),
            ],
        )
    )
    cols = scan_columns(blob)
    books = _group(cols)
    meta = opju_window_metadata(blob, {k: [c for c, _ in v] for k, v in books.items()})
    assert set(meta) == {"RBook"}
    rbook = meta["RBook"]
    assert rbook.columns["A"].designation == "X"
    assert rbook.columns["A"].long_name == "Field"
    assert rbook.columns["A"].unit == "Oe"
    assert rbook.columns["B"].designation == "Y"
    assert rbook.columns["B"].long_name == "Moment"
    assert rbook.columns["B"].unit == "emu"
    assert rbook.columns["B"].comment == "As deposited"


def test_opju_windows_section_reader_wires_labels_into_datastruct(tmp_path) -> None:
    """End to end: `read_opju_books` picks up real labels instead of A/B fallback."""
    from quantized.io.origin_project import read_origin_books

    x_values = [float(i) for i in range(1, 9)]
    y_values = [111.125 * (i + 1) for i in range(8)]
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_record("RBook_A", [("fpc", 8)], _fpc_encode(x_values))
        + _opju_record("RBook_B", [("fpc", 8)], _fpc_encode(y_values))
        + _opju_window_section(
            "RBook",
            [
                ("A", "X", "Field", "Oe", ""),
                ("B", "Y", "Moment", "emu", ""),
            ],
        )
    )
    books = read_origin_books(_write(tmp_path, "named.opju", blob))
    assert len(books) == 1
    ds = books[0]
    assert ds.labels == ("Moment",)
    assert ds.units == ("emu",)
    assert ds.metadata["x_column_long"] == "Field"
    assert ds.metadata["x_unit"] == "Oe"


def test_opju_windows_section_unlabeled_column_keeps_letter_fallback() -> None:
    """No label record (the 3-byte empty placeholder) -> honest A/B fallback,
    never a guess -- mirrors real unlabeled Y columns (e.g. XAS's column B)."""
    from quantized.io.origin_project.opj import _group
    from quantized.io.origin_project.opju_codec import scan_columns
    from quantized.io.origin_project.windows_opju import opju_window_metadata

    values_a = [float(i) for i in range(1, 9)]
    values_b = [2.0 * i for i in range(1, 9)]
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_record("TBook_A", [("fpc", 8)], _fpc_encode(values_a))
        + _opju_record("TBook_B", [("fpc", 8)], _fpc_encode(values_b))
        + _opju_window_section(
            "TBook",
            [
                ("A", "X", "Energy", "eV", ""),
                ("B", "Y", "", "", ""),  # no label at all
            ],
        )
    )
    cols = scan_columns(blob)
    books = _group(cols)
    meta = opju_window_metadata(blob, {k: [c for c, _ in v] for k, v in books.items()})
    tbook = meta["TBook"]
    assert tbook.columns["A"].long_name == "Energy"
    assert tbook.columns["B"].long_name == ""  # honest fallback, not guessed


def test_opju_windows_section_multi_book_names_stay_isolated() -> None:
    """Plan item 19 gap fill: `opju_window_metadata`'s per-book anchor cursor
    (search_from advances past each resolved book) keeps two books' marker
    runs from bleeding into each other -- previously only single-book blobs
    were exercised synthetically here."""
    from quantized.io.origin_project.opj import _group
    from quantized.io.origin_project.opju_codec import scan_columns
    from quantized.io.origin_project.windows_opju import opju_window_metadata

    x1 = [float(i) for i in range(1, 9)]
    y1 = [111.125 * (i + 1) for i in range(8)]
    x2 = [float(i) for i in range(1, 6)]
    y2 = [2.5 * (i + 1) for i in range(5)]
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_record("RBook_A", [("fpc", 8)], _fpc_encode(x1))
        + _opju_record("RBook_B", [("fpc", 8)], _fpc_encode(y1))
        + _opju_record("SBook_A", [("fpc", 5)], _fpc_encode(x2))
        + _opju_record("SBook_B", [("fpc", 5)], _fpc_encode(y2))
        + _opju_window_section(
            "RBook", [("A", "X", "Field", "Oe", ""), ("B", "Y", "Moment", "emu", "")]
        )
        + b"\x00" * 700  # intervening content (>_MAX_GAP) so RBook's marker run
        # doesn't greedily swallow SBook's markers too -- mirrors the real file
        # layout, where other sections separate each book's window run
        + _opju_window_section(
            "SBook", [("A", "X", "Cycle", "n", ""), ("B", "Y", "Count", "counts", "")]
        )
    )
    cols = scan_columns(blob)
    books = _group(cols)
    meta = opju_window_metadata(blob, {k: [c for c, _ in v] for k, v in books.items()})
    assert set(meta) == {"RBook", "SBook"}
    assert meta["RBook"].columns["B"].long_name == "Moment"
    assert meta["RBook"].columns["B"].unit == "emu"
    assert meta["SBook"].columns["B"].long_name == "Count"
    assert meta["SBook"].columns["B"].unit == "counts"


def test_stray_wrecked_cells_salvage_not_reject(tmp_path) -> None:
    """A real double column with a couple of junk denormal cells is salvaged
    (junk -> NaN) instead of dropped whole — but only as a LAST resort, after
    the text/report decoders pass (order preserves plan item 4's families).
    Measured case: XRD.opj Book6_A (1543 values + 4 denormals)."""
    import struct

    good = [20.0 + 0.1 * i for i in range(400)]
    records = bytearray()
    for i, v in enumerate(good):
        records += b"\x00\x00" + struct.pack("<d", 1e-305 if i == 7 else v)
    data = (
        _synthetic_opj()
        + _zero()
        + _header("Book9_A")
        + _block(bytes(records))
    )
    from quantized.io.origin_project import read_origin_books

    books = read_origin_books(_write(tmp_path, "salvage2.opj", data))
    b9 = next(b for b in books if b.metadata["origin_book"] == "Book9")
    col = b9.time  # single column becomes x
    import numpy as np

    assert np.isnan(col[7])  # the junk cell is masked, not kept
    assert np.isfinite(col).sum() == 399


def test_many_wrecked_cells_still_reject(tmp_path) -> None:
    """>4 wrecked cells (or >0.5%) keeps the honest drop — true garbage
    (text/int reinterpretations run >=5% wrecked corpus-wide) never returns."""
    import struct

    records = bytearray()
    for i in range(400):
        v = 1e-305 if i % 50 == 0 else 20.0 + 0.1 * i  # 8 wrecked cells
        records += b"\x00\x00" + struct.pack("<d", v)
    data = _synthetic_opj() + _zero() + _header("Book9_A") + _block(bytes(records))
    from quantized.io.origin_project import read_origin_books

    books = read_origin_books(_write(tmp_path, "garbage.opj", data))
    assert all(b.metadata["origin_book"] != "Book9" for b in books)


@pytest.mark.realdata
def test_realdata_xrd_book6_two_theta_salvaged() -> None:
    """XRD.opj Book6's 2-theta column (4 stray denormals) imports as the x
    axis with the junk cells NaN'd — the cross-book Graph1 overlay needs it."""
    src = _CORPUS / "XRD.opj"
    if not src.exists():
        pytest.skip("Origin corpus not present")
    import numpy as np

    from quantized.io.origin_project import read_origin_books

    books = read_origin_books(src)
    b6 = next(b for b in books if b.metadata["origin_book"] == "Book6")
    assert b6.metadata["x_column_name"] == "A"
    assert list(b6.metadata["origin_column_names"]) == ["B", "C"]
    assert 89.0 < float(np.nanmin(b6.time)) < 91.0
    assert 97.0 < float(np.nanmax(b6.time)) < 99.0


def test_results_log_recovered_from_project(tmp_path) -> None:
    """Timestamped analysis records land in metadata['origin_results_log']
    (plan item 6, log half); projects without a log get no key at all."""
    log_text = (
        b'[5/6/2019 15:16:34 "" (2458609)]\r\n'
        b"subtract_line(subtract_line)\r\n"
        b'  Input\r\n    iy(Input) = [Book4]Sheet1!(C"H",M)\r\n'
    )
    blob = _synthetic_opj() + _block(log_text)
    ds = read_origin_project(_write(tmp_path, "logged.opj", blob))
    assert "subtract_line" in str(ds.metadata["origin_results_log"])
    assert "[Book4]Sheet1" in str(ds.metadata["origin_results_log"])

    plain = read_origin_project(_write(tmp_path, "plain.opj", _synthetic_opj()))
    assert "origin_results_log" not in plain.metadata
    # OriginStorage XML / LabTalk text without a timestamp header never matches
    noisy = _synthetic_opj() + _block(b"<OriginStorage><Notes NodeID='1'/></OriginStorage>" * 3)
    ds2 = read_origin_project(_write(tmp_path, "noisy.opj", noisy))
    assert "origin_results_log" not in ds2.metadata


@pytest.mark.realdata
def test_realdata_moke_results_log() -> None:
    """Moke.opj's real analysis log (subtract_line provenance) is recovered,
    both as raw text and as structured per-operation records (plan item 22)."""
    src = _CORPUS / "Moke.opj"
    if not src.exists():
        pytest.skip("Origin corpus not present")
    ds = read_origin_project(src)
    log = str(ds.metadata.get("origin_results_log", ""))
    assert "subtract_line" in log and "[Book4]Sheet1" in log

    records = ds.metadata.get("origin_results_log_records", [])
    assert len(records) >= 1
    assert any(r["operation"] == "subtract_line" for r in records)
    assert any(
        "[Book4]Sheet1" in value
        for r in records
        for section in r["params"].values()
        for value in section.values()
    )


def test_parse_results_log_structured_records() -> None:
    """Unit test for the parser itself (plan item 22): operation + Input/Output
    params, a record with no operation line, and a malformed trailing line
    that stays in "extra" rather than being dropped."""
    from quantized.io.origin_project.notes import parse_results_log

    log_text = (
        '[5/6/2019 15:16:34 "" (2458609)]\n'
        "subtract_line(subtract_line)\n"
        "  Input\n"
        '    iy(Input) = [Book4]Sheet1!(C"H",M)\n'
        "    x1(Start X) = -3789.29580\n"
        "  Output\n"
        '    oy(Output) = [Book4]Sheet1!(C"H",N"Subtracted Data")\n'
        "??? not a real line ???\n"
        '[5/7/2019 9:00:00 "" (2458611)]\n'
        "  Input\n"
        "    a(A) = 1\n"
    )
    records = parse_results_log(log_text)
    assert len(records) == 2

    r0 = records[0]
    assert r0["timestamp"] == "5/6/2019 15:16:34"
    assert r0["operation"] == "subtract_line"
    assert r0["params"]["Input"]["iy"] == '[Book4]Sheet1!(C"H",M)'
    assert r0["params"]["Input"]["x1"] == "-3789.29580"
    assert r0["params"]["Output"]["oy"] == '[Book4]Sheet1!(C"H",N"Subtracted Data")'
    assert r0["extra"] == ["??? not a real line ???"]

    # a record with no operation line still yields its timestamp
    r1 = records[1]
    assert r1["timestamp"] == "5/7/2019 9:00:00"
    assert r1["operation"] == ""
    assert r1["params"]["Input"]["a"] == "1"
    assert "extra" not in r1  # nothing malformed here, so no empty key


def test_parse_results_log_empty_text_yields_no_records() -> None:
    from quantized.io.origin_project.notes import parse_results_log

    assert parse_results_log("") == []
    assert parse_results_log("no timestamp headers here at all") == []


def test_results_log_records_attached_alongside_raw_text(tmp_path) -> None:
    """Wiring test: `_with_provenance` attaches the parsed records only when
    the raw log text is present AND parses at least one record."""
    log_text = (
        b'[5/6/2019 15:16:34 "" (2458609)]\r\n'
        b"subtract_line(subtract_line)\r\n"
        b'  Input\r\n    iy(Input) = [Book4]Sheet1!(C"H",M)\r\n'
    )
    blob = _synthetic_opj() + _block(log_text)
    ds = read_origin_project(_write(tmp_path, "logged2.opj", blob))
    records = ds.metadata["origin_results_log_records"]
    assert len(records) == 1
    assert records[0]["operation"] == "subtract_line"
    assert records[0]["params"]["Input"]["iy"] == '[Book4]Sheet1!(C"H",M)'

    plain = read_origin_project(_write(tmp_path, "plain2.opj", _synthetic_opj()))
    assert "origin_results_log_records" not in plain.metadata


def _notes_record(name: str, text: str) -> bytes:
    """The contiguous ``93 <nl> <name> 00 0a <tl> <text> 00`` notes framing."""
    nb = name.encode("latin1")
    tb = text.replace("\n", "\r\n").encode("latin1")
    return (
        bytes([0x93, len(nb) + 1])
        + nb
        + b"\x00"
        + bytes([0x0A, len(tb) + 1])
        + tb
        + b"\x00"
    )


def test_notes_windows_recovered_from_synthetic() -> None:
    """A CPYUA notes window (name + free text) is recovered by exact framing;
    OriginStorage XML and lone 0x93 bytes never masquerade as a note."""
    from quantized.io.origin_project.notes import notes_windows

    blob = (
        b"\x00\x01\x02"
        + _notes_record("NProbe", "QZNOTE line one: sample MnN 30nm\nQZNOTE line two: 300K")
        + b"\xff\xfe"
    )
    notes = notes_windows(blob)
    assert set(notes) == {"NProbe"}
    assert notes["NProbe"].split("\n") == [
        "QZNOTE line one: sample MnN 30nm",
        "QZNOTE line two: 300K",
    ]

    # Internal storage text framed the same way is rejected by the junk filter.
    junk = bytes([0x93, 0x05]) + b"win\x00" + bytes([0x0A, 0x1F])
    junk += b"<OriginStorage><Notes/></O>\x00"
    assert notes_windows(junk) == {}
    # A bare 0x93 with no valid name/text chain yields nothing.
    assert notes_windows(b"\x93\x93\x93\x00\x0a\x00") == {}


@pytest.mark.realdata
def test_realdata_notes_probe_specimen() -> None:
    """The known-content notes specimen recovers its exact planted text and
    attaches it at metadata['origin_notes'] (plan item 6, notes half)."""
    src = _CORPUS / "specimens" / "notes_probe.opju"
    if not src.exists():
        pytest.skip("Origin notes specimen not present")
    ds = read_origin_project(src)
    notes = ds.metadata.get("origin_notes", {})
    assert "NProbe" in notes
    assert notes["NProbe"].split("\n") == [
        "QZNOTE line one: sample MnN 30nm",
        "QZNOTE line two: field sweep at 300K",
    ]


# ── unrecovered designated-X fallback (silent x-mislabel regression) ──────────


def test_build_book_unrecovered_x_falls_back_to_row_index() -> None:
    """A book that DECLARES an X column but whose X failed to decode (absent from
    ``cols``) must NOT promote a Y column to the x-axis — that silently relabels
    a measurement as the independent variable and drops the real X. It falls back
    to a synthetic 0..N-1 row index and keeps every decoded column as a value
    series. Regression for Moke.opj Book3 / the hc2convert.opj TDI-column class.
    """
    from quantized.io.origin_project.opj import _build_book
    from quantized.io.origin_project.windows import BookMeta, ColumnMeta

    meta = BookMeta(
        short="Book1",
        long_name="Book1",
        columns={
            "A": ColumnMeta("A", "X", "Temperature", "K", ""),  # declared X, never decodes
            "B": ColumnMeta("B", "Y", "Hex", "Oe", ""),
            "C": ColumnMeta("C", "Y", "Hc", "Oe", ""),
        },
    )
    cols = [("B", np.array([10.0, 20.0, 30.0])), ("C", np.array([1.0, 2.0, 3.0]))]
    ds = _build_book("Book1", cols, {"Book1": meta}, [], "origin_opj")

    assert np.array_equal(np.asarray(ds.time), np.array([0.0, 1.0, 2.0]))  # row index, not Hex
    assert ds.metadata["x_column_recovered"] is False
    assert ds.metadata["x_column_unrecovered"] == "Temperature"
    assert ds.metadata["x_column_long"] == "Row"
    assert set(ds.labels) == {"Hex", "Hc"}  # Hex preserved, not consumed as x
    assert ds.values.shape == (3, 2)


def test_build_book_declared_x_present_is_the_axis() -> None:
    """Control: when the declared X column DOES decode it is the x-axis and
    ``x_column_recovered`` is True (the common path stays unchanged)."""
    from quantized.io.origin_project.opj import _build_book
    from quantized.io.origin_project.windows import BookMeta, ColumnMeta

    meta = BookMeta(
        short="Book1",
        long_name="Book1",
        columns={
            "A": ColumnMeta("A", "X", "Temperature", "K", ""),
            "B": ColumnMeta("B", "Y", "Hex", "Oe", ""),
        },
    )
    cols = [("A", np.array([300.0, 310.0])), ("B", np.array([10.0, 20.0]))]
    ds = _build_book("Book1", cols, {"Book1": meta}, [], "origin_opj")

    assert np.array_equal(np.asarray(ds.time), np.array([300.0, 310.0]))
    assert ds.metadata["x_column_recovered"] is True
    assert ds.metadata["x_column_long"] == "Temperature"
    assert "x_column_unrecovered" not in ds.metadata
    assert ds.labels == ("Hex",)


def test_build_book_no_designations_keeps_first_col_default() -> None:
    """No windows designations at all → the first column stays the x-axis (the
    long-standing default) and nothing is flagged as lost."""
    from quantized.io.origin_project.opj import _build_book

    cols = [("A", np.array([1.0, 2.0])), ("B", np.array([3.0, 4.0]))]
    ds = _build_book("Book1", cols, {}, [], "origin_opj")

    assert np.array_equal(np.asarray(ds.time), np.array([1.0, 2.0]))
    assert ds.metadata["x_column_recovered"] is True
    assert "x_column_unrecovered" not in ds.metadata


# ── Origin rich-text (LabTalk escape) decoding for titles/legends ─────────────


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (r"2\g(q \(40))degrees)", "2θ (degrees)"),  # \(NN) nested inside \g(...)
        ("Intensity (arb. units)", "Intensity (arb. units)"),  # no escapes → unchanged
        (r"Resistance (\g(W))", "Resistance (Ω)"),  # Symbol W → capital Omega
        (r"H\-(c2)", "Hc₂"),  # subscript run
        (r"E\+(2)", "E²"),  # superscript run
        (r"\b(bold)\i( italic) tail", "bold italic tail"),  # styling stripped
        ("%(2)", "%(2)"),  # data reference, not rich-text → untouched
        (r"\(176)C", "°C"),  # char-code 176 = degree sign
        ("", ""),
    ],
)
def test_clean_richtext(raw: str, expected: str) -> None:
    from quantized.io.origin_project.origin_richtext import clean_richtext

    assert clean_richtext(raw) == expected


def test_clean_richtext_malformed_degrades_gracefully() -> None:
    """An unterminated / nonsense escape returns something (never raises), and a
    plain string is returned unchanged."""
    from quantized.io.origin_project.origin_richtext import clean_richtext

    assert clean_richtext("no escapes here") == "no escapes here"
    # unterminated run: must not raise, and must not lose the visible text
    assert "tail" in clean_richtext(r"\g(q tail")
