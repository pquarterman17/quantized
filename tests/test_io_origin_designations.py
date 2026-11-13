"""Origin ``.ogs`` export: column designations, comments and the default graph.

Audit 2026-11 (Origin interchange): the keyword fallback matched substrings
(``"Kerr"``/``"Hydrogen"``/``"Standard"``/``"Drift"`` became yErr), declared
``column_designations`` were ignored, comments were dropped, and the default
graph plotted only column 2. These tests pin the fixed contract.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from quantized.datastruct import DataStruct
from quantized.io._column_roles import LABTALK_COLUMN_TYPE, channel_designations, is_error_label
from quantized.io.origin import (
    GraphSpec,
    format_origin_project_script,
    format_origin_script,
)


def _ds(labels: list[str], meta: dict[str, Any] | None = None) -> DataStruct:
    n = len(labels)
    return DataStruct.create(
        [1.0, 2.0, 3.0],
        [[float(10 * r + c) for c in range(n)] for r in range(3)],
        labels=labels,
        units=[""] * n,
        metadata={"x_column_name": "Field", "x_column_unit": "T", **(meta or {})},
    )


def _types(ogs: str) -> list[str]:
    return [ln for ln in ogs.splitlines() if ".type = " in ln and ln.startswith("wks.col")]


def test_labtalk_type_codes_are_origins_documented_enum() -> None:
    # OriginLab LabTalk reference, wks.col.type: 1 Y, 2 Disregard, 3 Y Error,
    # 4 X, 5 Label, 6 Z, 7 X Error.
    assert LABTALK_COLUMN_TYPE == {
        "Y": 1, "disregard": 2, "Y-error": 3, "X": 4, "label": 5, "Z": 6, "X-error": 7,
    }


def test_keyword_fallback_matches_whole_tokens_not_substrings() -> None:
    labels = ["Kerr Signal", "Hydrogen", "Standard", "Drift", "Kerr err", "dR", "R_std"]
    _, ogs = format_origin_script(_ds(labels), make_graph=False)
    assert _types(ogs) == [
        "wks.col1.type = 4;  // X",
        "wks.col2.type = 1;  // Y",
        "wks.col3.type = 1;  // Y",
        "wks.col4.type = 1;  // Y",
        "wks.col5.type = 1;  // Y",
        "wks.col6.type = 3;  // yErr",
        "wks.col7.type = 3;  // yErr",
        "wks.col8.type = 3;  // yErr",
    ]
    assert not is_error_label("Kerr") and is_error_label("σ_M")


def test_empty_error_roles_disable_the_keyword_guess() -> None:
    # The frontend always sends error_roles (`[]` included) for app exports.
    _, ogs = format_origin_script(_ds(["R", "dR"], {"error_roles": []}), make_graph=False)
    assert "wks.col3.type = 1;  // Y" in ogs


def test_column_designations_emit_every_origin_type() -> None:
    meta = {
        "origin_column_names": ["B", "C", "D", "E", "F", "G", "H"],
        "column_designations": {
            "A": "X", "B": "Y", "C": "Y-error", "D": "X-error", "E": "label",
            "F": "disregard", "G": "X", "H": "Z",
        },
    }
    _, ogs = format_origin_script(_ds(list("bcdefgh"), meta), make_graph=False)
    assert [ln.split(" = ")[1] for ln in _types(ogs)] == [
        "4;  // X", "1;  // Y", "3;  // yErr", "7;  // xErr", "5;  // Label",
        "2;  // Disregard", "4;  // X", "6;  // Z",
    ]


def test_positional_designations_without_origin_column_names() -> None:
    # A non-Origin dataset keys its designations by the writer's positional
    # lettering (A = X/time, channel 0 = B, …).
    meta = {"column_designations": {"B": "Y", "C": "Y-error"}}
    assert channel_designations(meta, ["y", "e"]) == ["Y", "Y-error"]


def test_live_error_roles_override_designations() -> None:
    meta = {
        "origin_column_names": ["B", "C", "D"],
        "column_designations": {"B": "Y", "C": "Y-error", "D": "Y"},
        # The user unbound C and bound D as B's error instead.
        "error_roles": [{"channel": 2, "target": 0, "axis": "y", "side": "both"}],
    }
    assert channel_designations(meta, ["b", "c", "d"]) == ["Y", "Y", "Y-error"]


def test_unbound_set_as_error_designation_survives_empty_live_roles() -> None:
    # Integration review: Set As Y Error on a column with no Y before it (and
    # X Error after a secondary X) has no binding to make; the worksheet badge
    # says yErr/xErr and the plot hides the column, so the export must not
    # call it a Y.
    meta = {"error_roles": [], "user_column_designations": {"0": "Y-error", "2": "X-error"}}
    assert channel_designations(meta, ["a", "b", "c"]) == ["Y-error", "Y", "X-error"]
    # A FILE-declared error column the user unbound is still demoted.
    meta = {
        "origin_column_names": ["B", "C"],
        "column_designations": {"B": "Y", "C": "Y-error"},
        "error_roles": [],
    }
    assert channel_designations(meta, ["b", "c"]) == ["Y", "Y"]


def test_default_graph_plots_every_y_against_nearest_preceding_x_with_errors() -> None:
    # Multi-X worksheet: X,Y,yErr,X,Y,Y — each Y binds to its own X group.
    meta = {
        "origin_column_names": ["B", "C", "D", "E", "F"],
        "column_designations": {"A": "X", "B": "Y", "C": "Y-error", "D": "X", "E": "Y", "F": "Y"},
    }
    _, ogs = format_origin_script(_ds(list("bcdef"), meta))
    assert "plotxy iy:=(1,2,3):(4,5):(4,6) plot:=201 ogl:=[<new>];" in ogs
    assert "yl.text$" not in ogs  # several curves: no single Y title


def test_default_graph_uses_declared_error_target() -> None:
    meta = {
        "error_roles": [{"channel": 2, "target": 0, "axis": "y", "side": "both"}],
    }
    _, ogs = format_origin_script(_ds(["M1", "M2", "sM1"], meta))
    assert "plotxy iy:=(1,2,4):(1,3) plot:=201 ogl:=[<new>];" in ogs


def test_default_graph_without_y_columns_is_skipped() -> None:
    meta = {"origin_column_names": ["B"], "column_designations": {"B": "label"}}
    _, ogs = format_origin_script(_ds(["name"], meta))
    assert "plotxy" not in ogs and "no Y-designated column" in ogs


def test_plot_state_all_channels_excludes_error_columns_and_draws_bars() -> None:
    meta = {"error_roles": [{"channel": 1, "target": 0, "axis": "y", "side": "both"}]}
    _, ogs = format_origin_script(_ds(["R", "dR", "T"], meta), graph=GraphSpec())
    assert "plotxy iy:=(1,2,3):(1,4) plot:=201 ogl:=[<new>];" in ogs


def test_column_comments_and_x_long_name_are_exported() -> None:
    meta = {
        "x_column_name": "A",
        "x_column_long": "Magnetic field",
        "origin_column_names": ["B"],
        "column_designations": {"A": "X", "B": "Y"},
        "column_comments": {"A": "swept up", "B": 'spin "up"'},
    }
    _, ogs = format_origin_script(_ds(["M"], meta), make_graph=False)
    assert 'wks.col1.lname$ = "Magnetic field";' in ogs
    assert 'wks.col1.comment$ = "swept up";' in ogs
    assert "wks.col2.comment$ = \"spin 'up'\";" in ogs


def test_header_names_quantized_not_the_matlab_toolbox() -> None:
    _, ogs = format_origin_script(_ds(["M"]))
    assert ogs.splitlines()[0] == "// LabTalk script generated by Quantized"
    assert "quantized_matlab" not in ogs


@pytest.mark.parametrize(
    ("label", "is_error"),
    [
        # error names the review found the first whole-token rule dropped
        ("yerr", True), ("xerr", True), ("Rerr", True), ("stderr", True), ("StdErr", True),
        ("stddev", True), ("IntensityError", True), ("uncertainty", True),
        ("R uncertainty", True), ("StandardError", True), ("KerrErr", True),
        ("err1", True), ("dR2", True), ("M_err", True), ("Kerr err", True),
        ("dR", True), ("R_std", True), ("sigma", True), ("σ_M", True), ("Q error", True),
        # data columns that merely CONTAIN an error keyword
        ("Kerr", False), ("Kerr Signal", False), ("Kerr1", False), ("MokeKerr", False),
        ("Hydrogen", False), ("Standard", False), ("Drift", False), ("Derivative", False),
        ("Ferrite", False), ("Berry", False), ("Overrun", False), ("Intensity", False),
        ("Stderrlog", False), ("Uncertain", False),
    ],
)  # fmt: skip
def test_error_label_token_table(label: str, is_error: bool) -> None:
    assert is_error_label(label) is is_error, label


def test_project_script_header_names_quantized() -> None:
    _, ogs = format_origin_project_script([(_ds(["M"]), "Book1")])
    assert ogs.splitlines()[0] == "// LabTalk project script generated by Quantized"
    assert "generated by quantized" not in ogs


def test_labtalk_substitution_is_neutralised_in_free_text() -> None:
    meta = {
        "origin_column_names": ["B"],
        "column_designations": {"B": "Y"},
        "column_comments": {"B": "see %H and $(1/0) and %(1,@WL) for 50%Fe, arg %1, 100% (ok) $5"},
    }
    _, ogs = format_origin_script(_ds(["%A signal"], meta), make_graph=False)
    line = next(ln for ln in ogs.splitlines() if ln.startswith("wks.col2.comment$"))
    assert line == (
        'wks.col2.comment$ = "see %%H and $ (1/0) and % (1,@WL) for 50%%Fe, arg % 1, '
        '100% (ok) $5";'
    )
    assert 'wks.col2.lname$ = "%%A signal";' in ogs
    # No live substitution token survives anywhere in a quoted string.
    for ln in ogs.splitlines():
        for quoted in re.findall(r'"([^"]*)"', ln):
            assert not re.search(r"(?<!%)%[A-Za-z(@0-9]|\$\(", quoted), ln


def test_percent_runs_are_broken_not_doubled() -> None:
    from quantized.io.origin_graph import escape_lt

    assert escape_lt("%%A") == "%% A"  # never "%%%A" (= "%%" + a live "%A")
    assert escape_lt("%%%(x)") == "%%% (x)"
    assert escape_lt("50 %") == "50 %" and escape_lt("a%%") == "a%%"
