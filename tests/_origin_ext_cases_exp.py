"""Recovery cases for the Exponential functions in ``fit_models_origin_exp2``.

name -> Case(x0, x1, n, truth, noise, held): synthetic data from ``truth`` on
``n`` points of [x0, x1], seeded Gaussian noise of ``noise`` * the curve's
range, parameters named in ``held`` fixed at their guess (onsets that are not
independent of an amplitude, as Origin users hold them).
"""

from __future__ import annotations

from typing import NamedTuple


class Case(NamedTuple):
    x0: float
    x1: float
    n: int
    truth: list[float]
    noise: float
    held: tuple[str, ...] = ()
    # Parameter-index groups that are interchangeable terms (A1,t1 vs A2,t2):
    # the fit is relabelled to the truth's order before comparing.
    groups: tuple[tuple[int, ...], ...] = ()
    # Judge the fitted curve only (ill-conditioned parameter sets).
    curve_only: bool = False
    # Equivalent parameter sets (a symmetry of the formula) the fit may land on.
    alts: tuple[tuple[float, ...], ...] = ()


CASES: dict[str, Case] = {
    "ExpGro3": Case(0, 6, 601, [0.5, 1.0, 1.0, 0.8, 2.5, 0.6, 5.0], 0.0005, curve_only=True),
    "ExpGrow": Case(1, 6, 401, [0.5, 1.0, 1.0, 1.0, 0.5, 4.0], 0.001, ("x0",)),
    "Exp1P1": Case(0, 5, 201, [1.5], 0.005),
    "Exp1p2": Case(0, 5, 201, [0.7], 0.005),
    "Exp1p2Md": Case(0, 8, 201, [0.6], 0.005),
    "Exp1p3": Case(0, 6, 201, [0.8], 0.005),
    "Exp1P3Md": Case(0, 10, 201, [0.7], 0.005),
    "Exp1P4": Case(0, 8, 201, [0.6], 0.005),
    "Exp1P4Md": Case(0, 12, 201, [0.7], 0.005),
    "Exp2P": Case(0, 10, 201, [2.0, 0.8], 0.005),
    "Exp2PMod1": Case(0, 8, 201, [2.0, -0.4], 0.005),
    "Exp2PMod2": Case(0, 8, 201, [0.5, -0.3], 0.005),
    "Exp3P1": Case(0, 10, 201, [2.0, 3.0, 1.0], 0.003),
    "Exp3P1Md": Case(0, 10, 201, [0.5, 3.0, 1.0], 0.003),
    "Exp3P2": Case(0, 6, 201, [1.0, -0.5, 0.03], 0.003),
    "BoxLucas1": Case(0, 10, 201, [3.0, 0.5], 0.005),
    "BoxLucas1Mod": Case(0, 12, 201, [3.0, 0.7], 0.005),
    "BoxLucas2": Case(0, 15, 301, [1.5, 0.4], 0.003),
    "Chapman": Case(0, 12, 201, [4.0, 0.4, 2.0], 0.003),
    "Reich": Case(0, 20, 401, [3.0, 1.2, 2.0, 0.15], 0.002, groups=((0, 1), (2, 3))),
    "Shah": Case(0, 15, 201, [1.0, 0.5, 3.0, 0.7], 0.003),
    "Stirling": Case(0, 6, 201, [1.0, 2.0, 0.3], 0.003),
    "YldFert": Case(0, 12, 201, [1.0, -3.0, 0.6], 0.005),
    "YldFert1": Case(0, 10, 201, [1.0, 3.0, 0.5], 0.005),
    "Exponential": Case(0, 6, 201, [1.0, 0.5, 0.4], 0.003),
    "ExpLinear": Case(0, 15, 301, [3.0, 2.0, 1.0, 0.2], 0.003),
    "SingleExp": Case(0, 10, 201, [4.0, 0.5], 0.005),
    "SingleExpOffset": Case(0, 10, 201, [4.0, 1.0, 0.5], 0.005),
    "DoubleExp": Case(0, 20, 401, [3.0, 1.5, 2.0, 0.2], 0.002, groups=((0, 1), (2, 3))),
    "DoubleExpOffset": Case(0, 20, 401, [1.0, 3.0, 2.0, 1.5, 0.2], 0.002, groups=((1, 3), (2, 4))),
    "FirstOrder": Case(0, 10, 201, [4.0, 0.4], 0.005),
    "FirstOrderOffset": Case(0, 10, 201, [4.0, 0.4, 1.0], 0.005),
    "ExponentialCDF": Case(-2, 15, 301, [0.5, 3.0, 2.0], 0.005),
    "Lanczos3": Case(0, 10, 501, [1.0, 0.3, 2.0, 1.2, 3.0, 4.0], 0.0005,
                     groups=((0, 1), (2, 3), (4, 5))),
    "ExpAssoc": Case(0, 30, 401, [0.5, 2.0, 1.0, 3.0, 6.0], 0.002, groups=((1, 2), (3, 4))),
    "ExpAssoc1": Case(0, 12, 201, [0.0, 0.5, 3.0, 2.0], 0.005, ("TD",)),
    "ExpAssoc2": Case(0, 20, 401, [0.0, 8.0, 0.5, 3.0, 2.0, 1.5, 2.0], 0.003, ("TD1",)),
    "ExpAssocDelay1": Case(0, 14, 281, [2.0, 0.5, 3.0, 2.0], 0.005),
    "ExpAssocDelay2": Case(0, 20, 401, [1.0, 8.0, 0.5, 3.0, 2.0, 1.5, 2.0], 0.003),
    "ExpGrowDec": Case(0, 20, 401, [0.5, 6.0, 3.0, 2.0, 3.0, 4.0], 0.003),
    "ExpGrow3Dec2": Case(0, 30, 601, [0.5, 8.0, 1.0, 0.5, 1.5, 2.0, 2.0, 6.0, 2.0, 1.0, 1.5, 5.0],
                         0.002, curve_only=True),
    "Pulse": Case(0, 15, 301, [0.2, 1.0, 3.0, 0.8, 2.0, 3.0], 0.003),
    "Pulse1": Case(0, 15, 301, [1.0, 4.0, 0.8, 3.0, 2.0], 0.003),
}
