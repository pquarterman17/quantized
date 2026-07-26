"""JCAMP-DX parser + ASDF decoder.

The decoder tests hand-encode a *known* ordinate sequence in each ASDF form
(AFFN, SQZ, DIF, DUP, DUP-after-DIF, cross-line Y-check) and assert the exact
decoded values — this pins the SQZ/DIF/DUP maps and the difference/duplicate
semantics. The realdata tests then decode the real corpus and lean on JCAMP's
own integrity fields (NPOINTS, FIRSTY) as an oracle.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io._jcamp_asdf import DifCheckError, decode_xydata
from quantized.io.jcamp import import_jcamp, is_jcamp


# --------------------------------------------------------------------------
# ASDF decoder — each form encodes a known sequence (first token is X, dropped)
# --------------------------------------------------------------------------
def test_affn_plain_numbers() -> None:
    assert decode_xydata(["100 99 98 97"]) == [99.0, 98.0, 97.0]


def test_pac_signed_packed() -> None:
    # X=4000, then +101+100-99  ->  [101, 100, -99]
    assert decode_xydata(["4000 +101+100-99"]) == [101.0, 100.0, -99.0]


def test_sqz_absolute() -> None:
    # I9 -> +99, H8 -> +88, a5 -> -15
    assert decode_xydata(["10 I9H8a5"]) == [99.0, 88.0, -15.0]


def test_dif_differences() -> None:
    # E0=50, L=+3 ->53, k=-2 ->51
    assert decode_xydata(["10 E0Lk"]) == [50.0, 53.0, 51.0]


def test_dup_repeats_absolute_value() -> None:
    # E0=50, U(=3) repeats the value: 3 total -> [50, 50, 50]
    assert decode_xydata(["10 E0U"]) == [50.0, 50.0, 50.0]


def test_dup_after_dif_reapplies_difference() -> None:
    # A0=10, K=+2 ->12, U(=3) re-applies +2 twice more -> 14, 16
    assert decode_xydata(["10 A0KU"]) == [10.0, 12.0, 14.0, 16.0]


def test_dif_cross_line_ycheck_dropped() -> None:
    # line1 ends in DIF (53); line2's first ordinate (E3=53) is the Y-check and
    # is verified + discarded, then K=+2 -> 55
    assert decode_xydata(["10 E0L", "12 E3K"]) == [50.0, 53.0, 55.0]


def test_dif_ycheck_failure_raises() -> None:
    with pytest.raises(DifCheckError, match="Y-check"):
        decode_xydata(["10 E0L", "12 E9K"])  # 59 != running 53


# --------------------------------------------------------------------------
# import_jcamp — full file assembly
# --------------------------------------------------------------------------
_FIX = """##TITLE=synthetic
##JCAMP-DX=4.24
##DATA TYPE=INFRARED SPECTRUM
##XUNITS=1/CM
##YUNITS=TRANSMITTANCE
##XFACTOR=1.0
##YFACTOR=0.5
##FIRSTX=100.0
##LASTX=106.0
##NPOINTS=7
##FIRSTY=5.0
##XYDATA=(X++(Y..Y))
100 10 12 15
103 15 15 13 10
##END="""


def test_import_fix_reconstructs_x_and_scales_y() -> None:
    ds = import_jcamp_from_text(_FIX)
    assert len(ds.time) == 7
    assert_allclose(ds.time, np.linspace(100.0, 106.0, 7))
    assert_allclose(ds.values[:, 0], np.array([10, 12, 15, 15, 15, 13, 10]) * 0.5)
    assert ds.labels == ("Transmittance",)
    assert ds.metadata["x_column_unit"] == "1/CM"
    assert ds.metadata["data_form"] == "XYDATA"


def test_npoints_mismatch_raises() -> None:
    bad = _FIX.replace("##NPOINTS=7", "##NPOINTS=9")
    with pytest.raises(ValueError, match="NPOINTS"):
        import_jcamp_from_text(bad)


def test_xypoints_explicit_pairs() -> None:
    text = """##TITLE=peaks
##XYPOINTS=(XY..XY)
100 5; 101 8; 102 3
##END="""
    ds = import_jcamp_from_text(text)
    assert_allclose(ds.time, [100.0, 101.0, 102.0])
    assert_allclose(ds.values[:, 0], [5.0, 8.0, 3.0])


def test_no_data_block_raises() -> None:
    with pytest.raises(ValueError, match="no XYDATA"):
        import_jcamp_from_text("##TITLE=empty\n##END=")


def import_jcamp_from_text(text: str, tmp: Path | None = None) -> object:
    """Helper: write text to a temp .jdx and import it."""
    import tempfile

    d = tmp or Path(tempfile.mkdtemp())
    p = d / "s.jdx"
    p.write_text(text, encoding="latin-1")
    return import_jcamp(p)


