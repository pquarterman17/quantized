"""Delimited-text / JCAMP / XRDML robustness: the items #812 deferred.

Each test pins one synthetic input that used to import wrong (a categorical
column, a split row, one text column) or fail with a raw message.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io import import_auto
from quantized.io.delimited import import_csv
from quantized.io.jcamp import import_jcamp


def _write(tmp_path: Path, name: str, data: bytes | str) -> Path:
    path = tmp_path / name
    path.write_bytes(data if isinstance(data, bytes) else data.encode())
    return path


# --- 1. inline trailing comments ------------------------------------------------


@pytest.mark.parametrize("mark", ["#", "%"])
def test_inline_comment_is_stripped_from_numeric_rows(tmp_path: Path, mark: str) -> None:
    body = f"a,b,c\n1,2,3 {mark} first\n4,5,6\t{mark} second\n7,8,9\n"
    ds = import_csv(_write(tmp_path, "c.csv", body))
    assert ds.labels == ("b", "c")
    assert not ds.cat_levels
    np.testing.assert_array_equal(ds.time, [1, 4, 7])
    np.testing.assert_array_equal(ds.values, [[2, 3], [5, 6], [8, 9]])


def test_inline_comment_marker_inside_text_or_quotes_is_kept(tmp_path: Path) -> None:
    body = 'name,v\n"a # b",1\nx # y,2\nz,3\nq,4\n'
    ds = import_csv(_write(tmp_path, "q.csv", body))
    assert ds.cat_levels == {1: ("a # b", "x # y", "z", "q")}
    np.testing.assert_array_equal(ds.values[:, 0], [1, 2, 3, 4])


def test_percent_unit_without_comment_is_not_a_comment(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "p.csv", "t,v\n1,5 %\n2,6 %\n3,7 %\n"))
    assert ds.cat_levels  # still text: nothing was stripped


# --- 2. quoted newline --------------------------------------------------------


def test_quoted_newline_stays_one_row(tmp_path: Path) -> None:
    body = 'name,val\n"a\nb",1\n"c\nd",2\n"e",3\n'
    ds = import_csv(_write(tmp_path, "nl.csv", body))
    assert len(ds.time) == 3
    assert ds.cat_levels == {1: ("a\nb", "c\nd", "e")}
    np.testing.assert_array_equal(ds.values[:, 0], [1, 2, 3])


def test_unterminated_quote_does_not_swallow_the_file(tmp_path: Path) -> None:
    body = 'a,b\n"1,2\n' + "".join(f"{i},{i}\n" for i in range(300))
    ds = import_csv(_write(tmp_path, "u.csv", body))
    assert len(ds.time) >= 300


# --- 3. pipe tables -------------------------------------------------------------


def test_pipe_delimited_table(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "p.txt", "T (K) | M (emu)\n1 | 2\n3 | 4\n5 | 6\n"))
    assert ds.labels == ("M",)
    assert ds.units == ("emu",)
    np.testing.assert_array_equal(ds.time, [1, 3, 5])
    assert ds.metadata["delimiter"] == "|"


def test_markdown_pipe_table_with_rule_row(tmp_path: Path) -> None:
    body = "| T (K) | M (emu) | H |\n|---|:---:|---:|\n| 1 | 2 | 7 |\n| 3 | 4 | 8 |\n"
    ds = import_csv(_write(tmp_path, "m.txt", body))
    assert ds.labels == ("M", "H")
    np.testing.assert_array_equal(ds.time, [1, 3])
    np.testing.assert_array_equal(ds.values, [[2, 7], [4, 8]])


def test_stray_pipe_in_one_line_does_not_change_delimiter(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "s.csv", "a,b\n1,2\n3,4 | x\n5,6\n"))
    assert ds.metadata["delimiter"] == ","


# --- 5. BOM-less UTF-16 .dat ----------------------------------------------------


def test_bomless_utf16_dat_is_routed(tmp_path: Path) -> None:
    text = "a,b\n1,2\n3,4\n5,6\n"
    for enc in ("utf-16-le", "utf-16-be"):
        ds = import_auto(_write(tmp_path, f"{enc}.dat", text.encode(enc)))
        assert ds.labels == ("b",)
        np.testing.assert_array_equal(ds.time, [1, 3, 5])


# --- 6. JCAMP XYPOINTS ----------------------------------------------------------

_JCAMP = (
    "##TITLE=t\n##JCAMP-DX=4.24\n##DATA TYPE=INFRARED SPECTRUM\n"
    "##XYPOINTS=(XY..XY)\n{}\n##END=\n"
)


def test_jcamp_xypoints_clean_pairs_import(tmp_path: Path) -> None:
    ds = import_jcamp(_write(tmp_path, "ok.jdx", _JCAMP.format("1,2 3,4 5,6")))
    np.testing.assert_array_equal(ds.time, [1, 3, 5])


def test_jcamp_malformed_pair_fails_closed_naming_the_line(tmp_path: Path) -> None:
    path = _write(tmp_path, "bad.jdx", _JCAMP.format("1,2 3,4\n5,6 abc,8 9,10"))
    with pytest.raises(ValueError, match=r"data line 2.*abc|abc.*data line 2"):
        import_jcamp(path)


# --- 7. XRDML non-numeric counts -----------------------------------------------

_XRDML = """<?xml version="1.0"?>
<xrdMeasurements><xrdMeasurement><scan appendNumber="0" status="Completed">
<dataPoints>
<positions axis="2Theta"><startPosition>10</startPosition><endPosition>12</endPosition></positions>
<commonCountingTime unit="seconds">1</commonCountingTime>
<counts unit="counts">{}</counts>
</dataPoints></scan></xrdMeasurement></xrdMeasurements>
"""


def test_xrdml_non_numeric_count_names_the_element(tmp_path: Path) -> None:
    from quantized.io.xrdml import import_xrdml

    ok = import_xrdml(_write(tmp_path, "ok.xrdml", _XRDML.format("1 2 3")))
    assert len(ok.time) == 3
    with pytest.raises(ValueError, match=r"<counts>.*'?x'?"):
        import_xrdml(_write(tmp_path, "bad.xrdml", _XRDML.format("1 x 3")))
