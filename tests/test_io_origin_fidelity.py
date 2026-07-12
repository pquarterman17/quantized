"""Loss-aware Origin graph fidelity manifest tests (decode plan #49)."""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.io.origin_project import read_origin_books
from quantized.io.origin_project.fidelity import (
    assess_origin_figures,
    origin_figure_decode_failure,
)
from quantized.io.origin_project.figures import extract_figures


def _origin_corpus() -> Path:
    for ancestor in Path(__file__).resolve().parents:
        candidate = ancestor / "test-data" / "origin"
        if candidate.is_dir():
            return candidate
    return Path("__origin_corpus_absent__")


_CORPUS = _origin_corpus()


def test_manifest_keeps_actionable_figures_and_summarizes_filtered_records() -> None:
    raw = [
        {
            "name": "Graph1",
            "layer": 1,
            "x_from": 0.0,
            "x_to": 1.0,
            "x_log": False,
            "y_from": 1.0,
            "y_to": 10.0,
            "y_log": True,
            "curves": [{"book": "Book1", "x": "A", "y": "B", "style": "line"}],
            "frame": {"left": 1, "top": 1, "right": 9, "bottom": 9},
            "page": {"width": 10, "height": 10},
        },
        {"name": "SYSTEM", "layer": 2, "curves": [], "source_hint": ""},
    ]

    figures, manifest = assess_origin_figures(raw, container="opj", source_names=["Book1"])

    assert len(figures) == 1
    assert figures[0]["fidelity"]["status"] == "best_effort"
    assert "curve_bindings" in figures[0]["fidelity"]["recovered"]
    assert "saved_graph_preview" in figures[0]["fidelity"]["omissions"]
    assert manifest == {
        "version": 1,
        "container": "opj",
        "status": "best_effort",
        "graph_records_total": 2,
        "graph_records_actionable": 1,
        "graph_records_filtered": 1,
        "omissions": [
            "advanced_axis_types",
            "filtered_internal_graph_records",
            "graphic_objects",
            "rich_text_run_formatting",
            "saved_graph_preview",
            "some_curve_colors",
        ],
        "filtered_figures": [
            {
                "index": 1,
                "name": "SYSTEM",
                "layer": 2,
                "reason": "no bound curves or source hint",
            }
        ],
    }


def test_source_hint_only_figure_is_retained_but_binding_omission_is_explicit() -> None:
    figures, manifest = assess_origin_figures(
        [{"name": "Graph2", "curves": [], "source_hint": "Book2"}],
        container="opju",
        source_names=["Book2"],
    )

    assert len(figures) == 1
    assert figures[0]["fidelity"]["status"] == "best_effort"
    assert "exact_curve_bindings" in figures[0]["fidelity"]["omissions"]
    assert manifest["container"] == "opju"
    assert manifest["graph_records_filtered"] == 0


def test_empty_graph_inventory_is_versioned_and_unresolved() -> None:
    figures, manifest = assess_origin_figures([], container="opj")

    assert figures == []
    assert manifest["version"] == 1
    assert manifest["status"] == "unresolved"
    assert manifest["graph_records_total"] == 0
    assert "no_graph_records" in manifest["omissions"]


def test_optional_decode_failure_has_a_stable_loss_manifest() -> None:
    manifest = origin_figure_decode_failure(container="opju")

    assert manifest["version"] == 1
    assert manifest["container"] == "opju"
    assert manifest["status"] == "unresolved"
    assert manifest["omissions"] == ["figure_decode_error"]


def test_stale_source_hint_is_filtered_with_an_actionable_reason() -> None:
    figures, manifest = assess_origin_figures(
        [{"name": "GraphGone", "curves": [], "source_hint": "DeletedBook"}],
        container="opj",
        source_names=["Book1"],
    )

    assert figures == []
    assert manifest["graph_records_filtered"] == 1
    assert manifest["filtered_figures"][0]["reason"] == (
        'source hint "DeletedBook" did not match an imported workbook'
    )


def test_assessment_does_not_mutate_decoder_records() -> None:
    raw = [{"name": "Graph1", "curves": [{"book": "B", "x": "A", "y": "B"}]}]

    figures, _manifest = assess_origin_figures(raw, container="opj")

    assert "fidelity" not in raw[0]
    assert "fidelity" in figures[0]


@pytest.mark.realdata
@pytest.mark.skipif(not (_CORPUS / "XMCD.opj").exists(), reason="Origin corpus absent")
def test_xmcd_dead_hint_only_records_are_retained_as_diagnostics_not_figures() -> None:
    path = _CORPUS / "XMCD.opj"
    books = read_origin_books(path)
    source_names = {
        str(name)
        for book in books
        for name in (
            book.metadata.get("origin_book", ""),
            book.metadata.get("origin_book_long", ""),
        )
        if name
    }

    figures, manifest = assess_origin_figures(
        extract_figures(path.read_bytes()), container="opj", source_names=source_names
    )

    assert manifest["graph_records_total"] == 128
    assert manifest["graph_records_actionable"] == len(figures) == 67
    assert manifest["graph_records_filtered"] == 61
    assert all(f["reason"].startswith("source hint") for f in manifest["filtered_figures"])
