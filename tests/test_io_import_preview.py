"""Interactive import engine (io.import_preview): guess / preview / parse.

Covers the #40 acceptance case (a messy multi-header instrument ASCII imports
correctly through adjustable settings) plus delimiter variants, role overrides,
and the ImportSettings round-trip.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.io.import_error_bindings import (
    AXIS_CONTRADICTS_TARGET,
    COLUMN_NOT_ERROR_ROLE,
    COLUMN_OUT_OF_RANGE,
    DUPLICATE_COLUMN,
    DUPLICATE_TARGET,
    INVALID_AXIS,
    INVALID_SIDE,
    NO_X_COLUMN,
    TARGET_EQUALS_COLUMN,
    TARGET_NOT_Y_ROLE,
    TARGET_OUT_OF_RANGE,
    ErrorBinding,
)
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


# --- P1-5 DEFECT 1: multiple x-role columns must be rejected, not silently ---
# --- truncated to x_cols[0] (parse_import used to keep only the FIRST x   ---
# --- column and drop every other one -- not a channel, not text, nothing). --


def test_multiple_x_roles_is_rejected_naming_the_columns() -> None:
    """RED before the fix: two columns marked 'x' used to silently import
    with only the FIRST as the axis -- the second x column vanished from the
    DataStruct entirely (not a channel, not a text_columns entry, no trace).
    parse_import must instead reject with a message naming the columns."""
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["x", "y", "x"])
    with pytest.raises(ValueError, match="Temp") as exc_info:
        parse_import(_LABEL_TEXT, settings)
    assert "Sample" in str(exc_info.value)


def test_single_x_role_still_imports_fine() -> None:
    """Sanity: the rejection is specific to MULTIPLE x columns -- a single x
    column (the overwhelmingly common case) is untouched."""
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["x", "y", "ignore"])
    ds = parse_import(_LABEL_TEXT, settings)
    assert ds.metadata["x_column_name"] == "Temp"


def test_no_x_role_still_falls_back_to_sample_index() -> None:
    """Sanity: zero x columns is unaffected -- the existing sample-index
    fallback still applies."""
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["y", "y", "ignore"])
    ds = parse_import(_LABEL_TEXT, settings)
    assert ds.metadata["x_column_name"] == "Sample Index"


# --- P1-5 DEFECT 2: preview_import must report the EFFECTIVE (post-label_line) --
# --- name per column, since the wizard's suggestion engine classifies against --
# --- whatever name preview_import returns, and parse_import (not preview_import) --
# --- is the one that actually applies label_line overrides today.          ---


def test_preview_reports_effective_name_matching_label_line_override() -> None:
    """RED before the fix: preview_import's `columns[k].name` is always the
    HEADER-derived name -- it never applies `_label_row_overrides`, unlike
    parse_import. A wizard classifying error-role suggestions against
    `columns[k].name` (the only name preview_import offers today) would
    therefore classify against a name the final dataset never carries
    whenever label_line is set."""
    settings = ImportSettings(
        header_line=0, units_line=1, label_line=2, data_start_line=3, roles=["x", "y", "y"]
    )
    pv = preview_import(_MULTI_ROW_TEXT, settings)
    assert [c["name"] for c in pv["columns"]] == ["Temp", "M1", "M2"]
    assert [c["effective_name"] for c in pv["columns"]] == ["Temp", "NbAu-1", "NbAu-2"]


def test_preview_effective_name_matches_parse_import_labels_exactly() -> None:
    """The whole point of `effective_name`: on the SAME fixture, the channel
    columns' effective_name must equal parse_import's actual .labels, so the
    wizard classifies against the name the dataset will really carry."""
    settings = ImportSettings(
        header_line=0, units_line=1, label_line=2, data_start_line=3, roles=["x", "y", "y"]
    )
    pv = preview_import(_MULTI_ROW_TEXT, settings)
    ds = parse_import(_MULTI_ROW_TEXT, settings)
    channel_effective_names = [
        c["effective_name"] for c in pv["columns"] if c["role"] in ("y", "error", "categorical")
    ]
    assert tuple(channel_effective_names) == ds.labels


def test_preview_effective_name_without_label_line_matches_header_name() -> None:
    """Absent label_line, effective_name is just the header-derived name --
    additive, no behavior change for the common no-label_line case."""
    settings = ImportSettings(header_line=0, units_line=1, data_start_line=3, roles=["x", "y", "y"])
    pv = preview_import(_MULTI_ROW_TEXT, settings)
    assert [c["effective_name"] for c in pv["columns"]] == [c["name"] for c in pv["columns"]]


# --- P1.6 item 4: error-column bindings (raw-column-indexed, ImportSettings) --

# Temp(x=0), Moment(y=1), dMoment(error=2), Field(y=3), dField(error=4) --
# two independent error columns so drop-reason tests can exercise ONE bad
# binding on its own error column while a GOOD binding (on a different
# column) survives alongside it, proving drops are per-binding, not
# all-or-nothing.
_ERR_TEXT = "Temp,Moment,dMoment,Field,dField\n1,10,0.1,100,1\n2,20,0.2,100,1\n3,30,0.3,100,1\n"
_ERR_ROLES = ["x", "y", "error", "y", "error"]
_GOOD_BINDING = ErrorBinding(column=2, target=1, axis="y", side="both")  # dMoment -> Moment


def _err_settings(bindings: list[ErrorBinding] | None) -> ImportSettings:
    return ImportSettings(
        header_line=0, data_start_line=1, roles=list(_ERR_ROLES), error_bindings=bindings
    )


def test_import_settings_error_bindings_default_to_none() -> None:
    assert ImportSettings().error_bindings is None


def test_import_settings_error_bindings_roundtrip_through_dict() -> None:
    s = _err_settings([_GOOD_BINDING, ErrorBinding(column=4, target=3, axis="x", side="+")])
    assert ImportSettings.from_dict(s.to_dict()) == s
    assert s.to_dict()["error_bindings"] == [
        {"column": 2, "target": 1, "axis": "y", "side": "both"},
        {"column": 4, "target": 3, "axis": "x", "side": "+"},
    ]


def test_from_dict_drops_malformed_error_binding_entries_keeping_the_good_ones() -> None:
    payload = {
        "roles": _ERR_ROLES,
        "error_bindings": [
            {"column": 2, "target": 1, "axis": "y", "side": "both"},  # good
            {"column": 4},  # missing target/axis/side
            "not a dict",
            123,
            None,
            {"column": "oops", "target": 1, "axis": "y", "side": "both"},  # wrong type
            # good, ignores an extra key
            {"column": 4, "target": 3, "axis": "y", "side": "both", "extra": "ignored"},
            {"column": 4, "target": 3, "axis": "sideways", "side": "both"},  # bad axis literal
            {"column": True, "target": 1, "axis": "y", "side": "both"},  # bool isn't a real index
        ],
    }
    settings = ImportSettings.from_dict(payload)
    assert settings.error_bindings == [
        ErrorBinding(column=2, target=1, axis="y", side="both"),
        ErrorBinding(column=4, target=3, axis="y", side="both"),
    ]


def test_from_dict_error_bindings_non_list_or_absent_is_none() -> None:
    assert ImportSettings.from_dict({"error_bindings": "oops"}).error_bindings is None
    assert ImportSettings.from_dict({"error_bindings": None}).error_bindings is None
    assert ImportSettings.from_dict({}).error_bindings is None


def test_preview_reports_kept_error_bindings_with_no_problems() -> None:
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict()]
    assert pv["error_binding_problems"] == []


def test_preview_error_binding_keys_are_present_even_when_unset() -> None:
    """Unlike `metadata['error_roles']` on the DataStruct (which is omitted
    entirely when there is nothing to report), the preview payload's two
    keys are always present -- an empty list IS the "nothing bound / nothing
    wrong" answer the wizard needs to render, not something to omit."""
    pv = preview_import(_ERR_TEXT, _err_settings(None))
    assert pv["error_bindings"] == []
    assert pv["error_binding_problems"] == []