def test_sniffer(tmp_path: Path) -> None:
    good = tmp_path / "a.jdx"
    good.write_text(_FIX, encoding="latin-1")
    assert is_jcamp(good)
    bad = tmp_path / "b.jdx"
    bad.write_text("just some text\nnot jcamp", encoding="latin-1")
    assert not is_jcamp(bad)


# --------------------------------------------------------------------------
# realdata — JCAMP's own integrity fields are the oracle
# --------------------------------------------------------------------------
_CORPUS = [
    ("ir/ethanol.jdx", 3570),
    ("ir/benzene.jdx", 3343),
    ("ir/isopropanol_asdf.jdx", 9541),
    ("torture/fixdec1.jdx", 3951),
    ("torture/pacdec1.jdx", 3301),
    ("torture/sqzdec1.jdx", 16384),
    ("torture/dupdec1.jdx", 3951),
    ("torture/sqzdupd1.jdx", 18669),
]


@pytest.mark.realdata
@pytest.mark.parametrize(("rel", "npoints"), _CORPUS)
def test_corpus_decodes_to_npoints(corpus_dir: Path, rel: str, npoints: int) -> None:
    path = corpus_dir / "jcamp" / rel
    if not path.exists():
        pytest.skip(f"corpus file missing: {rel}")
    ds = import_auto(str(path))
    assert len(ds.time) == npoints  # decoded count == ##NPOINTS (the integrity check)
    assert np.all(np.isfinite(ds.values[:, 0]))
    # abscissa is monotonic (ascending or descending per the scan direction)
    dx = np.diff(ds.time)
    assert np.all(dx > 0) or np.all(dx < 0)


# --------------------------------------------------------------------------
# Compound LINK files + ##PEAK ASSIGNMENTS (2026-07-25 corpus defect):
# the official ISAS_CDX conformance file buries an NMR assignments block
# behind a JCAMP-CS structure block, and its payload is (XYMA) tuples —
# a data class this parser previously did not read at all.
# --------------------------------------------------------------------------
_LINK = """##TITLE= envelope compound
##JCAMP-DX= 4.24
##DATA TYPE= LINK
##BLOCKS= 2
##TITLE= Structure: not a spectrum
##JCAMP-CS= 3.7
##BLOCK_ID= 1
##ATOMLIST=
1 C
2 C
##END=   $$ end structure block
##TITLE= NMR data block
##JCAMP-DX= 5.00
##DATA TYPE= NMR PEAK ASSIGNMENTS
##BLOCK_ID= 2
##XUNITS= PPM
##YUNITS= ARBITRARY UNITS
##NPOINTS= 3
##PEAK ASSIGNMENTS= (XYMA)
( 27.00, 1.0,, < 7>)
( 32.10, 2.0,, < 6>)
(218.40, 1.5,, < 2>)
##END=   $$ end data block
##END=   $$ end compound file"""


def test_link_finds_data_behind_structure_block() -> None:
    ds = import_jcamp_from_text(_LINK)
    assert_allclose(ds.time, [27.0, 32.1, 218.4])
    assert_allclose(ds.values[:, 0], [1.0, 2.0, 1.5])
    # The data block's own labels win over the LINK envelope's.
    assert ds.metadata["title"] == "NMR data block"
    assert ds.metadata["data_type"] == "NMR PEAK ASSIGNMENTS"
    assert ds.metadata["x_column_unit"] == "PPM"
    assert ds.metadata["data_form"] == "PEAKASSIGNMENTS"
    assert ds.metadata["peak_assignments"] == ["7", "6", "2"]
    assert ds.metadata["extra_blocks"] == 2


def test_assignments_without_y_default_to_one() -> None:
    text = """##TITLE= xa only
##PEAK ASSIGNMENTS= (XA)
(10.5, <a>)(11.5, <b>)
##END="""
    ds = import_jcamp_from_text(text)
    assert_allclose(ds.time, [10.5, 11.5])
    assert_allclose(ds.values[:, 0], [1.0, 1.0])
    assert ds.metadata["peak_assignments"] == ["a", "b"]


@pytest.mark.realdata
def test_real_isas_cdx_link_file(corpus_dir: Path) -> None:
    """The official jcamp-dx.org ISAS_CDX conformance file: LINK envelope,
    JCAMP-CS structure block first, then 13C assignments — 16 peaks."""
    path = corpus_dir / "jcamp" / "ir" / "nzhagen_official_ISAS_CDX.dx"
    if not path.exists():
        pytest.skip("corpus file missing")
    ds = import_auto(str(path))
    assert len(ds.time) == 16
    assert_allclose(ds.time[0], 27.0)
    assert_allclose(ds.time[-1], 218.4)
    assert ds.metadata["data_type"] == "NMR PEAK ASSIGNMENTS"
    assert ds.metadata["x_column_unit"] == "PPM"
    assert len(ds.metadata["peak_assignments"]) == 16
