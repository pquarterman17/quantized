"""Scalar reference transcriptions of the Growth/Sigmoidal formulas (math only)."""

from __future__ import annotations

import math

from _origin_ext_refs_exp import Ref

e = math.exp


def _srich1(x, a, xc, d, k):  # type: ignore[no-untyped-def]
    ex = e(-k * (x - xc))
    base = a ** (1 - d) - ex if d < 1 else a ** (1 - d) + ex
    return base ** (1 / (1 - d))


def _mw(x, vmax, k1, k2, big_l, q):  # type: ignore[no-untyped-def]
    l1 = (big_l * (1 + k1 * x) / (1 + k2 * x)) ** q
    return vmax * (k1 * x / (1 + k1 * x) + l1 * k2 * x / (1 + k2 * x)) / (l1 + 1)


REFS: dict[str, Ref] = {
    "ExpGrowth": (lambda x, x0, k: e(k * (x - x0)), (3, 0.8), (0.0, 2.0, 5.0)),
    "TimePow": (lambda x, a, b: a * x**b, (2, 0.7), (0.5, 2.0, 9.0)),
    "MnMolecular": (lambda x, a, xc, k: a * (1 - e(-k * (x - xc))), (4, 0.5, 0.8), (1.0, 2.0, 5.0)),
    "MnMolecular1": (lambda x, a1, a2, k: a1 - a2 * e(-k * x), (4, 3, 0.5), (0.0, 2.0, 5.0)),
    "Asymptotic1": (lambda x, a, b, c: a - b * c**x, (5, 4, 0.6), (0.0, 2.0, 5.0)),
    "Asymptotic2": (lambda x, a, b, k: a - b * e(-k * x), (5, 4, 0.5), (0.0, 2.0, 5.0)),
    "Asymptotic3": (lambda x, a, xc, k: a * (1 - e(-k * (x - xc))), (5, 0.5, 0.6), (1.0, 2.0, 5.0)),
    "Asymptotic4": (lambda x, a, b, i: a + (i - a) * b**x, (5, 0.6, 1), (0.0, 2.0, 5.0)),
    "Asymptotic5": (lambda x, a, i, k: a + (i - a) * e(-k * x), (5, 1, 0.5), (0.0, 2.0, 5.0)),
    "Asymptotic6": (lambda x, a, b, k: a - e(-(b + k * x)), (5, 0.5, 0.4), (0.0, 2.0, 5.0)),
    "Asymptotic7": (lambda x, i, b, k: i + b * (1 - e(-k * x)), (1, 4, 0.5), (0.0, 2.0, 5.0)),
    "SLogistic2": (lambda x, y0, a, w: a / (1 + (a - y0) / y0 * e(-4 * w * x / a)), (0.5, 5, 1.2),
                   (0.0, 2.0, 5.0)),
    "SLogistic3": (lambda x, a, b, k: a / (1 + b * e(-k * x)), (5, 10, 0.8), (0.0, 2.0, 5.0)),
    "SLogistic4": (lambda x, a, b, xc, k: b + (a - b) / (1 + e(-k * (x - xc))), (5, 1, 5, 0.8),
                   (0.0, 5.0, 8.0)),
    "SWeibull2": (lambda x, a, b, d, k: a - (a - b) * e(-((k * x) ** d)), (5, 0.5, 2, 0.4),
                  (0.5, 2.0, 5.0)),
    "SRichards1": (_srich1, (5, 2, 0.5, 0.8), (2.0, 4.0, 9.0)),
    "SRichards2": (lambda x, a, xc, d, k: a * (1 + (d - 1) * e(-k * (x - xc))) ** (1 / (1 - d)),
                   (5, 3, 3, 0.8), (0.0, 3.0, 9.0)),
    "Richards": (lambda x, a, lo, k, d: a * (1 + e(-(lo + k * x) / d)) ** d, (5, -2, 0.8, 2),
                 (0.0, 2.0, 9.0)),
    "MWChang": (_mw, (5, 2, 0.2, 3, 1.0), (0.1, 1.0, 8.0)),
    "DoubleBoltzmann": (lambda x, y0, a, f, x1, x2, k1, k2:
                        y0 + a * (f / (1 + e((x - x1) / k1)) + (1 - f) / (1 + e((x - x2) / k2))),
                        (0.5, 4, 0.4, -3, 3, 1, 1.5), (-4.0, 0.0, 3.5)),
    "Biphasic": (lambda x, amin, a1, a2, x1, x2, h1, h2:
                 amin + (a1 - amin) / (1 + 10 ** ((x - x1) * h1))
                 + (a2 - amin) / (1 + 10 ** ((x2 - x) * h2)), (0, 3, 2.5, -2, 2, 1.5, 1.2),
                 (-3.0, 0.0, 2.5)),
    "BiDoseResp": (lambda x, a1, a2, c1, c2, h1, h2, p:
                   a1 + (a2 - a1) * (p / (1 + 10 ** ((c1 - x) * h1))
                                     + (1 - p) / (1 + 10 ** ((c2 - x) * h2))),
                   (0, 5, -2, 2, 1.5, 1.2, 0.4), (-3.0, 0.0, 3.0)),
}
