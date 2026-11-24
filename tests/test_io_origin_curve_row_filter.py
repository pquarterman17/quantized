"""Filtered books drawn with their kept rows (``opju_curve_row_filter``, B-37).

Synthetic cases lock the evaluation and every fail-closed branch; the
realdata half checks the public corpus at run time against Origin's own row
counts (COM ``sum()`` per plotted book, recorded 2026-11-15, ledger F-119).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest

from origin_corpus import has_project, origin_corpus_dir
from quantized.datastruct import DataStruct
from quantized.io.origin_project import opju_curve_row_filter as rf
from quantized.io.origin_project import read_origin_books
from quantized.io.origin_project.import_manifest import origin_figures_and_fidelity
from quantized.io.origin_project.opju_sheet_signals import SheetGates
from quantized.io.origin_project.opju_worksheet_filter import WORKSHEET_FILTER_KEY

_GT = {"column": "time", "op": ">", "value": 0.0, "inclusive": False}
_LT = {"column": "error", "op": "<", "value": 0.1, "inclusive": None}


def _book(name: str, x: list[float], b: list[float], stamp: dict[str, Any] | None) -> DataStruct:
    md: dict[str, Any] = {
        "origin_book": name,
        "x_column_name": "A",
        "x_column_long": "time",
        "origin_column_names": ["B"],
    }
    if stamp is not None:
        md[WORKSHEET_FILTER_KEY] = {**stamp, "column_short": "A"}
    return DataStruct(
        time=np.asarray(x, dtype=float),
        values=np.asarray(b, dtype=float).reshape(-1, 1),
        labels=("y",),
        units=("",),
        metadata=md,
    )


def test_strict_greater_than_keeps_rows_above_the_threshold() -> None:
    ds = _book("Book1", [-1.0, 0.0, 0.5, 2.0], [1, 2, 3, 4], _GT)
    assert rf.kept_rows(ds, ds.metadata[WORKSHEET_FILTER_KEY]) == [2, 3]


def test_inclusive_keeps_a_tie_and_less_than_reads_a_value_column() -> None:
    ds = _book("Book1", [0, 1, 2], [0.05, 0.1, 0.2], None)
    cond = {"column_short": "B", "op": "<", "value": 0.1, "inclusive": True}
    assert rf.kept_rows(ds, cond) == [0, 1]
    assert rf.kept_rows(ds, {**cond, "inclusive": False}) == [0]


@pytest.mark.parametrize(
    "cond",
    [
        {"column_short": "B", "op": "<", "value": 0.1, "inclusive": None},  # op 04: unproven
        {"column_short": "Z", "op": ">", "value": 0.0, "inclusive": False},  # no such column
        {"column_short": "B", "op": "=", "value": 0.0, "inclusive": False},  # unread op
    ],
)
def test_unevaluable_conditions_give_none(cond: dict[str, Any]) -> None:
    assert rf.kept_rows(_book("Book1", [0, 1], [1, 2], None), cond) is None


def test_a_non_finite_filter_value_is_not_evaluated() -> None:
    ds = _book("Book1", [0.0, float("nan"), 2.0], [1, 2, 3], _GT)
    assert rf.kept_rows(ds, ds.metadata[WORKSHEET_FILTER_KEY]) is None


def test_an_empty_filter_column_never_reads_an_absent_x_as_row_numbers() -> None:
    # a book with no X column (x_column_name "") must not let column_short ""
    # select its synthetic time axis; control: the named X column still reads
    ds = _book("Book1", [0.0, 1.0, 2.0], [1, 2, 3], None)
    no_x = DataStruct(
        time=ds.time,
        values=ds.values,
        labels=ds.labels,
        units=ds.units,
        metadata={**ds.metadata, "x_column_name": ""},
    )
    cond = {"column_short": "", "op": ">", "value": 0.0, "inclusive": False}
    assert rf.kept_rows(no_x, cond) is None
    assert rf.kept_rows(ds, {**cond, "column_short": "A"}) == [1, 2]


def test_gates_omit_only_filters_without_a_proven_condition() -> None:
    g = SheetGates(frozenset(), frozenset({"Book1", "Book2"}), frozenset({"Book2"}))
    assert g.filter_omits("Book1") and not g.filter_omits("Book2") and not g.filter_omits("Book3")


def _fig(*curves: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": "Graph1",
        "curves": list(curves),
        "legend_labels": [f"%({i + 1})" for i in range(len(curves))],
    }


def test_apply_gives_the_condition_or_leaves_the_curve_out(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rf, "page_filters", lambda raw: {"Book1": _GT, "Book2": _GT, "Book3": _LT})
    books = [
        _book("Book1", [-1, 1, 2], [1, 2, 3], _GT),
        _book("Book1@2", [-1, 1, 2], [1, 2, 3], None),  # the filter is on sheet 1
        _book("Book2", [-1, -2, -3], [1, 2, 3], _GT),  # keeps no row
        _book("Book3", [0, 1, 2], [1, 2, 3], _LT),  # op 04: left as decoded
        _book("Book4", [0, 1, 2], [1, 2, 3], None),  # no filter
    ]
    curves = [
        {"book": "Book1", "x": "A", "y": "B"},
        {"book": "Book1", "x": "A", "y": "B", "plotType": "column"},  # not an overlay kind
        {"book": "Book1@2", "x": "A", "y": "B"},
        {"book": "Book2", "x": "A", "y": "B"},
        {"book": "Book3", "x": "A", "y": "B"},
        {"book": "Book4", "x": "A", "y": "B"},
    ]
    (out,) = rf.apply_row_filters([_fig(*curves)], books, b"")
    assert [(c["book"], c.get("rowFilter")) for c in out["curves"]] == [
        ("Book1", {"column": "A", "op": ">", "value": 0.0, "inclusive": False}),
        ("Book3", None),
        ("Book4", None),
    ]
    assert [(n["recorded"], n["reason"]) for n in out["curve_sheet_omitted"]] == [
        ("Book1", "worksheet_filter"),
        ("Book1@2", "worksheet_filter"),
        ("Book2", "worksheet_filter"),
    ]
    assert len(out["legend_labels"]) == 3  # the dropped curves' captions go too


def test_a_stamp_that_disagrees_with_the_page_condition_is_left_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(rf, "page_filters", lambda raw: {"Book1": {**_GT, "value": 1.0}})
    (out,) = rf.apply_row_filters(
        [_fig({"book": "Book1", "x": "A", "y": "B"})], [_book("Book1", [0, 2], [1, 2], _GT)], b""
    )
    assert out["curves"] == [] and out["curve_sheet_omitted"][0]["reason"] == "worksheet_filter"


def test_no_proven_filter_leaves_the_figures_untouched(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rf, "page_filters", lambda raw: {"Book3": _LT})
    figs = [_fig({"book": "Book3", "x": "A", "y": "B"})]
    assert rf.apply_row_filters(figs, [], b"") is figs


# --- realdata: Origin's own counts (COM 2026-11-15, ledger F-119) -----------

_DIR = "pdalcastel_IAV_Infection_CC3D_MaBoSS_2026/results_and_plots"


def _project(name: str) -> Path:
    path = origin_corpus_dir() / "public" / _DIR / name
    if not has_project(path):
        pytest.skip(f"public Origin corpus project {name} not present")
    return path


def _figures(path: Path) -> tuple[list[dict[str, Any]], list[DataStruct]]:
    books = read_origin_books(path)
    figs, _ = origin_figures_and_fidelity(path.read_bytes(), path.suffix, books)
    return figs, books


@pytest.mark.realdata
def test_realdata_simulated_ifn_curves_draw_origins_1549_rows() -> None:
    """op 02 is proven strict: each filtered book plots 1549 of 1600 rows in
    Origin, where ``>=`` would keep one more (a row of exactly 0)."""
    figs, books = _figures(_project("simulated-IFN-pretreatment-longer.opju"))
    by_name = {str(b.metadata["origin_book"]): b for b in books}
    filtered = [c for f in figs for c in f["curves"] if "rowFilter" in c]
    assert len(filtered) >= 5
    assert not [
        n
        for f in figs
        for n in f.get("curve_sheet_omitted") or []
        if n["reason"] == "worksheet_filter"
    ]
    for c in filtered:
        ds = by_name[c["book"]]
        stamp = ds.metadata[WORKSHEET_FILTER_KEY]
        kept = rf.kept_rows(ds, stamp)
        assert kept is not None and len(kept) == 1549, c["book"]
        assert len(rf.kept_rows(ds, {**stamp, "inclusive": True}) or []) == 1550


@pytest.mark.realdata
def test_realdata_likelihood_profile_unproven_op_stays_left_out() -> None:
    """op 04: the decoded thresholds reproduce Origin's counts with ``<``
    (48 / 5 / 2 / 16 / 290), but no value ties a threshold, so ``<`` vs
    ``<=`` is unproven and every curve of those books stays left out."""
    figs, books = _figures(_project("likelihood_profile.opju"))
    assert not [c for f in figs for c in f["curves"] if "rowFilter" in c]
    left = {
        n["recorded"]
        for f in figs
        for n in f.get("curve_sheet_omitted") or []
        if n["reason"] == "worksheet_filter"
    }
    counts = {}
    for ds in books:
        stamp = ds.metadata.get(WORKSHEET_FILTER_KEY)
        if stamp is None:
            continue
        assert stamp["inclusive"] is None and rf.kept_rows(ds, stamp) is None
        counts[str(ds.metadata["origin_book"])] = len(
            rf.kept_rows(ds, {**stamp, "inclusive": False}) or []
        )
    assert counts == {"Book1": 48, "Book3": 5, "Book2": 2, "Book6": 16, "Book7": 290}
    assert left == set(counts)
