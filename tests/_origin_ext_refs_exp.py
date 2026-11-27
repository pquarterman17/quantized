"""Independent scalar transcriptions of the Exponential formulas (math module only).

name -> (reference(x, *p), parameters, three x values). Written separately from
the vectorised numpy evaluators so a typo in either shows up as a mismatch.
"""

from __future__ import annotations

import math
from collections.abc import Callable

e = math.exp
Ref = tuple[Callable[..., float], tuple[float, ...], tuple[float, float, float]]


def _grow3(x, y0, a1, t1, a2, t2, a3, t3):  # type: ignore[no-untyped-def]
    return y0 + sum(a * e(x / t) for a, t in ((a1, t1), (a2, t2), (a3, t3)))


def _growdec(x, y0, xc, ag, tg, ad, td):  # type: ignore[no-untyped-def]
    if x < xc:
        return y0 + ad + ag * (e(-xc / tg) - e(-x / tg))
    return y0 + ad * e(-(x - xc) / td)


def _g3d2(x, y0, xc, g1, s1, g2, s2, g3, s3, d1, u1, d2, u2):  # type: ignore[no-untyped-def]
    if x < xc:
        pre = sum(g * (1 - e(-xc / s)) for g, s in ((g1, s1), (g2, s2), (g3, s3)))
        now = sum(g * (1 - e(-x / s)) for g, s in ((g1, s1), (g2, s2), (g3, s3)))
        return y0 + d1 + d2 - pre + now
    return y0 + d1 * e(-(x - xc) / u1) + d2 * e(-(x - xc) / u2)


def _pulse(x, y0, x0, a, t1, p, t2):  # type: ignore[no-untyped-def]
    return 0.0 if x < x0 else y0 + a * (1 - e(-(x - x0) / t1)) ** p * e(-(x - x0) / t2)


