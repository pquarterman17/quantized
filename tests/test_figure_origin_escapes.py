"""Origin rich-text escapes render in export exactly as on screen
(publication-figures audit #17) -- the EXPORT half.

``frontend/src/lib/originEscapes.test.ts`` rewrites each case on the screen
side and pins the pairs in ``origin_escapes.json``; here the export's own
rewrite (``calc.figure_origin_escapes``) must produce the same strings, and
every converted label must survive the export's mathtext gate as mathtext
(not de-mathed to literal) and actually draw.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from quantized.calc.figure import render_figure_map
from quantized.calc.figure_labels import safe_mathtext_label
from quantized.calc.figure_origin_escapes import origin_escapes_to_mathtext

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "origin_escapes.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize(("source", "want"), CASES, ids=[c[0] for c in CASES])
def test_export_rewrite_matches_the_screen(source: str, want: str) -> None:
    assert origin_escapes_to_mathtext(source) == want


@pytest.mark.parametrize(
    "source", [c[0] for c in CASES if c[0] != c[1]], ids=[c[0] for c in CASES if c[0] != c[1]]
)
def test_converted_labels_stay_mathtext_through_the_export_gate(source: str) -> None:
    out = safe_mathtext_label(source)
    assert out == origin_escapes_to_mathtext(source)
    assert "\\$" not in out  # not de-mathed to a literal


def test_escaped_labels_draw_in_every_text_slot() -> None:
    x = np.linspace(0.0, 1.0, 5)
    hit = render_figure_map(
        x,
        [("M\\-(s)", x), ("\\g(c)\\+(2)", x * 2)],
        title="\\b(Sample) \\i(A)",
        x_label="T\\-(c) (K)",
        y_label="10\\+(-3) emu cm\\+(-3)",
        overrides={"annotations": [{"x": 0.5, "y": 0.5, "text": "\\g(t) = 2 s"}]},
    )
    ids = {e["id"] for e in hit["elements"]}
    assert {"title", "xlabel", "ylabel", "legend", "ann:0"} <= ids


@pytest.mark.parametrize(
    "source", [c[0] for c in CASES if c[0] == c[1]], ids=[c[0] for c in CASES if c[0] == c[1]]
)
def test_a_label_the_screen_keeps_literal_is_literal_in_the_export(source: str) -> None:
    """Review finding: nested literal runs, an escaped backslash and run text
    outside the screen's math subset drew as math in the export while the
    screen showed them as typed. Unconverted on screen = no math here."""
    assert origin_escapes_to_mathtext(source) == source
    if "$" not in source:
        assert safe_mathtext_label(source) == source


def test_a_label_that_cannot_render_falls_back_to_what_was_typed() -> None:
    """Review finding: the fallback escaped the REWRITTEN label, so the figure
    showed `\\$^{...}$`. It is the typed label, as the screen's fallback."""
    out = safe_mathtext_label("$\\textbf{x}$ \\+(2)")
    assert out == "\\$\\textbf{x}\\$ \\+(2)"
    assert "^{" not in out
