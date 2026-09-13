"""Unit tests for the P3.3 print-safe greyscale export mode
(``calc.figure_greyscale``) — pure colour-space math plus the style-list
transform built on it. Render-level (SVG/PNG) assertions that the mode
actually reaches matplotlib live in ``test_calc_figure.py``'s greyscale
block, next to the rest of that module's render tests."""

from __future__ import annotations

import re
from pathlib import Path

from quantized.calc.figure_greyscale import (
    LINE_CYCLE,
    MARKER_SHAPES,
    apply_greyscale,
    greyscale_ramp,
)

_HEX = re.compile(r"^#[0-9a-f]{6}$")


def _channel(hexcolor: str) -> int:
    assert _HEX.match(hexcolor), hexcolor
    r, g, b = hexcolor[1:3], hexcolor[3:5], hexcolor[5:7]
    assert r == g == b, f"{hexcolor} is not achromatic"
    return int(r, 16)


# ── greyscale_ramp: order + minimum step ────────────────────────────────────
def test_ramp_empty() -> None:
    assert greyscale_ramp(0) == []


def test_ramp_single_series_is_the_range_midpoint() -> None:
    assert greyscale_ramp(1) == ["#646464"]


def test_ramp_two_series_spans_the_full_range() -> None:
    assert greyscale_ramp(2) == ["#262626", "#ababab"]


def test_ramp_eight_series_pinned() -> None:
    # Regression-pins the exact CIE L*-space conversion (not just "monotonic")
    # so a future accidental change to the L*<->sRGB math is caught here, not
    # only in a looser property test.
    assert greyscale_ramp(8) == [
        "#262626", "#373737", "#484848", "#5b5b5b",
        "#6e6e6e", "#828282", "#969696", "#ababab",
    ]


def test_ramp_order_preserved_by_display_position() -> None:
    # Position 0 darkest, position n-1 lightest, strictly increasing in
    # between -- "order preserved by display position".
    for n in (2, 3, 5, 8):
        vals = [_channel(c) for c in greyscale_ramp(n)]
        assert vals == sorted(vals)
        assert len(set(vals)) == n  # every position distinct


def test_ramp_guarantees_a_minimum_step() -> None:
    # Two SIMILAR-HUE series (which a naive per-colour luminance conversion
    # could map to nearly-identical greys) never collapse: the ramp doesn't
    # look at colour at all, so ANY n gets the same guaranteed spacing.
    for n in (2, 3, 8):
        vals = [_channel(c) for c in greyscale_ramp(n)]
        steps = [b - a for a, b in zip(vals, vals[1:], strict=False)]
        assert all(s > 0 for s in steps)
        # The smallest step across the whole ramp is still a visible jump
        # (>= ~5% of the 0-255 channel range) even at the densest tested n.
        assert min(steps) >= 12


def test_ramp_independent_of_series_colour() -> None:
    # greyscale_ramp takes only a COUNT -- explicit colours and the default
    # palette produce the identical ramp for the same n (see
    # test_apply_greyscale_ignores_source_colour below for the caller-facing
    # version of this same property).
    assert greyscale_ramp(3) == greyscale_ramp(3)


# ── apply_greyscale: colour override + forced dash/marker cycle ────────────
def test_apply_greyscale_colours_every_series() -> None:
    out = apply_greyscale(None, 3)
    assert [s["color"] for s in out] == greyscale_ramp(3)


def test_apply_greyscale_ignores_source_colour() -> None:
    # "explicit series colours vs default palette": the SAME grey ramp
    # results whether the caller supplied explicit colours or none at all.
    explicit = apply_greyscale(
        [{"color": "#ff0000"}, {"color": "#00ff00"}, {"color": "#0000ff"}], 3
    )
    default = apply_greyscale(None, 3)
    assert [s["color"] for s in explicit] == [s["color"] for s in default]


def test_apply_greyscale_forces_dash_cycle_by_position() -> None:
    out = apply_greyscale(None, 3)
    assert [s["line"] for s in out] == list(LINE_CYCLE)


def test_apply_greyscale_keeps_an_explicit_line() -> None:
    out = apply_greyscale([{"line": "dotted"}, None, None], 3)
    assert out[0]["line"] == "dotted"  # explicit wins
    assert out[1]["line"] == LINE_CYCLE[1]
    assert out[2]["line"] == LINE_CYCLE[2]


