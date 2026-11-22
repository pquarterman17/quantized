"""Curve Fit "Result on graph" (frontend FITANN): the annotation text the panel
generates (plain Unicode and the mathtext subset) must reach the vector export
unchanged -- same string on screen and in the PDF/SVG, no silent de-math."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure import render_figure
from quantized.calc.figure_labels import safe_mathtext_label

GENERATED = [
    r"$y=A\,e^{\frac{-x}{\tau}}+C$;  $A=1.00\pm0.10$;  $\tau=2.00\pm0.20$;  $R^2=0.99812$",
    r"$y=\frac{A\,x}{K+x}$;  $K=(5.4\pm1.4)\times10^{-13}\ \mathrm{emu/K}$;  $N=42$",
    r"$y=\mathrm{ln}(x)+\sqrt{x}+|x|+x^{1.5}$;  $m=1\ (\mathrm{fixed})$",
    "y = A·exp(-x/τ) + C;  A = (5.4 ± 1.4)×10⁻¹³;  R² = 0.99812",
]


@pytest.mark.parametrize("text", GENERATED)
def test_generated_fit_text_survives_the_export_label_gate(text: str) -> None:
    assert safe_mathtext_label(text) == text


@pytest.mark.parametrize("fmt", ["svg", "pdf"])
def test_page_anchored_fit_annotation_renders_in_vector_export(fmt: str) -> None:
    x = np.linspace(0, 10, 20)
    ann = {"x": 0.05, "y": 0.1, "text": GENERATED[0], "anchor": "page", "dot": False}
    out = render_figure(x, [("y", x)], fmt=fmt, overrides={"annotations": [ann]})
    assert len(out) > 1000
    if fmt == "svg":
        assert out.lstrip().startswith(b"<?xml") or b"<svg" in out