REFS: dict[str, Ref] = {
    "ExpGro3": (_grow3, (0.5, 1, 2, 3, 4, 5, 6), (0.5, 1.0, 2.0)),
    "ExpGrow": (lambda x, y0, x0, a1, t1, a2, t2:
                y0 + a1 * e((x - x0) / t1) + a2 * e((x - x0) / t2), (0.5, 1, 2, 3, 0.5, 4),
                (1.0, 2.0, 3.0)),
    "Exp1P1": (lambda x, a: e(x - a), (1.5,), (0.0, 1.0, 3.0)),
    "Exp1p2": (lambda x, a: e(-a * x), (0.7,), (0.0, 1.0, 3.0)),
    "Exp1p2Md": (lambda x, b: b**x, (0.6,), (0.0, 1.0, 3.0)),
    "Exp1p3": (lambda x, a: a * e(-a * x), (0.8,), (0.0, 1.0, 3.0)),
    "Exp1P3Md": (lambda x, b: -math.log(b) * b**x, (0.7,), (0.0, 1.0, 3.0)),
    "Exp1P4": (lambda x, a: 1 - e(-a * x), (0.6,), (0.0, 1.0, 3.0)),
    "Exp1P4Md": (lambda x, b: 1 - b**x, (0.7,), (0.0, 1.0, 3.0)),
    "Exp2P": (lambda x, a, b: a * b**x, (2.0, 0.8), (0.0, 1.0, 3.0)),
    "Exp2PMod1": (lambda x, a, b: a * e(b * x), (2.0, -0.4), (0.0, 1.0, 3.0)),
    "Exp2PMod2": (lambda x, a, b: e(a + b * x), (0.5, -0.3), (0.0, 1.0, 3.0)),
    "Exp3P1": (lambda x, a, b, c: a * e(b / (x + c)), (2.0, 3.0, 1.0), (0.0, 1.0, 3.0)),
    "Exp3P1Md": (lambda x, a, b, c: e(a + b / (x + c)), (0.5, 3.0, 1.0), (0.0, 1.0, 3.0)),
    "Exp3P2": (lambda x, a, b, c: e(a + b * x + c * x * x), (1.0, -0.5, 0.03), (0.0, 1.0, 3.0)),
    "BoxLucas1": (lambda x, a, b: a * (1 - e(-b * x)), (3.0, 0.5), (0.0, 1.0, 3.0)),
    "BoxLucas1Mod": (lambda x, a, b: a * (1 - b**x), (3.0, 0.7), (0.0, 1.0, 3.0)),
    "BoxLucas2": (lambda x, a1, a2: a1 / (a1 - a2) * (e(-a2 * x) - e(-a1 * x)), (1.5, 0.4),
                  (0.5, 1.0, 3.0)),
    "Chapman": (lambda x, a, b, c: a * (1 - e(-b * x)) ** c, (4.0, 0.4, 2.0), (0.5, 1.0, 3.0)),
    "Reich": (lambda x, a1, b1, a2, b2: a1 * e(-b1 * x) + a2 * e(-b2 * x), (3, 1.2, 2, 0.15),
              (0.0, 1.0, 3.0)),
    "Shah": (lambda x, a, b, c, r: a + b * x + c * r**x, (1, 0.5, 3, 0.7), (0.0, 1.0, 3.0)),
    "Stirling": (lambda x, a, b, k: a + b * (e(k * x) - 1) / k, (1, 2, 0.3), (0.5, 1.0, 3.0)),
    "YldFert": (lambda x, a, b, r: a + b * r**x, (1, -3, 0.6), (0.0, 1.0, 3.0)),
    "YldFert1": (lambda x, a, b, k: a + b * e(-k * x), (1, 3, 0.5), (0.0, 1.0, 3.0)),
    "Exponential": (lambda x, y0, a, r: y0 + a * e(r * x), (1, 0.5, 0.4), (0.0, 1.0, 3.0)),
    "ExpLinear": (lambda x, p1, p2, p3, p4: p1 * e(-x / p2) + p3 + p4 * x, (3, 2, 1, 0.2),
                  (0.0, 1.0, 3.0)),
    "SingleExp": (lambda x, m, k: m * e(-k * x), (4, 0.5), (0.0, 1.0, 3.0)),
    "SingleExpOffset": (lambda x, m, y0, k: y0 + m * e(-k * x), (4, 1, 0.5), (0.0, 1.0, 3.0)),
    "DoubleExp": (lambda x, a1, k1, a2, k2: a1 * e(-k1 * x) + a2 * e(-k2 * x), (3, 1.5, 2, 0.2),
                  (0.0, 1.0, 3.0)),
    "DoubleExpOffset": (lambda x, y0, a1, a2, k1, k2: y0 + a1 * e(-k1 * x) + a2 * e(-k2 * x),
                        (1, 3, 2, 1.5, 0.2), (0.0, 1.0, 3.0)),
    "FirstOrder": (lambda x, m, k: m * (1 - e(-k * x)), (4, 0.4), (0.0, 1.0, 3.0)),
    "FirstOrderOffset": (lambda x, m, k, o: m * (1 - e(-k * x)) + o, (4, 0.4, 1), (0.0, 1.0, 3.0)),
    "ExponentialCDF": (lambda x, y0, a, mu: y0 if x < 0 else y0 + a * (1 - e(-x / mu)),
                       (0.5, 3, 2), (-1.0, 1.0, 3.0)),
    "Lanczos3": (lambda x, b1, b2, b3, b4, b5, b6:
                 b1 * e(-b2 * x) + b3 * e(-b4 * x) + b5 * e(-b6 * x), (1, 0.3, 2, 1.2, 3, 4),
                 (0.0, 1.0, 3.0)),
    "ExpAssoc": (lambda x, y0, a1, t1, a2, t2:
                 y0 + a1 * (1 - e(-x / t1)) + a2 * (1 - e(-x / t2)), (0.5, 2, 1, 3, 6),
                 (0.0, 1.0, 3.0)),
    "ExpAssoc1": (lambda x, td, yb, a, tau: yb + a * (1 - e(-(x - td) / tau)), (0.5, 0.5, 3, 2),
                  (0.5, 1.0, 3.0)),
    "ExpAssoc2": (lambda x, td1, td2, yb, a1, a2, t1, t2:
                  yb + a1 * (1 - e(-(x - td1) / t1)) + (a2 * (1 - e(-(x - td2) / t2))
                                                        if x >= td2 else 0.0),
                  (0.0, 2.0, 0.5, 3, 2, 1.5, 2), (1.0, 2.0, 4.0)),
    "ExpAssocDelay1": (lambda x, td, yb, a, tau: yb if x < td else yb + a * (1 - e(-(x - td) / tau)),
                       (2, 0.5, 3, 2), (1.0, 2.0, 5.0)),
    "ExpAssocDelay2": (lambda x, td1, td2, yb, a1, a2, t1, t2:
                       yb if x < td1 else yb + a1 * (1 - e(-(x - td1) / t1))
                       + (a2 * (1 - e(-(x - td2) / t2)) if x >= td2 else 0.0),
                       (1, 3, 0.5, 3, 2, 1.5, 2), (0.5, 2.0, 5.0)),
    "ExpGrowDec": (_growdec, (0.5, 6, 3, 2, 3, 4), (1.0, 6.0, 9.0)),
    "ExpGrow3Dec2": (_g3d2, (0.5, 8, 1, 0.5, 1.5, 2, 2, 6, 2, 1, 1.5, 5), (1.0, 8.0, 12.0)),
    "Pulse": (_pulse, (0.2, 1, 3, 0.8, 2, 3), (0.5, 2.0, 6.0)),
    "Pulse1": (lambda x, x0, a, t1, t2, p: 0.0 if x < x0 else
               a * (1 - e(-(x - x0) / t1)) ** p * e(-(x - x0) / t2), (1, 4, 0.8, 3, 2),
               (0.5, 2.0, 6.0)),
}
