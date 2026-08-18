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


def test_label_role_strips_whitespace_matching_import_csv_sidecar() -> None:
    """P1.4 review P2-4: RED before this fix -- the wizard's `label` sidecar
    capture skipped the `.strip()` that `io/delimited.py`'s `text_columns`
    sidecar always applies, so a whitespace-padded cell (` NbAu-1 `) landed
    verbatim instead of matching the generic-import convention."""
    text = "Temp,Moment,Sample\n1,10, NbAu-1 \n2,20, NbAu-2 \n"
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["x", "y", "label"])
    ds = parse_import(text, settings)
    assert ds.metadata["text_columns"] == {"Sample": ["NbAu-1", "NbAu-2"]}


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


# --- P1.6: legend-label row + retained preamble ----------------------------

_MULTI_ROW_TEXT = "Temp,M1,M2\n(K),(emu),(emu)\n,NbAu-1,NbAu-2\n1,10,11\n2,20,21\n"


def test_label_line_overrides_channel_labels() -> None:
    """RED before this fix: ImportSettings had no label_line field at all --
    the header row was the only label source, so a 'name'-style legend row
    (a common instrument-export shape, see io/delimited.py's label_rows)
    could not drive the DataStruct's channel labels through the wizard."""
    settings = ImportSettings(
        header_line=0, units_line=1, label_line=2, data_start_line=3, roles=["x", "y", "y"]
    )
    ds = parse_import(_MULTI_ROW_TEXT, settings)
    assert ds.labels == ("NbAu-1", "NbAu-2")
    assert ds.units == ("emu", "emu")  # units_line is untouched by label_line


def test_label_line_absent_leaves_header_derived_labels_unchanged() -> None:
    settings = ImportSettings(header_line=0, units_line=1, data_start_line=3, roles=["x", "y", "y"])
    ds = parse_import(_MULTI_ROW_TEXT, settings)
    assert ds.labels == ("M1", "M2")


def test_label_line_blank_cell_falls_back_to_header_name() -> None:
    """A blank legend-label cell for one column doesn't blank that label --
    it falls back to the header-derived name, same as any other missing
    override."""
    text = "Temp,M1,M2\n,NbAu-1,\n1,10,11\n2,20,21\n"
    settings = ImportSettings(header_line=0, label_line=1, data_start_line=2, roles=["x", "y", "y"])
    ds = parse_import(text, settings)
    assert ds.labels == ("NbAu-1", "M2")


def test_label_line_applies_to_categorical_channels_too() -> None:
    text = "Temp,M1,Sample\n,NbAu-1,\n1,10,A\n2,20,B\n"
    settings = ImportSettings(
        header_line=0, label_line=1, data_start_line=2, roles=["x", "y", "categorical"]
    )
    ds = parse_import(text, settings)
    assert ds.labels == ("NbAu-1", "Sample")  # blank override cell -> header name


def test_label_line_coinciding_with_header_line_reuses_split_names() -> None:
    """Review round P2-1: RED before this fix -- pointing label_line AT the
    header row itself (a plausible "confirm this row as the legend labels
    too" wizard action) re-read the RAW token row, which still carries the
    embedded "(unit)" suffix `_extract_units` already split OUT of
    `p.names` -- so the label silently regained the unit text
    ('Moment (emu)' instead of 'Moment'). Fixed by reusing `p.names`."""
    text = "Temp,Moment (emu)\n1,10\n2,20\n"
    settings = ImportSettings(header_line=0, label_line=0, data_start_line=1, roles=["x", "y"])
    ds = parse_import(text, settings)
    assert ds.labels == ("Moment",)
    assert ds.units == ("emu",)


def test_label_line_coinciding_with_units_line_reuses_split_units() -> None:
    """Same bug, units_line side: label_line pointing at the units row
    re-read the raw bracketed cell instead of the already `strip("()[]{}")`
    -processed `p.units`."""
    text = "Temp,Moment\nK,(emu)\n1,10\n2,20\n"
    settings = ImportSettings(
        header_line=0, units_line=1, label_line=1, data_start_line=2, roles=["x", "y"]
    )
    ds = parse_import(text, settings)
    assert ds.labels == ("emu",)
    assert ds.units == ("emu",)


def test_preview_reports_label_line() -> None:
    settings = ImportSettings(
        header_line=0, units_line=1, label_line=2, data_start_line=3, roles=["x", "y", "y"]
    )
    pv = preview_import(_MULTI_ROW_TEXT, settings)
    assert pv["label_line"] == 2


_PREAMBLE_TEXT = "# Sample: NbAu bilayer\n# Operator: pq\nTemp,Moment\n1,10\n2,20\n"


def test_preamble_lines_retained_as_comments_metadata() -> None:
    """RED before this fix: every line above data_start_line NOT consumed as
    header/units was silently dropped -- no trace anywhere in the resulting
    DataStruct, unlike io/delimited.py's silent-import path, which has always
    kept this preamble in metadata['comments']."""
    settings = ImportSettings(header_line=2, data_start_line=3, roles=["x", "y"])
    ds = parse_import(_PREAMBLE_TEXT, settings)
    assert ds.metadata["comments"] == ["# Sample: NbAu bilayer", "# Operator: pq"]


def test_preview_reports_comments_too() -> None:
    settings = ImportSettings(header_line=2, data_start_line=3, roles=["x", "y"])
    pv = preview_import(_PREAMBLE_TEXT, settings)
    assert pv["comments"] == ["# Sample: NbAu bilayer", "# Operator: pq"]


def test_no_comments_key_when_preamble_is_fully_consumed() -> None:
    """Every preamble line becomes header/units/label -- nothing left over,
    so no comments key at all (matches io/delimited.py's omit-when-absent
    convention)."""
    settings = ImportSettings(
        header_line=0, units_line=1, label_line=2, data_start_line=3, roles=["x", "y", "y"]
    )
    ds = parse_import(_MULTI_ROW_TEXT, settings)
    assert "comments" not in ds.metadata


def test_preamble_comments_capped_at_max() -> None:
    """Review round P3(b): RED before this fix -- `data_start_line` is
    directly user-settable through the wizard (unlike `io/delimited.py`'s
    auto-sniffed preamble), so an oversized value (a typo, or a stale saved
    filter reapplied to a much longer file) walked and retained EVERY
    preceding line as a `comments` entry, unbounded. 600 preamble lines
    caps down to `_MAX_PREAMBLE_COMMENTS` (500), not 600."""
    from quantized.io.import_preview import _MAX_PREAMBLE_COMMENTS

    lines = [f"# comment {i}" for i in range(600)] + ["Temp,Moment", "1,10"]
    text = "\n".join(lines) + "\n"
    settings = ImportSettings(delimiter=",", header_line=600, data_start_line=601, roles=["x", "y"])
    ds = parse_import(text, settings)
    assert len(ds.metadata["comments"]) == _MAX_PREAMBLE_COMMENTS == 500
    assert ds.metadata["comments"][0] == "# comment 0"


def test_comments_survive_alongside_label_rows_and_text_columns() -> None:
    text = "# Instrument log\nTemp,M1,Sample\n1,10,A\n2,20,B\n"
    settings = ImportSettings(header_line=1, data_start_line=2, roles=["x", "y", "label"])
    ds = parse_import(text, settings)
    assert ds.metadata["comments"] == ["# Instrument log"]
    assert ds.metadata["text_columns"] == {"Sample": ["A", "B"]}
