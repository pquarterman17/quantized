"""Scalar reference transcriptions of the extra Peak and Waveform formulas (math only)."""

from __future__ import annotations

import math

from _origin_ext_refs_exp import Ref

e = math.exp
X3 = (6.0, 10.0, 13.0)


def _gaussmod(x, y0, a, xc, w, t0):  # type: ignore[no-untyped-def]
    z = (x - xc) / w - w / t0  # the textbook form, with exp(+) and erf
    return y0 + a / t0 * e(0.5 * (w / t0) ** 2 - (x - xc) / t0) * (math.erf(z / math.sqrt(2)) + 1) / 2


def _giddings(x, y0, xc, w, a):  # type: ignore[no-untyped-def]
    z = 2 * math.sqrt(xc * x) / w
    # I1(z) from its power series (independent of scipy)
    i1 = sum((z / 2) ** (2 * k + 1) / (math.factorial(k) * math.factorial(k + 1)) for k in range(60))
    return y0 + (a / w) * math.sqrt(xc / x) * i1 * e((-x - xc) / w)


def _beta(x, y0, xc, a, w1, w2, w3):  # type: ignore[no-untyped-def]
    u = (x - xc) / w1
    left = 1 + (w2 + w3 - 2) / (w2 - 1) * u
    right = 1 - (w2 + w3 - 2) / (w3 - 1) * u
    if left <= 0 or right <= 0:
        return y0
    return y0 + a * left ** (w2 - 1) * right ** (w3 - 1)


def _weibull3(x, y0, xc, a, w1, w2):  # type: ignore[no-untyped-def]
    c = (w2 - 1) / w2
    s = (x - xc) / w1 + c ** (1 / w2)
    if s <= 0:
        return y0
    return y0 + a * c ** ((1 - w2) / w2) * s ** (w2 - 1) * e(-(s**w2) + c)


def _ecs(x, y0, xc, a, w, a3, a4):  # type: ignore[no-untyped-def]
    u = (x - xc) / w
    s = (1 + a3 / (3 * 2 * 1) * u * (u**2 - 3) + a4 / (4 * 3 * 2 * 1) * (u**4 - 6 * u**3 + 3)
         + (10 * a3**2) / (6 * 5 * 4 * 3 * 2 * 1) * (u**6 - 15 * u**4 + 45 * u**2 - 15))
    return y0 + a / (w * math.sqrt(2 * math.pi)) * (e(-0.5 * u**2) * s)


def _gcas(x, y0, xc, a, w, a3, a4):  # type: ignore[no-untyped-def]
    u = (x - xc) / w
    s = 1 + a3 / 6 * (u**3 - 3 * u) + a4 / 24 * (u**4 - 6 * u**2 + 3)
    return y0 + a / (w * math.sqrt(2 * math.pi)) * e(-(u**2) / 2) * s


def _pearson7(x, y0, xc, a, w, m):  # type: ignore[no-untyped-def]
    k = 2 ** (1 / m) - 1
    pre = 2 * math.gamma(m) * math.sqrt(k) / (math.sqrt(math.pi) * w * math.gamma(m - 0.5))
    return y0 + a * pre * (1 + 4 * k / w**2 * (x - xc) ** 2) ** (-m)


REFS: dict[str, Ref] = {
    "Gaussian (Origin)": (lambda x, y0, xc, a, w: y0 + a / (w * math.sqrt(math.pi / (4 * math.log(2))))
                          * e(-4 * math.log(2) * (x - xc) ** 2 / w**2), (0.2, 10, 3, 5), X3),
    "Composite": (lambda x, y0, xc, w, a: y0 + a / (w * math.sqrt(math.pi / 2))
                  * e(-2 * ((x - xc) / w) ** 2), (0.2, 10, 3, 5), X3),
    "AsymmetricGaussian": (lambda x, y0, xc, w1, w2, a:
                           y0 + a * e(-0.5 * ((x - xc) / (w1 if x < xc else w2)) ** 2),
                           (0.2, 10, 1.5, 3, 2), X3),
    "Bigaussian": (lambda x, y0, xc, h, w1, w2:
                   y0 + h * e(-((x - xc) ** 2) / (2 * (w1 if x < xc else w2) ** 2)),
                   (0.2, 10, 2, 1.5, 3), X3),
    "DoniachSunjic": (lambda x, y0, xc, h, w, a: y0 + h * math.cos(math.pi * a / 2
                                                                  + (1 - a) * math.atan((x - xc) / w))
                      / (w * w + (x - xc) ** 2) ** ((1 - a) / 2), (0.1, 10, 3, 1.5, 0.2), X3),
    "BWF": (lambda x, y0, xc, h, w, q: y0 + h * (1 + (x - xc) / (q * w)) ** 2
            / (1 + ((x - xc) / w) ** 2), (0.1, 10, 2, 1.5, 2), X3),
    "Gaussian_LorenCross": (lambda x, y0, xc, a, w, s: y0 + a / (
        1 + s * ((x - xc) / w) ** 2 * e(0.5 * (1 - s) * ((x - xc) / w) ** 2)),
        (0.1, 10, 2, 2.5, 0.5), X3),
    "GaussMod": (_gaussmod, (0.1, 3, 8, 1.2, 1.5), (4.0, 8.0, 12.0)),
    "Giddings": (_giddings, (0.1, 10, 2, 5), (4.0, 10.0, 20.0)),
    "Logistpk": (lambda x, y0, xc, w, a: y0 + 4 * a * e(-(x - xc) / w) / (1 + e(-(x - xc) / w)) ** 2,
                 (0.1, 10, 1.5, 3), X3),
    "InvsPoly": (lambda x, y0, xc, w, a, a1, a2, a3: y0 + a / (
        1 + a1 * (2 * (x - xc) / w) ** 2 + a2 * (2 * (x - xc) / w) ** 4
        + a3 * (2 * (x - xc) / w) ** 6), (0.1, 10, 4, 3, 1, 0.2, 0.05), X3),
    "Beta": (_beta, (0.1, 10, 3, 10, 3, 3), (3.0, 8.0, 12.0)),
    "Extreme": (lambda x, y0, xc, w, a: y0 + a * e(-e(-(x - xc) / w) - (x - xc) / w + 1),
                (0.1, 10, 2, 3), X3),
    "Weibull3": (_weibull3, (0.1, 5, 3, 4, 2.5), (2.0, 6.0, 9.0)),
    "ECS": (_ecs, (0.1, 10, 3, 1.5, 0.3, 0.2), X3),
    "GCAS": (_gcas, (0.1, 10, 3, 1.5, 0.3, 0.2), X3),
    "PearsonVII": (_pearson7, (0.1, 10, 3, 2.5, 2.0), X3),
    "SchulzFlory": (lambda x, y0, xc, w, a: y0 + a * e((xc - x) / w) * (x / xc) ** (xc / w),
                    (0.1, 10, 3, 5), X3),
    "SineSqr": (lambda x, y0, xc, w, a: y0 + a * math.sin(math.pi * (x - xc) / w) ** 2,
                (0.2, 1, 4, 2), (0.3, 1.7, 5.2)),
    "SawtoothWave": (lambda x, x0, y0, a, t: y0 + a / t * ((x - x0) % t), (0.5, 0.2, 3, 4),
                     (0.7, 3.9, 9.3)),
}