def test_drop_invalid_axis() -> None:
    bad = ErrorBinding(column=4, target=3, axis="sideways", side="both")  # type: ignore[arg-type]
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING, bad]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict()]
    [problem] = pv["error_binding_problems"]
    assert problem["code"] == INVALID_AXIS


def test_drop_invalid_side() -> None:
    bad = ErrorBinding(column=4, target=3, axis="y", side="sideways")  # type: ignore[arg-type]
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING, bad]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict()]
    [problem] = pv["error_binding_problems"]
    assert problem["code"] == INVALID_SIDE


def test_drop_column_out_of_range() -> None:
    bad = ErrorBinding(column=99, target=3, axis="y", side="both")
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING, bad]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict()]
    [problem] = pv["error_binding_problems"]
    assert problem["code"] == COLUMN_OUT_OF_RANGE
    assert "99" in problem["reason"]


def test_drop_column_not_error_role() -> None:
    """The bound column exists but isn't marked `error` (e.g. `Field` here
    is a `y` column) -- named by NAME in the reason."""
    bad = ErrorBinding(column=3, target=1, axis="y", side="both")  # Field is role "y"
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING, bad]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict()]
    [problem] = pv["error_binding_problems"]
    assert problem["code"] == COLUMN_NOT_ERROR_ROLE
    assert "Field" in problem["reason"]


