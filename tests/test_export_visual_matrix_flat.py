"""P4.2 rendered-output regression matrix, flat-axes fixtures
(PRIMARY_SOFTWARE_AUDIT_PLAN, ~line 9519): "plain", "errors", "hidden" of the
nine canonical figures (``frontend/src/lib/regressionMatrixFixtures.testkit
.ts``'s ``MATRIX_FIXTURES``). The 2026-09-14 structural matrix
(``regressionMatrix.test.ts``) proved SCREEN == EXPORT-SPEC == REOPEN for
these on the frontend; this is the other half -- that the real backend
export route (``/api/export/figure``/``-hitmap``, the SAME code
``/api/export/figure`` uses, via ``TestClient``, never a bare ``calc`` call)
actually renders what that spec says, read back out of the SVG/PNG bytes
structurally (never pixel-exact -- CI runs ubuntu/windows/mac with different
fonts). See ``tests/_regression_matrix_wire.py`` for the shared dataset +
SVG helpers, and ``test_export_vector_structure.py`` for the precedent this
follows (A8, one fixture only -- this file is three more of the nine).

Split from the other six fixtures (test_export_visual_matrix_split.py,
test_export_visual_matrix_decor.py) purely to stay well under the file's own
readability budget -- there is no behavioural reason "flat" fixtures share a
module and "split-axes" ones don't.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi.testclient import TestClient

from _regression_matrix_wire import (
    STYLED_OR_PLAIN_LINE_RE,
    axes_minus_legend,
    legend_entries,
    matrix_dataset,
)
from quantized.app import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Fixture 1/9: "plain" -- two channels, explicit widths, explicit limits +
# legend + title/axis labels. The baseline every other fixture in this suite
# builds on.
# ---------------------------------------------------------------------------


def _plain_payload(fmt: str = "svg") -> dict[str, Any]:
    return {
        "dataset": matrix_dataset(),
        "y_keys": [0, 1],
        "fmt": fmt,
        "title": "Matrix fixture",
        "x_label": "Index",
        "y_label": "Signal (au)",
        "overrides": {
            "x_lim": [0, 5],
            "y_lim": [-1, 4],
            "legend": {"show": True, "loc": "upper left"},
        },
        "series_styles": [{"width": 2}, {"width": 1}],
    }


def test_plain_fixture_renders_limits_widths_legend_and_labels() -> None:
    resp = client.post("/api/export/figure", json=_plain_payload("svg"))
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")

    assert "Matrix fixture" in svg
    assert "Index" in svg
    assert "Signal" in svg
    assert legend_entries(svg) == ["Signal (au)", "Reference (au)"]

    plot = axes_minus_legend(svg)
    lines = STYLED_OR_PLAIN_LINE_RE.findall(plot)
    assert len(lines) == 2
    # width=2 draws an explicit stroke-width; width=1 is mpl's own SVG
    # default and is OMITTED -- '' here, not '1'.
    widths = {w for _c, w in lines}
    assert widths == {"2", ""}

    hitmap = client.post("/api/export/figure-hitmap", json=_plain_payload("png"))
    assert hitmap.status_code == 200, hitmap.text
    axes = hitmap.json()["axes"]
    assert axes["xlim"] == [0.0, 5.0]
    assert axes["ylim"] == [-1.0, 4.0]


# ---------------------------------------------------------------------------
# Fixture 2/9: "errors" -- symmetric Y (series 0), asymmetric plus-only/
# minus-only Y folded into one series (series 1), plus an X error on that
# same series -- three independent error-bar draws in total.
# ---------------------------------------------------------------------------


def _errors_payload(*, with_errors: bool = True) -> dict[str, Any]:
    payload: dict[str, Any] = {"dataset": matrix_dataset(), "y_keys": [0, 1], "fmt": "svg"}
    if with_errors:
        payload["error_spans"] = [
            {"y": {"plus": [0.1] * 6, "minus": [0.1] * 6}},
            {
                "y": {"plus": [0.2] * 6, "minus": [0.05] * 6},
                "x": {"plus": [0.15] * 6, "minus": [0.15] * 6},
            },
        ]
    return payload


def test_errors_fixture_draws_one_line_collection_per_error_span() -> None:
    # Series 0 draws ONE LineCollection (a symmetric Y span); series 1 draws
    # TWO (an asymmetric Y span AND an X span) -- three whiskers in total.
    # Losing error-bar rendering entirely (the realistic regression this
    # pins) collapses that to zero. Sabotage-verified: commenting out
    # `apply_error_bars(...)`'s call site in `calc.figure.draw_series_axes`
    # drops the count to 0 and fails this assertion; reverted after.
    resp = client.post("/api/export/figure", json=_errors_payload())
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    assert len(_line_collections(svg)) == 3


def test_errors_fixture_omits_line_collections_when_no_spans_given() -> None:
    # Negative control: the SAME dataset/channels with no error_spans at all
    # draws no whisker -- proof the count above is the error bars specifically
    # and not some other LineCollection this render always produces.
    resp = client.post("/api/export/figure", json=_errors_payload(with_errors=False))
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    assert not _line_collections(svg)


def _line_collections(svg: str) -> list[str]:
    return re.findall(r'<g id="(LineCollection_\d+)"', svg)


# ---------------------------------------------------------------------------
# Fixture 9/9: "hidden" -- three plotted channels with the first HIDDEN by
# simply not naming it in y_keys (the backend has no separate "hidden"
# concept; the frontend's BUG-015 filters its display list to this same
# request shape before it ever reaches the wire). The two SURVIVORS keep
# their own distinct styles, POSITIONALLY aligned to y_keys -- not to their
# original channel index -- pinning that a request never renumbers or
# collapses styles onto the wrong survivor.
# ---------------------------------------------------------------------------


def _hidden_payload(y_keys: list[int]) -> dict[str, Any]:
    return {
        "dataset": matrix_dataset(),
        "y_keys": y_keys,
        "fmt": "svg",
        "series_styles": [{"width": 1, "color": "#111111"}, {"width": 3, "color": "#222222"}],
    }


def test_hidden_fixture_drops_the_excluded_channel_and_keeps_style_order() -> None:
    # Sabotage-verified: forcing `calc.plotting.build_series` to always plot
    # every channel (ignoring `y_keys`, the realistic "ignore a hidden
    # series" regression) inflates the drawn-line count from 2 to 9 (every
    # channel in the dataset) and fails the `len(lines) == 2` assertion
    # below; reverted after.
    resp = client.post("/api/export/figure", json=_hidden_payload([1, 2]))
    assert resp.status_code == 200, resp.text
    svg = resp.content.decode("utf-8", "ignore")
    plot = axes_minus_legend(svg)
    lines = STYLED_OR_PLAIN_LINE_RE.findall(plot)
    assert len(lines) == 2
    # Positional: y_keys[0] (channel 1) drew series_styles[0], not a style
    # keyed off its own channel index 1.
    assert lines[0] == ("#111111", "")  # width 1 == mpl's own default, omitted
    assert lines[1] == ("#222222", "3")
