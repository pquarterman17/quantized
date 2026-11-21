"""Origin pie / doughnut layers, the bar-plot group role, and the pie renderer.

``io/origin_project/opju_pie.py`` (decode), ``opju_bar_kinds`` (per-layer
resolution), ``calc/figure_pie.py`` + ``POST /api/export/pie-figure`` (the
render the pie workshop previews and exports). Evidence and the preview
checks: ``docs/origin_re/plot_kinds.md`` "Lane P3". Synthetic tests lock the
proven behaviour; the ``realdata`` tests compute their expectations from the
corpus at run time.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from quantized.calc.figure_pie import pie_rings, render_pie_figure
from quantized.io.origin_project import opju_bar_kinds
from quantized.io.origin_project.fidelity import assess_origin_figures
from quantized.io.origin_project.opju_bar_kinds import (
    BAR_LAYOUT,
    PLOT_TYPE_NOT_DRAWN,
    apply_bar_kinds,
)
from quantized.io.origin_project.opju_pie import pie_hole, plot_group
from quantized.io.origin_project.opju_plot_gates import PLOT_TYPE_OFF
from quantized.io.origin_project.opju_plot_kinds import apply_plot_kind

# ── the record ───────────────────────────────────────────────────────────────


def _pie_record(doughnut: int = 0, hole: int = 50, start: int = 90, bar_of_pie: int = 0) -> bytes:
    r = bytearray(520)
    r[PLOT_TYPE_OFF] = 225
    r[206], r[165], r[150] = doughnut, hole, start
    r[27] = r[114] = bar_of_pie
    return bytes(r)


def test_pie_record_reads_the_doughnut_flag_and_hole() -> None:
    # a pie stores Origin's default 50 % hole and draws none (soil deep)
    assert pie_hole(_pie_record(doughnut=0, hole=50)) == 0.0
    # a doughnut ring: byte 206 = 01, byte 165 = 40 % (RSOS_*_CIR previews: 0.39)
    assert pie_hole(_pie_record(doughnut=1, hole=40)) == pytest.approx(0.4)


@pytest.mark.parametrize(
    "record",
    [
        _pie_record(doughnut=2),  # an unseen flag value
        _pie_record(doughnut=1, hole=0),  # a doughnut with no hole
        _pie_record(start=0),  # another start angle
        _pie_record(bar_of_pie=4),  # TEA_ExcelGraphs' bar-of-pie
        None,
        b"\x00" * 100,
    ],
)
def test_pie_record_fails_closed(record: bytes | None) -> None:
    assert pie_hole(record) is None
    curve: dict[str, Any] = {"book": "Bk", "x": "A", "y": "B"}
    if record is not None and record[PLOT_TYPE_OFF] == 225:
        apply_plot_kind(curve, record)
        assert curve["plotType"] == "not_drawn" and "pieHole" not in curve


def test_plot_kind_marks_a_read_pie() -> None:
    curve: dict[str, Any] = {"book": "Bk", "x": "A", "y": "B"}
    apply_plot_kind(curve, _pie_record(doughnut=1, hole=40))
    assert curve["plotType"] == "pie" and curve["pieHole"] == pytest.approx(0.4)


@pytest.mark.parametrize(
    ("byte6", "role"),
    [
        (0x20, "head"),
        (0x21, "head"),
        (0x10, "member"),
        (0x11, "member"),
        (0x00, "standalone"),
        (0x01, "standalone"),
        (0x09, "standalone"),
        (0x30, None),
    ],
)
def test_plot_group_role(byte6: int, role: str | None) -> None:
    r = bytearray(300)
    r[6] = byte6
    assert plot_group(bytes(r)) == role
    r[PLOT_TYPE_OFF] = 203
    curve: dict[str, Any] = {}
    apply_plot_kind(curve, bytes(r))
    assert curve.get("plotGroup") == role


# ── per layer ────────────────────────────────────────────────────────────────


def _book(x_name: str = "") -> Any:
    meta = {"origin_book": "Bk", "origin_column_names": ["B", "C"], "x_column_name": x_name}
    return SimpleNamespace(metadata=meta, time=np.array([1.0, 2.0, 3.0]), values=np.ones((3, 2)))


def _pies(n: int, hole: float, **over: Any) -> dict[str, Any]:
    curves = [
        {"book": "Bk", "x": "A", "y": "BC"[i], "plotType": "pie", "pieHole": hole, **over}
        for i in range(n)
    ]
    return {"name": "Graph3", "layer": 1, "curves": curves, "legend_labels": []}


def _apply(
    figs: list[dict[str, Any]], template: str | None = None, **kw: Any
) -> list[dict[str, Any]]:
    orig = opju_bar_kinds._template_kind
    opju_bar_kinds._template_kind = lambda b, p, n, t: template  # type: ignore[assignment]
    try:
        return apply_bar_kinds(figs, b"", [_book(**kw)])
    finally:
        opju_bar_kinds._template_kind = orig  # type: ignore[assignment]


def _reasons(fig: dict[str, Any]) -> list[str]:
    return [o["reason"] for o in fig.get("curve_sheet_omitted") or []]


def test_a_pie_layer_becomes_the_pie_spec() -> None:
    (pie,) = _apply([_pies(1, 0.0)], template="pie")
    assert pie["pie"] == {"book": "Bk", "x": "A", "y": ["B"], "hole": 0.0}
    assert [c["plotType"] for c in pie["curves"]] == ["pie"] and not _reasons(pie)
    assert all("pieHole" not in c for c in pie["curves"])  # provisional key dropped
    (rings,) = _apply([_pies(2, 0.4)], template="doughnut")
    assert rings["pie"]["y"] == ["B", "C"] and rings["pie"]["hole"] == pytest.approx(0.4)
    figs, _ = assess_origin_figures([rings], container="opju", source_names=["Bk"])
    assert "pie_marks_not_decoded" in figs[0]["fidelity"]["omissions"]
    # a MergeGrap-style page names no pie template: the record decides
    (merged,) = _apply([_pies(1, 0.0)], template=None)
    assert "pie" in merged


@pytest.mark.parametrize(
    ("fig", "template", "kw"),
    [
        (_pies(2, 0.0), "pie", {}),  # several plain pies: not decoded
        (_pies(1, 0.4), "pie", {}),  # a Pie page whose record says doughnut
        (_pies(1, 0.0), "doughnut", {}),  # a Doughnut page whose record says pie
        (_pies(1, 0.0), "bar_of_pie", {}),  # TEA_ExcelGraphs Graph1 / 12
        (_pies(1, 0.0), "pie", {"x_name": "D"}),  # X is not the sheet's own X
    ],
)
def test_a_pie_layer_fails_closed(fig: dict[str, Any], template: str, kw: dict[str, Any]) -> None:
    (out,) = _apply([fig], template=template, **kw)
    assert "pie" not in out and out["curves"] == []
    assert _reasons(out) == [PLOT_TYPE_NOT_DRAWN] * len(fig["curves"])


def test_pie_on_a_multi_layer_page_or_mixed_layer_is_left_out() -> None:
    page = _apply([_pies(1, 0.0), {**_pies(1, 0.0), "layer": 2}], template="pie")
    assert all("pie" not in f and f["curves"] == [] for f in page)  # SOILDEEP1
    mixed = _pies(2, 0.4)
    mixed["curves"][1]["pieHole"] = 0.5
    (out,) = _apply([mixed], template="doughnut")
    assert "pie" not in out


def _bars(roles: list[str | None], **flags: Any) -> dict[str, Any]:
    curves = [
        {"book": "Bk", "x": "A", "y": "BC"[i], "plotType": "bar", "plotGroup": r}
        for i, r in enumerate(roles)
    ]
    return {"name": "Graph6", "layer": 1, "curves": curves, "legend_labels": [], **flags}


def test_standalone_sideways_bars_overlap_grouped_ones_are_left_out() -> None:
    """LSA_fig6 Graph6 / 8: two standalone plots in a turned layer, drawn
    sideways at the same positions; TEA_ExcelGraphs Graph9 (a group, overlap
    not decoded) stays out."""
    (alone,) = _apply([_bars(["standalone", "standalone"], axes_exchanged=True)], x_name="A")
    assert [c["plotType"] for c in alone["curves"]] == ["bar", "bar"] and not _reasons(alone)
    assert all("plotGroup" not in c for c in alone["curves"])
    for roles in (["head", "member"], ["standalone", None], [None, None]):
        (out,) = _apply([_bars(roles, axes_exchanged=True)], x_name="A")
        assert out["curves"] == [] and _reasons(out) == [PLOT_TYPE_NOT_DRAWN] * 2
    other_x = _bars(["standalone", "standalone"], axes_exchanged=True)
    other_x["curves"][1]["x"] = "C"
    (out,) = _apply([other_x], x_name="A")
    assert out["curves"] == []


def test_grouped_columns_need_one_origin_plot_group() -> None:
    """Origin draws a plot GROUP side by side; standalone columns overlap, so
    they never become the Stat Stage's grouped chart."""
    cols = _bars(["head", "member"], axes_exchanged=False)
    for c in cols["curves"]:
        c["plotType"] = "column"
    books = [
        SimpleNamespace(
            metadata={"origin_book": "Bk", "origin_column_names": ["B", "C"], "x_column_name": "A"},
            time=np.array([1.0, 2.0, 3.0]),
            values=np.ones((3, 2)),
        )
    ]
    (g,) = apply_bar_kinds([cols], b"", books)
    assert g[BAR_LAYOUT] == "grouped"
    for roles in (["standalone", "standalone"], ["member", "head"], [None, None]):
        for c, r in zip(cols["curves"], roles, strict=True):
            c["plotGroup"] = r
        (f,) = apply_bar_kinds([cols], b"", books)
        assert BAR_LAYOUT not in f