def test_drop_binding_reroled_to_ignore_is_named_by_column() -> None:
    """A binding recorded while its column was `error`, later re-roled to
    `ignore` by the user -- must drop with a reason naming the column, not
    silently vanish."""
    text = "Temp,Moment,dMoment\n1,10,0.1\n2,20,0.2\n"
    settings = ImportSettings(
        header_line=0, data_start_line=1, roles=["x", "y", "ignore"],
        error_bindings=[ErrorBinding(column=2, target=1, axis="y", side="both")],
    )
    pv = preview_import(text, settings)
    assert pv["error_bindings"] == []
    [problem] = pv["error_binding_problems"]
    assert problem["code"] == COLUMN_NOT_ERROR_ROLE
    assert "dMoment" in problem["reason"]


def test_drop_target_out_of_range() -> None:
    bad = ErrorBinding(column=4, target=99, axis="y", side="both")
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING, bad]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict()]
    [problem] = pv["error_binding_problems"]
    assert problem["code"] == TARGET_OUT_OF_RANGE
    assert "99" in problem["reason"]


def test_drop_target_equals_column() -> None:
    bad = ErrorBinding(column=4, target=4, axis="y", side="both")
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING, bad]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict()]
    [problem] = pv["error_binding_problems"]
    assert problem["code"] == TARGET_EQUALS_COLUMN
    assert "dField" in problem["reason"]


def test_drop_target_not_y_role() -> None:
    """target=0 is `Temp`, role `x` (and not -1, the "x axis" sentinel) --
    a real column pointed at with a role that can't be an error target."""
    bad = ErrorBinding(column=4, target=0, axis="y", side="both")
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING, bad]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict()]
    [problem] = pv["error_binding_problems"]
    assert problem["code"] == TARGET_NOT_Y_ROLE
    assert "Temp" in problem["reason"]


def test_drop_target_not_y_role_rejects_another_error_column_as_target() -> None:
    """A target must be `y`, not `error` -- two error columns can't describe
    each other."""
    bad = ErrorBinding(column=4, target=2, axis="y", side="both")  # dField -> dMoment (error)
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING, bad]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict()]
    [problem] = pv["error_binding_problems"]
    assert problem["code"] == TARGET_NOT_Y_ROLE


def test_drop_duplicate_column_keeps_the_first() -> None:
    dup = ErrorBinding(column=2, target=3, axis="y", side="both")  # same column as _GOOD_BINDING
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING, dup]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict()]
    [problem] = pv["error_binding_problems"]
    assert problem["code"] == DUPLICATE_COLUMN
    assert "dMoment" in problem["reason"]


def test_target_minus_one_is_always_the_x_axis_never_dropped() -> None:
    bad = ErrorBinding(column=4, target=-1, axis="x", side="both")
    pv = preview_import(_ERR_TEXT, _err_settings([_GOOD_BINDING, bad]))
    assert pv["error_bindings"] == [_GOOD_BINDING.to_dict(), bad.to_dict()]
    assert pv["error_binding_problems"] == []