def test_apply_greyscale_keeps_explicit_lines_in_original_order_not_recycled() -> None:
    # Pins the "display position SKEW" interaction the P3.3 adversarial
    # review flagged (bc8f14fa): when the on-screen auto dash/marker cycle
    # preference is ON, the frontend (`lib/exportStyles.ts`'s
    # `buildExportStyles`) always emits an EXPLICIT `line` for every plotted
    # series, resolved against its ON-SCREEN display position -- which can
    # differ from that series' position in the export's hidden-FILTERED
    # `y_keys` list (the backend's own position, which `apply_greyscale`
    # indexes by). Because every entry here already carries an explicit
    # `line`, the explicit-wins rule must defer to ALL of them and never
    # re-cycle by the (different) backend-side position. This order is
    # chosen so a re-cycle WOULD produce a different, wrong answer: cycling
    # LINE_CYCLE at positions 0,1,2 gives solid/dashed/dotted, but every
    # position here already has an explicit line in a DIFFERENT order
    # (dashed/dotted/solid) that must survive untouched.
    out = apply_greyscale([{"line": "dashed"}, {"line": "dotted"}, {"line": "solid"}], 3)
    assert [s["line"] for s in out] == ["dashed", "dotted", "solid"]


def test_apply_greyscale_cycles_marker_shape_only_when_marker_is_on() -> None:
    out = apply_greyscale([{"marker": True}, None, {"marker": True}], 3)
    assert out[0]["marker_shape"] == MARKER_SHAPES[0]
    assert "marker_shape" not in out[1]  # no marker -> no shape assigned
    assert "marker" not in out[1]  # greyscale never turns markers ON
    assert out[2]["marker_shape"] == MARKER_SHAPES[2]


def test_apply_greyscale_keeps_an_explicit_marker_shape() -> None:
    out = apply_greyscale([{"marker": True, "marker_shape": "star"}], 1)
    assert out[0]["marker_shape"] == "star"


def test_apply_greyscale_leaves_color_by_scatter_untouched() -> None:
    spec = {"color_by": [1.0, 2.0, 3.0], "colormap": "plasma"}
    out = apply_greyscale([spec], 1)
    assert out[0] == spec
    assert out[0] is not spec  # still a copy, never the caller's own dict


def test_apply_greyscale_never_mutates_its_input() -> None:
    original = [{"color": "#ff0000", "line": "dashed"}]
    snapshot = [dict(original[0])]
    apply_greyscale(original, 1)
    assert original == snapshot


def test_apply_greyscale_short_style_list_pads_with_defaults() -> None:
    out = apply_greyscale([{"line": "dotted"}], 3)
    assert len(out) == 3
    assert out[0]["line"] == "dotted"
    assert out[1]["line"] == LINE_CYCLE[1]
    assert out[2]["line"] == LINE_CYCLE[2]


# ── Frontend/backend cycle-vocabulary drift guard ───────────────────────────
def _extract_ts_array(source: str, const_name: str) -> list[str]:
    m = re.search(rf"{const_name}[^=]*=\s*\[([^\]]*)\]", source, re.DOTALL)
    assert m, f"could not find {const_name} in seriesStyleCycle.ts"
    return re.findall(r'"([^"]+)"', m.group(1))


def test_line_and_marker_cycles_match_frontend_seriesStyleCycle() -> None:
    # frontend/src/lib/seriesStyleCycle.ts's AUTO_DASH_CYCLE/AUTO_MARKER_CYCLE
    # are the canonical vocabularies (they round-trip through
    # ExportSeriesStyle.line/marker_shape -> calc.figure._LINESTYLE/_MARKER);
    # LINE_CYCLE/MARKER_SHAPES above are a verbatim copy kept in sync BY
    # HAND. This test is the tripwire: if either list is ever edited on one
    # side only, this fails instead of the two renderers silently cycling
    # different vocabularies.
    ts_path = (
        Path(__file__).resolve().parents[1]
        / "frontend" / "src" / "lib" / "seriesStyleCycle.ts"
    )
    source = ts_path.read_text(encoding="utf-8")
    assert _extract_ts_array(source, "AUTO_DASH_CYCLE") == list(LINE_CYCLE)
    assert _extract_ts_array(source, "AUTO_MARKER_CYCLE") == list(MARKER_SHAPES)
