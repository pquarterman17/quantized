"""Interactive import engine (io.import_preview): guess / preview / parse.

Covers the #40 acceptance case (a messy multi-header instrument ASCII imports
correctly through adjustable settings) plus delimiter variants, role overrides,
and the ImportSettings round-trip.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.io.import_preview import (
    ImportSettings,
    guess_settings,
    parse_import,
    preview_import,
)

_MESSY = """# Instrument XYZ export
# Sample: NiFe thin film
# Date: 2026-07-03
Temperature,Moment,Field
(K),(emu),(Oe)
300,0.0012,100
250,0.0015,100
200,0.0021,100
150,0.0034,100"""


def test_guess_multiheader_instrument_file() -> None:
    g = guess_settings(_MESSY)
    assert g.header_line == 3 and g.units_line == 4 and g.data_start_line == 5
    assert g.column_names == ["Temperature", "Moment", "Field"]
    assert g.roles == ["x", "y", "y"]


def test_preview_columns_and_rows() -> None:
    g = guess_settings(_MESSY)
    pv = preview_import(_MESSY, g)
    assert pv["delimiter"] == "," and pv["n_data_rows"] == 4
    assert [c["name"] for c in pv["columns"]] == ["Temperature", "Moment", "Field"]
    assert [c["unit"] for c in pv["columns"]] == ["K", "emu", "Oe"]
    assert pv["rows"][0] == [300.0, 0.0012, 100.0]
    assert pv["raw_lines"][0].startswith("# Instrument")  # comments shown to the user


def test_parse_builds_datastruct() -> None:
    ds = parse_import(_MESSY, guess_settings(_MESSY))
    assert ds.labels == ("Moment", "Field")
    assert ds.units == ("emu", "Oe")
    assert ds.time[0] == 300.0 and ds.n_channels == 2
    assert ds.metadata["x_column_name"] == "Temperature"
    assert ds.metadata["x_column_unit"] == "K"


def test_role_override_changes_axis_and_drops_column() -> None:
    g = guess_settings(_MESSY)
    # make Field the x-axis, ignore Moment -> single channel (Temperature) vs Field
    settings = ImportSettings(
        delimiter=g.delimiter, header_line=g.header_line, units_line=g.units_line,
        data_start_line=g.data_start_line, column_names=g.column_names,
        roles=["y", "ignore", "x"],
    )
    ds = parse_import(_MESSY, settings)
    assert ds.labels == ("Temperature",)  # Moment ignored, Field is now x
    assert ds.metadata["x_column_name"] == "Field"
    np.testing.assert_allclose(ds.time, [100, 100, 100, 100])


def test_tab_and_semicolon_and_whitespace_delimiters() -> None:
    tab_s = ImportSettings(delimiter="tab", header_line=0, data_start_line=1)
    assert preview_import("a\tb\n1\t2\n3\t4", tab_s)["rows"] == [[1.0, 2.0], [3.0, 4.0]]
    semi_s = ImportSettings(delimiter=";", header_line=0, data_start_line=1)
    assert preview_import("a;b\n1;2\n3;4", semi_s)["n_data_rows"] == 2
    ws_s = ImportSettings(delimiter="whitespace", header_line=0, data_start_line=1)
    assert preview_import("a  b\n1   2\n3  4", ws_s)["rows"] == [[1.0, 2.0], [3.0, 4.0]]


def test_headerless_numeric_defaults_to_col_names() -> None:
    numeric = "1,2,3\n4,5,6\n7,8,9"
    g = guess_settings(numeric)
    assert g.header_line is None and g.data_start_line == 0
    ds = parse_import(numeric, g)
    assert ds.labels == ("Col2", "Col3")  # Col1 is the default x
    np.testing.assert_allclose(ds.time, [1, 4, 7])


def test_explicit_delimiter_overrides_autodetect() -> None:
    # commas inside values but pipe is the real delimiter
    text = "x|y\n1,5|2\n3,5|4"
    pv = preview_import(text, ImportSettings(delimiter="pipe", header_line=0, data_start_line=1))
    assert pv["columns"][0]["name"] == "x"
    assert pv["rows"][0] == [None, 2.0]  # "1,5" isn't a float -> NaN -> None


def test_parse_requires_channels() -> None:
    text = "x\n1\n2\n3"
    with pytest.raises(ValueError, match="no y/error columns"):
        parse_import(text, ImportSettings(header_line=0, data_start_line=1, roles=["x"]))


def test_import_settings_roundtrip() -> None:
    s = ImportSettings(delimiter="tab", header_line=2, units_line=3, data_start_line=4,
                       column_names=["a", "b"], roles=["x", "y"])
    assert ImportSettings.from_dict(s.to_dict()) == s
    # unknown keys are ignored on decode
    assert ImportSettings.from_dict({"delimiter": ";", "bogus": 1}).delimiter == ";"