# --- parse_import: raw column -> channel index translation -----------------


def test_binding_to_the_x_axis_with_a_y_axis_is_dropped() -> None:
    """`target == -1` names the x axis specifically, so `axis="y"` on it is
    self-contradictory: it would persist a binding nothing can render, giving
    the user neither error bars nor a diagnostic."""
    s = _err_settings([ErrorBinding(column=2, target=-1, axis="y", side="both")])
    out = preview_import(_ERR_TEXT, s)
    assert out["error_bindings"] == []
    problem = out["error_binding_problems"][0]
    assert problem["code"] == AXIS_CONTRADICTS_TARGET
    assert "must be 'x'" in problem["reason"]


def test_binding_to_the_x_axis_is_dropped_when_no_column_holds_the_x_role() -> None:
    """With no x column, `parse_import` synthesizes a 1..N sample index —
    error bars on a row counter are meaningless, so the binding is stale in
    exactly the way a y target that lost its role is."""
    s = ImportSettings(
        header_line=0,
        data_start_line=1,
        roles=["y", "y", "error", "y", "error"],  # no x role anywhere
        error_bindings=[ErrorBinding(column=2, target=-1, axis="x", side="both")],
    )
    out = preview_import(_ERR_TEXT, s)
    assert out["error_bindings"] == []
    problem = out["error_binding_problems"][0]
    assert problem["code"] == NO_X_COLUMN
    assert "no column is marked with the x role" in problem["reason"]


def test_two_columns_claiming_one_target_axis_side_keeps_only_the_first() -> None:
    """The frontend keys error channels by target, so a second binding for the
    same target/axis/side would silently displace the first downstream. Drop it
    here instead, with a reason that names both ends."""
    s = _err_settings([
        ErrorBinding(column=2, target=1, axis="y", side="both"),
        ErrorBinding(column=4, target=1, axis="y", side="both"),
    ])
    out = preview_import(_ERR_TEXT, s)
    assert [b["column"] for b in out["error_bindings"]] == [2]
    problem = out["error_binding_problems"][0]
    assert problem["code"] == DUPLICATE_TARGET
    assert problem["column"] == 4


def test_two_columns_may_hold_opposite_sides_of_one_target() -> None:
    """The reason asymmetric error bars exist: a `-` and a `+` column for the
    same signal are NOT duplicates and must both survive."""
    s = _err_settings([
        ErrorBinding(column=2, target=1, axis="y", side="-"),
        ErrorBinding(column=4, target=1, axis="y", side="+"),
    ])
    out = preview_import(_ERR_TEXT, s)
    assert [b["column"] for b in out["error_bindings"]] == [2, 4]
    assert out["error_binding_problems"] == []


def test_parse_import_error_roles_absent_when_no_bindings_set() -> None:
    ds = parse_import(_MESSY, guess_settings(_MESSY))
    assert "error_roles" not in ds.metadata


def test_parse_import_translates_raw_columns_to_channel_indices() -> None:
    ds = parse_import(_ERR_TEXT, _err_settings([_GOOD_BINDING]))
    # chan_cols raw order is [1, 2, 3, 4] (Moment, dMoment, Field, dField) ->
    # channel indices [0, 1, 2, 3]; column=2 (dMoment) -> channel 1,
    # target=1 (Moment) -> channel 0.
    assert ds.labels == ("Moment", "dMoment", "Field", "dField")
    assert ds.metadata["error_roles"] == [{"channel": 1, "target": 0, "axis": "y", "side": "both"}]


def test_parse_import_translates_raw_columns_with_categorical_channel_after_numeric() -> None:
    """A categorical column shifts the channel numbering (P1.4: categorical
    channels append AFTER every numeric one) -- exercise that ordering
    actually flows into the translated `error_roles` indices."""
    text = "Temp,Moment,dMoment,Sample\n1,10,0.1,A\n2,20,0.2,B\n3,30,0.3,A\n"
    settings = ImportSettings(
        header_line=0, data_start_line=1, roles=["x", "y", "error", "categorical"],
        error_bindings=[ErrorBinding(column=2, target=1, axis="y", side="both")],
    )
    ds = parse_import(text, settings)
    assert ds.labels == ("Moment", "dMoment", "Sample")  # numeric first, categorical after
    assert ds.metadata["error_roles"] == [{"channel": 1, "target": 0, "axis": "y", "side": "both"}]


