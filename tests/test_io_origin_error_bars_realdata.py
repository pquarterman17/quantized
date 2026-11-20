"""Asymmetric / X error bars, bands and orphan error plots on the public corpus
(``opju_error_bars``; evidence ``docs/origin_re/error_bars.md``).

Expectations are computed at test time from oracles inside each file (the
columns' own long names, the book's own values); no corpus value is committed.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest

pytestmark = pytest.mark.realdata


def _public() -> Path:
    env = os.environ.get("QZ_ORIGIN_PUBLIC_CORPUS")
    if env:
        return Path(env)
    for a in Path(__file__).resolve().parents:
        if (a / "test-data" / "origin" / "public").is_dir():
            return a / "test-data" / "origin" / "public"
    return Path("/nonexistent")


def _import(rel: str) -> dict[str, Any]:
    from quantized.routes.parsers import _import_with_books

    path = _public() / rel
    if not path.is_file():
        pytest.skip(f"{path.name} not present")
    payload, _ = _import_with_books(path, full_books=True)
    return payload


def _books(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(b["metadata"].get("origin_book")): b for b in payload.get("books", [])}


def _column(book: dict[str, Any], letter: str) -> np.ndarray[Any, Any]:
    names = [str(n) for n in book["metadata"]["origin_column_names"]]
    rows = [[np.nan if v is None else v for v in r] for r in book["values"]]
    return np.asarray(rows, dtype=float)[:, names.index(letter)]


_GT = "Bariumoxid_MIMOTechniques/Report/Graph_Template.opju"


def test_realdata_halves_attach_plus_and_minus_by_their_authors_names() -> None:
    """Each attached half is the column its author named as that half
    (``Upper_Bound`` / ``UB_*`` / ``XerrPlus*`` = plus)."""
    payload = _import(_GT)
    books = _books(payload)
    seen = 0
    for fig in payload["figures"]:
        for c in fig["curves"]:
            book = books[c["book"]]
            names = [str(n) for n in book["metadata"]["origin_column_names"]]
            long = dict(zip(names, book["labels"], strict=False))
            for key, words in (
                ("Plus", ("upper", "ub", "plus")),
                ("Minus", ("lower", "lb", "minus")),
            ):
                for axis in ("y", "x"):
                    col = c.get(f"{axis}Err{key}")
                    if col:
                        seen += 1
                        assert any(w in str(long[col]).lower() for w in words), (fig["name"], col)
    assert seen >= 8


def test_realdata_lollipop_x_halves_draw_stems_to_zero() -> None:
    """``43Lollipop``: Origin's preview draws a stem from 0 to each point. The
    attached X halves span exactly that: from min(0, x) to max(0, x)."""
    payload = _import(_GT)
    books = _books(payload)
    (fig,) = [f for f in payload["figures"] if f["name"] == "43Lollipop"]
    stems = [c for c in fig["curves"] if c.get("xErrMinus")]
    assert stems
    for c in stems:
        book = books[c["book"]]
        x, minus, plus = (_column(book, c[k]) for k in ("x", "xErrMinus", "xErrPlus"))
        ok = np.isfinite(x)
        lo, hi = x[ok] - minus[ok], x[ok] + plus[ok]
        assert np.allclose(lo, np.minimum(x[ok], 0)) and np.allclose(hi, np.maximum(x[ok], 0))


def test_realdata_a_filled_error_plot_is_a_band_with_its_own_halves() -> None:
    """PerceivedRisk Graph1: Origin's preview fills C - B .. C + D (B the
    minus half): one band, asymmetric."""
    payload = _import(
        "he-xiaolin_Online-perceived-risk-study/Fig3_ExtFig5/PerceivedRiskandPrediction.opju"
    )
    (fig,) = [f for f in payload["figures"] if f["name"] == "Graph1"]
    (c,) = fig["curves"]
    assert (c["yErrPlus"], c["yErrMinus"], c["errBand"]) == ("D", "B", True)


def test_realdata_an_error_plot_naming_no_curve_is_not_a_loss() -> None:
    """calibration_for_fig4 Graph3 keeps error plots of Book6-8, whose curves
    it does not plot; its preview draws no bars there."""
    payload = _import(
        "pdalcastel_IAV_Infection_CC3D_MaBoSS_2026/results_and_plots/calibration_for_fig4.opju"
    )
    (fig,) = [f for f in payload["figures"] if f["name"] == "Graph3"]
    reasons = [n["reason"] for n in fig.get("curve_sheet_omitted") or []]
    assert reasons.count("error_bar_no_curve") == 3
    assert "error_bar_plots" not in fig["fidelity"]["omissions"]
