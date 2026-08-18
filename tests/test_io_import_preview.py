"""Interactive import engine (io.import_preview): guess / preview / parse.

Covers the #40 acceptance case (a messy multi-header instrument ASCII imports
correctly through adjustable settings) plus delimiter variants, role overrides,
and the ImportSettings round-trip.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.io.import_preview import (
    DATA_ROLES,
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


def test_trailing_delimiter_does_not_add_phantom_column() -> None:
    # a tab-terminated file (common Excel/instrument artifact) must not create
    # an extra all-NaN "Col3" channel (regression of the import_csv guard)
    text = "Time\tValue\t\n1\t10\t\n2\t20\t\n3\t30\t\n"
    g = guess_settings(text)
    assert g.column_names == ["Time", "Value"] and g.roles == ["x", "y"]
    ds = parse_import(text, g)
    assert ds.labels == ("Value",) and ds.values.shape == (3, 1)


def test_interior_empty_cell_is_preserved() -> None:
    # only *trailing* empties are trimmed; a missing interior value stays a column
    text = "a,b,c\n1,,3\n4,,6"
    pv = preview_import(text, ImportSettings(delimiter=",", header_line=0, data_start_line=1))
    assert len(pv["columns"]) == 3
    assert pv["rows"][0] == [1.0, None, 3.0]


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


# --- P1.4: "label" role no longer drops raw strings; "categorical" role ----

_LABEL_TEXT = "Temp,Moment,Sample\n1,10,NbAu-1\n2,20,NbAu-2\n3,30,NbAu-1\n"


def test_label_role_captures_raw_strings_instead_of_discarding_them() -> None:
    """RED before this fix: the wizard's 'label' role silently dropped the
    'Sample' column entirely -- no metadata trace at all, worse than a
    default/silent import (which never even offers a 'label' role and so
    never lost anything). Parity means it now lands in the SAME
    `text_columns` sidecar shape `import_csv` already emits."""
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["x", "y", "label"])
    ds = parse_import(_LABEL_TEXT, settings)
    assert ds.labels == ("Moment",)  # label column still excluded from .values
    assert ds.metadata["text_columns"] == {"Sample": ["NbAu-1", "NbAu-2", "NbAu-1"]}


def test_ignore_role_still_drops_with_no_sidecar_capture() -> None:
    """`ignore` is an explicit user choice to discard -- unlike `label`, it
    gets no text_columns capture."""
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["x", "y", "ignore"])
    ds = parse_import(_LABEL_TEXT, settings)
    assert ds.labels == ("Moment",)
    assert "text_columns" not in ds.metadata


def test_categorical_role_produces_a_categorical_channel() -> None:
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["x", "y", "categorical"])
    ds = parse_import(_LABEL_TEXT, settings)
    assert ds.labels == ("Moment", "Sample")
    assert ds.cat_levels == {1: ("NbAu-1", "NbAu-2")}
    assert ds.column("Sample").tolist() == [0.0, 1.0, 0.0]
    assert "text_columns" not in ds.metadata  # categorical, not label -- no sidecar duplication


def test_categorical_role_is_in_data_roles() -> None:
    assert "categorical" in DATA_ROLES


def test_categorical_only_columns_still_import_with_no_y_channels() -> None:
    """A categorical column alone satisfies "something was selected" -- the
    old "no y/error columns" gate must not reject a categorical-only pick."""
    text = "Sample\nA\nB\nA\n"
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["categorical"])
    ds = parse_import(text, settings)
    assert ds.labels == ("Sample",)
    assert ds.cat_levels == {0: ("A", "B")}
    assert ds.time.tolist() == [1.0, 2.0, 3.0]  # no x role -> row index


def test_categorical_import_round_trips_through_dict() -> None:
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["x", "y", "categorical"])
    ds = parse_import(_LABEL_TEXT, settings)
    from quantized.datastruct import DataStruct

    back = DataStruct.from_dict(ds.to_dict())
    assert back.cat_levels == ds.cat_levels
    assert back.labels == ds.labels