def test_parse_import_error_target_is_the_x_axis() -> None:
    text = "Temp,dTemp,Moment\n1,0.1,10\n2,0.1,20\n"
    settings = ImportSettings(
        header_line=0, data_start_line=1, roles=["x", "error", "y"],
        error_bindings=[ErrorBinding(column=1, target=-1, axis="x", side="both")],
    )
    ds = parse_import(text, settings)
    assert ds.labels == ("dTemp", "Moment")
    assert ds.metadata["error_roles"] == [{"channel": 0, "target": -1, "axis": "x", "side": "both"}]


def test_parse_import_carries_each_side_through_unchanged_to_frontend_signs() -> None:
    """`lower`/`upper`/`both` (this module's storage vocabulary) become
    `-`/`+`/`both` (`frontend/src/lib/errorRoles.ts`'s `ErrorSide`) so the
    frontend needs no translation layer of its own to consume this."""
    settings = _err_settings([
        ErrorBinding(column=2, target=1, axis="y", side="+"),
        ErrorBinding(column=4, target=3, axis="y", side="-"),
    ])
    ds = parse_import(_ERR_TEXT, settings)
    sides = {e["channel"]: e["side"] for e in ds.metadata["error_roles"]}
    assert sides == {1: "+", 3: "-"}


def test_parse_import_drops_stale_binding_silently_from_metadata() -> None:
    """A binding that fails validation contributes nothing to
    `error_roles` -- it never raises `parse_import`, matching the
    "never an exception, always reported (via preview) instead" contract;
    parse_import itself has nowhere to surface the drop reason, so it's
    simply absent here (the wizard is expected to have shown/resolved it
    via `preview_import` before Import is ever reachable)."""
    settings = _err_settings([ErrorBinding(column=99, target=1, axis="y", side="both")])
    ds = parse_import(_ERR_TEXT, settings)
    assert "error_roles" not in ds.metadata


# ── P16: suggested_error_bindings (name/position-driven, raw-column-indexed) ─

def test_preview_carries_name_driven_suggestions_for_every_error_column() -> None:
    # dMoment -> Moment (col 1), dField -> Field (col 3) -- both base-name
    # matches, so both survive the wizard's two-tier narrowing regardless
    # of what follows.
    pv = preview_import(_ERR_TEXT, _err_settings(None))
    assert pv["suggested_error_bindings"] == [
        {"column": 2, "target": 1, "axis": "y", "side": "both"},
        {"column": 4, "target": 3, "axis": "y", "side": "both"},
    ]


def test_suggestions_are_independent_of_confirmed_error_bindings() -> None:
    """Suggestions are computed fresh from the file's resolved columns on
    every preview -- present alongside `error_bindings` even when the user
    already confirmed a (different) set, and never merged into it."""
    confirmed = ErrorBinding(column=4, target=3, axis="y", side="both")
    pv = preview_import(_ERR_TEXT, _err_settings([confirmed]))
    assert pv["error_bindings"] == [confirmed.to_dict()]
    assert pv["suggested_error_bindings"] == [
        {"column": 2, "target": 1, "axis": "y", "side": "both"},
        {"column": 4, "target": 3, "axis": "y", "side": "both"},
    ]


def test_suggestions_are_empty_when_no_column_is_marked_error() -> None:
    pv = preview_import(_MESSY, guess_settings(_MESSY))
    assert pv["suggested_error_bindings"] == []


def test_suggestions_demote_a_genuinely_ambiguous_positional_pairing() -> None:
    # "T err" sits between two equally plausible y columns -- the wizard's
    # two-tier narrowing must leave it unsuggested (see
    # error_binding_suggestions.py / importwizard.ts's TWO-TIER rule),
    # unlike the raw infer_error_bindings_from_labels, which would bind it.
    text = "T1,T err,T2\n1,0.1,2\n3,0.1,4\n"
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["y", "error", "y"])
    pv = preview_import(text, settings)
    assert pv["suggested_error_bindings"] == []
