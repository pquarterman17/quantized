"""calc.unit_convert's scalar "copy LaTeX" string.

A Python-side presentation output (NOT golden-verified against MATLAB: the
unitConvert freeze records no LaTeX). The contract is that it COMPILES -- the
first version put math-only ``^`` / ``\\cdot`` inside ``\\text{}``, which fails
under both pdflatex ("Missing $") and KaTeX for every compound unit -- and
that its numbers carry full precision, like the frontend's copy-value path.
No TeX engine runs in CI, so compile-validity is checked structurally.
"""

from __future__ import annotations

import re

import numpy as np
import pytest

from quantized.calc.unit_convert import _latex_number, unit_convert

# (value, from, to, the rendered unit substrings each side must contain)
_REPRESENTATIVE = [
    pytest.param(1.0, "m^2", "cm^2", r"\mathrm{m}^{2}", r"\mathrm{cm}^{2}", id="area"),
    pytest.param(
        1.0, "g/cm^3", "kg/m^3", r"\mathrm{g}/\mathrm{cm}^{3}", r"\mathrm{kg}/\mathrm{m}^{3}",
        id="density",
    ),
    pytest.param(
        1.0, "emu", "A*m^2", r"\mathrm{emu}", r"\mathrm{A}\cdot \mathrm{m}^{2}", id="moment"
    ),
    pytest.param(
        1.0, "uOhm*cm", "Ohm*m", r"\mu\Omega\cdot \mathrm{cm}", r"\Omega\cdot \mathrm{m}",
        id="resistivity",
    ),
    pytest.param(
        1.0, "mA/cm^2", "A/m^2", r"\mathrm{mA}/\mathrm{cm}^{2}", r"\mathrm{A}/\mathrm{m}^{2}",
        id="current-density",
    ),
    pytest.param(1.0, "Ang", "nm", r"\mathring{A}", r"\mathrm{nm}", id="angstrom"),
    pytest.param(1.0, "um", "nm", r"\mu\mathrm{m}", r"\mathrm{nm}", id="micro"),
    pytest.param(90.0, "deg", "rad", r"{}^{\circ}", r"\mathrm{rad}", id="degree"),
    pytest.param(300.0, "K", "C", r"\mathrm{K}", r"{}^{\circ}\mathrm{C}", id="celsius"),
    pytest.param(1.0, "cm^-1", "eV", r"\mathrm{cm}^{-1}", r"\mathrm{eV}", id="wavenumber"),
    pytest.param(
        1.0, "J/mol*K", "eV/mol*K", r"\mathrm{J}/(\mathrm{mol}\cdot \mathrm{K})",
        r"\mathrm{eV}/(\mathrm{mol}\cdot \mathrm{K})", id="molar-heat-capacity",
    ),
]


def _text_groups(tex: str) -> list[str]:
    """The bodies of every ``\\text{...}`` group (brace-matched)."""
    bodies = []
    for m in re.finditer(r"\\text\{", tex):
        depth, i = 1, m.end()
        while depth:
            depth += {"{": 1, "}": -1}.get(tex[i], 0) if tex[i - 1] != "\\" else 0
            i += 1
        bodies.append(tex[m.end() : i - 1])
    return bodies


def _assert_compiles_structurally(tex: str) -> None:
    assert tex.isascii(), tex  # pdflatex without inputenc rejects raw µ/°/Å
    assert tex.startswith("$") and tex.endswith("$") and tex.count("$") == 2, tex
    depth = 0
    for prev, ch in zip(" " + tex[:-1], tex, strict=True):
        if prev == "\\":
            continue
        depth += {"{": 1, "}": -1}.get(ch, 0)
        assert depth >= 0, f"unbalanced '}}' in {tex}"
    assert depth == 0, f"unbalanced '{{' in {tex}"
    for body in _text_groups(tex):
        assert "^" not in body and "_" not in body and "\\cdot" not in body, body
        assert "\\text" not in body, f"nested \\text in {tex}"
    assert re.search(r"\^(?!\{)", tex) is None, f"unbraced exponent in {tex}"
    assert re.search(r"\de[+-]?\d", tex) is None, f"raw e-notation in {tex}"


@pytest.mark.parametrize(("value", "src", "dst", "src_tex", "dst_tex"), _REPRESENTATIVE)
def test_latex_compiles_structurally(
    value: float, src: str, dst: str, src_tex: str, dst_tex: str
) -> None:
    _result, info = unit_convert(value, src, dst)
    tex = info["latex"]
    _assert_compiles_structurally(tex)
    lhs, rhs = tex.split(" = ")
    assert lhs.endswith(src_tex), tex
    assert rhs.endswith(dst_tex + "$"), tex


def test_structural_check_rejects_the_old_text_mode_form() -> None:
    """The checker itself catches both defects the review found."""
    for broken in (
        r"$1\,\text{mA/cm^2} = 10\,\text{A/m^2}$",
        r"$1\,\text{A\cdot m^2} = 1000\,\text{emu}$",
        r"$1\,\text{\text{\AA}} = 0.1\,\text{nm}$",
        r"$1e-07\,\mathrm{m} = 0.1\,\mathrm{um}$",
    ):
        with pytest.raises(AssertionError):
            _assert_compiles_structurally(broken)


def test_latex_carries_full_precision() -> None:
    result, info = unit_convert(1.0, "Pa", "Torr")
    r = float(np.asarray(result))
    assert repr(r) in info["latex"]  # all round-trip digits, not :g's six
    assert info["latex"] == r"$1\,\mathrm{Pa} = " + repr(r) + r"\,\mathrm{Torr}$"


@pytest.mark.parametrize(
    ("x", "tex"),
    [
        (10.0, "10"),
        (-272.15, "-272.15"),
        (0.0001, "0.0001"),
        (0.007500637554192106, "0.007500637554192106"),
        (1e-7, "10^{-7}"),
        (-1e-20, "-10^{-20}"),
        (1.5e-7, r"1.5\times 10^{-7}"),
        (6.241509074460763e18, r"6.241509074460763\times 10^{18}"),
        (3e20, r"3\times 10^{20}"),
    ],
)
def test_latex_number_format(x: float, tex: str) -> None:
    assert _latex_number(x) == tex


@pytest.mark.parametrize("x", [1.602176634e-19, 2.99792458e8, 1 / 3, -7.25e-5, 12345.678901234])
def test_latex_number_round_trips(x: float) -> None:
    tex = _latex_number(x)
    m = re.fullmatch(r"(-?[\d.]+)(?:\\times 10\^\{(-?\d+)\})?", tex)
    assert m is not None, tex
    mant, exp = m.group(1), m.group(2)
    assert float(f"{mant}e{exp}" if exp else mant) == x


def test_unit_convert_array_has_no_scalar_latex() -> None:
    _result, info = unit_convert([1.0, 2.0], "m", "cm")
    assert info["latex"] == ""