# ── the renderer ─────────────────────────────────────────────────────────────


def test_rings_share_the_annulus_first_innermost() -> None:
    assert pie_rings(0.0, 1) == [(0.0, 1.0)]
    assert pie_rings(0.4, 2) == [(0.4, pytest.approx(0.7)), (pytest.approx(0.7), 1.0)]
    with pytest.raises(ValueError):
        pie_rings(1.0, 1)


def test_render_pie_formats_and_errors() -> None:
    png = render_pie_figure([[69, 45, 18]], ["a", "b", "c"], colors=["#112233"], fmt="png", dpi=40)
    assert png.startswith(b"\x89PNG")
    svg = render_pie_figure([[1, 2], [3, 4]], ["a", "b"], hole=0.4, fmt="svg")
    assert b"<svg" in svg
    for bad in ([[1, -1]], [[0, 0]], [[1, float("nan")]]):
        with pytest.raises(ValueError):
            render_pie_figure(bad, ["a", "b"], fmt="png")
    with pytest.raises(ValueError):
        render_pie_figure([[1, 2], [3, 4]], ["a", "b"], hole=0.0)  # rings need a hole
    with pytest.raises(ValueError):
        render_pie_figure([[1, 2]], ["a"])


def test_pie_route() -> None:
    from fastapi.testclient import TestClient

    from quantized.app import create_app

    client = TestClient(create_app())
    body = {"rings": [[1, 2, 3]], "labels": ["a", "b", "c"], "fmt": "png", "dpi": 40}
    res = client.post("/api/export/pie-figure", json=body)
    assert res.status_code == 200 and res.content.startswith(b"\x89PNG")
    assert (
        client.post("/api/export/pie-figure", json={**body, "rings": [[-1, 2, 3]]}).status_code
        == 422
    )
    assert client.post("/api/export/pie-figure", json={**body, "fmt": "bmp"}).status_code == 422


