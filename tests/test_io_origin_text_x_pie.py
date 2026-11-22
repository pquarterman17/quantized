"""A text X (category labels) on a sheet other than the first: admitted only
for a pie curve (decode-plan item 67, ledger F-117).

The sheet's Text column is imported (``origin_text_columns``) and designated
X, but ``x_column_name`` is empty, so ``unbound_rebinds`` used to omit every
curve on it as ``x_not_imported``. For a pie the text column IS the wedge
label list (``soil deep`` Graph9 / 12 / 15 / 16 / 19: the shares Origin prints
equal the imported values over their sum). Any other kind against a text X
(grouped columns, bars: ``Figure4`` Graph6, ``RSOS_SC_micstruc`` RSOS_SC_BAR)
draws as lines where Origin draws bars, so it stays left out.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_curve_sheets import unbound_rebinds


def _text_x_book(**meta: object) -> DataStruct:
    return DataStruct(
        time=np.arange(3.0),
        values=np.ones((3, 1)),
        labels=("B",),
        units=("",),
        metadata={
            "origin_book": "Bk@2",
            "x_column_name": "",
            "origin_column_names": ["B"],
            "origin_text_columns": {"A": ["a", "b", "c"]},
            "column_designations": {"A": "X", "B": "Y"},
            **meta,
        },
    )


def _run(curve: dict[str, Any], book: DataStruct) -> dict[str, Any]:
    fig = {"name": "G", "layer": 1, "curves": [curve], "legend_labels": ["s"]}
    (out,) = unbound_rebinds([fig], [book])
    return out


def test_a_pie_curve_keeps_its_text_x() -> None:
    curve = {"book": "Bk@2", "x": "A", "y": "B", "plotType": "pie"}
    assert _run(curve, _text_x_book())["curves"] == [curve]


@pytest.mark.parametrize("kind", [None, "column", "not_drawn", "line"])
def test_any_other_kind_against_a_text_x_stays_left_out(kind: str | None) -> None:
    curve: dict[str, Any] = {"book": "Bk@2", "x": "A", "y": "B"}
    if kind:
        curve["plotType"] = kind
    out = _run(curve, _text_x_book())
    assert out["curves"] == []
    assert [n["reason"] for n in out["curve_sheet_omitted"]] == ["x_not_imported"]


def test_a_pie_needs_a_text_column_designated_x() -> None:
    pie = {"book": "Bk@2", "x": "A", "y": "B", "plotType": "pie"}
    not_x = _text_x_book(column_designations={"A": "Y", "B": "Y"})
    assert _run(dict(pie), not_x)["curves"] == []
    numeric_x = _text_x_book(x_column_name="Z")  # the sheet has a numeric X: nothing to relax
    assert _run(dict(pie), numeric_x)["curves"] == []


_SOIL = "origin/public/2021555811-hub_UAV-Soil-Moisture-Systematic-Review/origin/soil deep.opju"
_FIG4 = "origin/public/cropsinsilico_GRN_Model/Figure4.opju"


def _import(corpus_dir: Path, rel: str) -> tuple[list[dict[str, Any]], dict[str, DataStruct]]:
    project = corpus_dir / rel
    if not project.is_file():
        pytest.skip(f"{rel} not present")
    _primary, books = read_origin_project_all(project)
    kept = drop_empty_library_books(books)
    figs = unbound_rebinds(extract_figures_opju(project.read_bytes()), kept)
    return figs, {str(b.metadata.get("origin_book")): b for b in kept}


@pytest.mark.realdata
def test_realdata_soil_deep_pies_keep_their_text_labels(corpus_dir: Path) -> None:
    figs, books = _import(corpus_dir, _SOIL)
    for page in ("Graph9", "Graph12", "Graph15", "Graph16", "Graph19"):
        (fig,) = [f for f in figs if f["name"] == page and f["layer"] == 1]
        (curve,) = fig["curves"]
        assert curve["plotType"] == "pie" and curve["x"] == "A" and "@2" in curve["book"]
        book = books[curve["book"]]
        labels = book.metadata["origin_text_columns"][curve["x"]]
        values = np.asarray(book.values, dtype=float)[:, 0]
        # the pie's shares are the imported values over their sum, one per label
        assert len(labels) == int(np.isfinite(values).sum()) > 1
        assert not fig.get("curve_sheet_omitted")


@pytest.mark.realdata
def test_realdata_grouped_columns_on_a_text_x_stay_left_out(corpus_dir: Path) -> None:
    """Negative control: Figure4 Graph6 (4 grouped column series over text
    categories) would draw as lines; Origin draws bars."""
    figs, _books = _import(corpus_dir, _FIG4)
    (fig,) = [f for f in figs if f["name"] == "Graph6" and f["layer"] == 1]
    assert fig["curves"] == []
    assert {n["reason"] for n in fig["curve_sheet_omitted"]} == {"x_not_imported"}
