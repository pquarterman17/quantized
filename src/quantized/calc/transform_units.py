"""Unit strings for the derivative/integral transforms of ``corrections``.

Pure calc layer. Split out of :mod:`quantized.calc.corrections` (module
ceiling) when that pipeline grew bound-uncertainty propagation; the bodies
are unchanged.
"""

from __future__ import annotations

__all__ = ["unit_product", "unit_quotient"]


def unit_product(left: str, right: str) -> str:
    left, right = left.strip(), right.strip()
    if left and right:
        return f"{left}*{right}"
    return left or right


def unit_quotient(numerator: str, denominator: str, power: int = 1) -> str:
    numerator, denominator = numerator.strip(), denominator.strip()
    if not denominator:
        return numerator
    # Reciprocal x units are common in spectroscopy. ``1/cm^-1`` is
    # dimensionally valid but visually ambiguous; express the first
    # derivative as ``cm`` (or ``V*cm``) instead. Higher powers retain an
    # explicit parenthesized denominator rather than the malformed
    # ``cm^-1^2``.
    if power == 1 and denominator.endswith("^-1"):
        return unit_product(numerator, denominator[:-3])
    if power == 1 and denominator.endswith("⁻¹"):
        return unit_product(numerator, denominator[:-2])
    complex_denominator = any(token in denominator for token in ("/", "*", "^", "·"))
    den = (
        denominator
        if power == 1
        else f"({denominator})^{power}" if complex_denominator else f"{denominator}^{power}"
    )
    return f"{numerator}/{den}" if numerator else f"1/{den}"