# ── realdata ─────────────────────────────────────────────────────────────────


def _public(corpus_dir: Path) -> Path:
    root = corpus_dir / "origin" / "public"
    if not root.is_dir():
        pytest.skip("public Origin corpus not present")
    return root


def _one(root: Path, pattern: str) -> Path:
    hits = sorted(root.rglob(pattern))
    if len(hits) != 1:
        pytest.skip(f"{pattern}: {len(hits)} matches")
    return hits[0]


def _figures_and_books(path: Path) -> tuple[list[dict[str, Any]], list[Any]]:
    from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all
    from quantized.io.origin_project.import_manifest import origin_figures_and_fidelity

    raw = path.read_bytes()
    primary, books = read_origin_project_all(path, raw=raw)
    books = drop_empty_library_books(books)
    figs, _ = origin_figures_and_fidelity(raw, ".opju", books, primary=primary)
    return figs, books


@pytest.mark.realdata
def test_realdata_pies_and_doughnuts(corpus_dir: Path) -> None:
    """``soil deep`` Graph3 (``Pie2D``): one pie of the sheet's Y over its text
    X; ``RSOS_SC_micstruc`` / ``RSOS_TC_micstruc`` *_CIR (``Doughnut``): one
    ring per plot in plot order on a 40 % hole; the bar-of-pie pages and the
    multi-layer SOILDEEP1 stay left out."""
    root = _public(corpus_dir)
    figs, books = _figures_and_books(_one(root, "soil deep.opju"))
    by = {(f["name"], f["layer"]): f for f in figs}
    spec = by[("Graph3", 1)]["pie"]
    assert spec["hole"] == 0.0 and len(spec["y"]) == 1
    (bk,) = [b for b in books if b.metadata["origin_book"] == spec["book"]]
    assert len(bk.metadata["x_category_labels"]) == len(bk.time)  # labels per wedge
    assert "pie" not in by[("SOILDEEP1", 1)] and by[("SOILDEEP1", 1)]["curves"] == []
    for name, page in (
        ("RSOS_SC_micstruc.opju", "RSOS_SC_CIR"),
        ("RSOS_TC_micstruc.opju", "RSOS_TC_CIR"),
    ):
        figs, _ = _figures_and_books(_one(root, name))
        (fig,) = [f for f in figs if f["name"] == page]
        assert fig["pie"]["hole"] == pytest.approx(0.4)
        assert fig["pie"]["y"] == [c["y"] for c in fig["curves"]] and len(fig["curves"]) > 1
    tea, _ = _figures_and_books(_one(root, "TEA_ExcelGraphs.opju"))
    assert not any("pie" in f for f in tea)


