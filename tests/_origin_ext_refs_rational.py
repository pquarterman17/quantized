"""Scalar reference transcriptions: Hyperbola, Logarithm, Rational, Polynomial, Power."""

from __future__ import annotations

import math

from _origin_ext_refs_exp import Ref

ln = math.log
X3 = (0.5, 2.0, 7.0)
U3 = (0.1, 0.4, 0.8)  # for the functions defined on (0, 1)


def _power2(x, xc, a, pl, pu):  # type: ignore[no-untyped-def]
    if x == xc:
        return 0.0
    return a * abs(x - xc) ** (pl if x < xc else pu)


REFS: dict[str, Ref] = {
    "Hyperbl": (lambda x, p1, p2: p1 * x / (p2 + x), (5, 2), X3),
    "RectHyperbola": (lambda x, a, b: a * b * x / (1 + b * x), (5, 0.5), X3),
    "Dhyperbl": (lambda x, p1, p2, p3, p4, p5: p1 * x / (p2 + x) + p3 * x / (p4 + x) + p5 * x,
                 (3, 1, 2, 10, 0.05), X3),
    "HyperbolaGen": (lambda x, a, b, c, d: a - b / (1 + c * x) ** (1 / d), (5, 4, 0.5, 2), X3),
    "HyperbolaMod": (lambda x, t1, t2: x / (t1 * x + t2), (0.2, 1.5), X3),
    "BentHyperblSmp": (lambda x, a, b, c, d:
                       a * (1 + b * (x + c) - (1 + (b * (x + c)) ** d) ** (1 / d)),
                       (3, 0.8, 0.5, 2), X3),
    "Logarithm": (lambda x, a: ln(x - a), (-1,), X3),
    "Log2P1": (lambda x, a, b: b * ln(x - a), (-1, 2), X3),
    "Log2P2": (lambda x, a, b: ln(a + b * x), (1, 0.5), X3),
    "Log3P1": (lambda x, a, b, c: a - b * ln(x + c), (5, 1.5, 2), X3),
    "Bradley": (lambda x, a, b: a * ln(-b * ln(x)), (2, 3), U3),
    "Reciprocal0": (lambda x, a: 1 / (1 + a * x), (0.5,), X3),
    "Reciprocal1": (lambda x, a: 1 / (x + a), (2,), X3),
    "Reciprocal": (lambda x, a, b: 1 / (a + b * x), (1, 0.5), X3),
    "ReciprocalMod": (lambda x, a, b: a / (1 + b * x), (3, 0.4), X3),
    "Rational0": (lambda x, a, b, c: (b + c * x) / (1 + a * x), (0.5, 1, 2), X3),
    "Rational1": (lambda x, a, b, c: (1 + c * x) / (a + b * x), (1, 0.5, 2), X3),
    "Rational2": (lambda x, a, b, c: (b + c * x) / (a + x), (2, 1, 3), X3),
    "Rational3": (lambda x, a, b, c: (b + x) / (a + c * x), (1, 3, 0.5), X3),
    "Rational4": (lambda x, a, b, c: c + b / (x + a), (2, 3, 1), X3),
    "Rational5": (lambda x, a, b, c, d: (a + b * x) / (1 + c * x + d * x * x),
                  (1, 2, 0.3, 0.1), X3),
    "Holliday": (lambda x, a, b, c: 1 / (a + b * x + c * x * x), (1, 0.5, 0.1), X3),
    "Holliday1": (lambda x, a, b, c: a / (1 + b * x + c * x * x), (3, 0.5, 0.1), X3),
    "Nelder": (lambda x, a, b0, b1, b2: (x + a) / (b0 + b1 * (x + a) + b2 * (x + a) ** 2),
               (1, 1, 0.5, 0.2), X3),
    "BET": (lambda x, a, b: a * b * x / (1 + (b - 2) * x - (b - 1) * x * x), (2, 20), U3),
    "BETMod": (lambda x, a, b: x / (a + b * x - (a + b) * x * x), (2, 1), U3),
    "Constant": (lambda x, y0: y0, (2.5,), X3),
    "Line": (lambda x, a, b: a + b * x, (1, 0.5), X3),
    "LineMod": (lambda x, a, b: a * (x - b), (0.7, 2), X3),
    "Parabola": (lambda x, a, b, c: a + b * x + c * x * x, (1, -0.5, 0.1), X3),
    "Cubic (Origin)": (lambda x, a, b, c, d: a + b * x + c * x**2 + d * x**3,
                       (1, 0.5, -0.2, 0.01), X3),
    "Poly4": (lambda x, a0, a1, a2, a3, a4: a0 + a1 * x + a2 * x**2 + a3 * x**3 + a4 * x**4,
              (1, 0.5, -0.2, 0.03, -0.001), X3),
    "PolyCtr5": (lambda x, y0, x0, p1, p2, p3, p4, p5:
                 y0 + sum(p * (x - x0) ** i for i, p in enumerate((p1, p2, p3, p4, p5), 1)),
                 (1, 5, 0.5, -0.1, 0.01, 0.001, -0.0001), X3),
    "Power": (lambda x, a: x**a, (0.7,), X3),
    "Freundlich": (lambda x, a, b: a * x**b, (2, 0.6), X3),
    "FreundlichMod1": (lambda x, a, b: a * x ** (1 / b), (2, 1.7), X3),
    "Freundlich3P": (lambda x, a, b, c: a + b * x**c, (1, 2, 0.6), X3),
    "Freundlich3PMod": (lambda x, a, b, k: a + b * x ** (1 / k), (1, 2, 1.8), X3),
    "FreundlichEXT": (lambda x, a, b, c: a * x ** (b * x ** (-c)), (2, 0.8, 0.5), X3),
    "Belehradek": (lambda x, a, b, c: a * (x - b) ** c, (2, -1, 1.5), X3),
    "Pow2P1": (lambda x, a, b: a * (1 - x ** (-b)), (3, 0.8), X3),
    "Pow2P2": (lambda x, a, b: a * (1 + x) ** b, (2, 0.6), X3),
    "Pow2P3": (lambda x, a, b: 1 - 1 / (1 + a * x) ** b, (0.5, 1.5), X3),
    "Pareto": (lambda x, a: 1 - 1 / x**a, (1.5,), X3),
    "Pareto2": (lambda x, a, b: 1 - (b / x) ** a, (2, 1), (1.5, 2.0, 7.0)),
    "Power0": (lambda x, y0, xc, a, p: y0 + a * abs(x - xc) ** p, (1, 2, 0.5, 1.5), X3),
    "Power1": (lambda x, xc, a, p: a * abs(x - xc) ** p, (2, 0.5, 1.5), X3),
    "Power2": (_power2, (3, 0.5, 1.2, 0.8), (1.0, 3.0, 6.0)),
    "LangmuirEXT1": (lambda x, a, b, c: a * b * x ** (1 - c) / (1 + b * x ** (1 - c)),
                     (3, 2, 0.4), X3),
    "LangmuirEXT2": (lambda x, a, b, c: 1 / (a + b * x ** (c - 1)), (0.5, 0.4, 1.5), X3),
    "Gunary": (lambda x, a, b, c: x / (a + b * x + c * math.sqrt(x)), (0.5, 0.3, 0.4), X3),
    "BlNeldSmp": (lambda x, a, b, c: (a + b * x) ** (-1 / c), (1, 0.5, 2), X3),
    "BlNeld": (lambda x, a, b, c, f: (a + b * x**f) ** (-1 / c), (1, 0.5, 2, 1.5), X3),
    "FarazdaghiHarris": (lambda x, a, b, c: 1 / (a + b * x**c), (0.5, 0.3, 1.2), X3),
    "Allometric2": (lambda x, a, b, c: a + b * x**c, (1, 2, 0.6), X3),
}
