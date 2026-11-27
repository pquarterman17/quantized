"""Recovery cases for ``fit_models_origin_growth2`` (see _origin_ext_cases_exp.Case)."""

from __future__ import annotations

from _origin_ext_cases_exp import Case

CASES: dict[str, Case] = {
    "ExpGrowth": Case(0, 5, 201, [3.0, 0.8], 0.003),
    "TimePow": Case(0.1, 10, 201, [2.0, 0.7], 0.005),
    "MnMolecular": Case(0, 8, 201, [4.0, 0.5, 0.8], 0.003),
    "MnMolecular1": Case(0, 10, 201, [4.0, 3.0, 0.5], 0.003),
    "Asymptotic1": Case(0, 10, 201, [5.0, 4.0, 0.6], 0.003),
    "Asymptotic2": Case(0, 10, 201, [5.0, 4.0, 0.5], 0.003),
    "Asymptotic3": Case(0, 10, 201, [5.0, 0.5, 0.6], 0.003),
    "Asymptotic4": Case(0, 10, 201, [5.0, 0.6, 1.0], 0.003),
    "Asymptotic5": Case(0, 10, 201, [5.0, 1.0, 0.5], 0.003),
    "Asymptotic6": Case(0, 10, 201, [5.0, 0.5, 0.4], 0.003),
    "Asymptotic7": Case(0, 10, 201, [1.0, 4.0, 0.5], 0.003),
    "SLogistic2": Case(0, 15, 301, [0.5, 5.0, 1.2], 0.005),
    "SLogistic3": Case(0, 15, 301, [5.0, 10.0, 0.8], 0.005),
    "SLogistic4": Case(0, 10, 201, [5.0, 1.0, 5.0, 0.8], 0.005,
                        alts=((1.0, 5.0, 5.0, -0.8),)),
    "SWeibull2": Case(0, 10, 201, [5.0, 0.5, 2.0, 0.4], 0.004),
    "SRichards1": Case(1.5, 12, 251, [5.0, 2.0, 0.5, 0.8], 0.003),
    "SRichards2": Case(0, 12, 251, [5.0, 3.0, 3.0, 0.8], 0.003),
    "Richards": Case(0, 12, 251, [5.0, -2.0, 0.8, 2.0], 0.003),
    "MWChang": Case(0.05, 20, 401, [5.0, 2.0, 0.2, 3.0, 1.0], 0.002, curve_only=True),
    "DoubleBoltzmann": Case(-10, 10, 401, [0.5, 4.0, 0.4, -3.0, 3.0, 1.0, 1.5], 0.002,
                            alts=((0.5, 4.0, 0.6, 3.0, -3.0, 1.5, 1.0),)),
    "Biphasic": Case(-6, 6, 301, [0.0, 3.0, 2.5, -2.0, 2.0, 1.5, 1.2], 0.003),
    "BiDoseResp": Case(-6, 6, 301, [0.0, 5.0, -2.0, 2.0, 1.5, 1.2, 0.4], 0.003),
}