@pytest.mark.realdata
def test_realdata_vector_and_floating_column_modifiers(corpus_dir: Path) -> None:
    """The decoded-but-not-drawn bindings: a vector XYXY plot's token names its
    end points as modifiers 13 (X end) and 14 (Y end) -- columns C and D of
    ``30流场`` Book1 -- and a floating column's names its width column (39)
    or its first Y (32). Both stay left out (``plot_type_not_drawn``)."""
    from quantized.io.origin_project import opju_figure_curves as fc
    from quantized.io.origin_project.figures_opju import extract_figures_opju

    root = _public(corpus_dir)
    seen: list[tuple[int, list[tuple[int, str]]]] = []
    orig = fc.apply_marker_modifiers

    def spy(curve: Any, mods: Any, record: Any) -> None:
        if record is not None and record[PLOT_TYPE_OFF] in (207, 218):
            seen.append((record[PLOT_TYPE_OFF], list(mods or [])))
        orig(curve, mods, record)

    fc.apply_marker_modifiers = spy  # type: ignore[assignment]
    try:
        extract_figures_opju(_one(root, "30流场.opju").read_bytes())
        extract_figures_opju(_one(root, "Degree of impact*.opju").read_bytes())
    finally:
        fc.apply_marker_modifiers = orig  # type: ignore[assignment]
    vectors = [m for code, m in seen if code == 218]
    assert vectors and all(sorted(m) == [(13, "Book1_C"), (14, "Book1_D")] for m in vectors)
    floats = [m for code, m in seen if code == 207]
    assert floats and all(not m or m[0][0] in (32, 39) for m in floats)
