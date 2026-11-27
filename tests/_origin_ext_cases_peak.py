"""Recovery cases for the extra Peak and Waveform functions."""

from __future__ import annotations

from _origin_ext_cases_exp import Case

CASES: dict[str, Case] = {
    "Gaussian (Origin)": Case(0, 20, 301, [0.2, 10.0, 3.0, 5.0], 0.005),
    "Composite": Case(0, 20, 301, [0.2, 10.0, 3.0, 5.0], 0.005),
    "AsymmetricGaussian": Case(0, 20, 301, [0.2, 10.0, 1.5, 3.0, 2.0], 0.005),
    "Bigaussian": Case(0, 20, 301, [0.2, 10.0, 2.0, 1.5, 3.0], 0.005),
    "DoniachSunjic": Case(0, 20, 401, [0.1, 10.0, 3.0, 1.5, 0.2], 0.003),
    "BWF": Case(0, 20, 401, [0.1, 10.0, 2.0, 1.5, 2.0], 0.003,
                alts=((2.6, 10.0, -0.5, 1.5, -0.5),)),  # q -> -1/q, H -> -H/q^2
    "Gaussian_LorenCross": Case(0, 20, 301, [0.1, 10.0, 2.0, 2.5, 0.5], 0.004),
    "GaussMod": Case(0, 30, 401, [0.1, 3.0, 8.0, 1.2, 1.5], 0.004),
    "Giddings": Case(0.1, 40, 401, [0.1, 10.0, 2.0, 5.0], 0.004),
    "Logistpk": Case(0, 20, 301, [0.1, 10.0, 1.5, 3.0], 0.004),
    "InvsPoly": Case(0, 20, 401, [0.1, 10.0, 4.0, 3.0, 1.0, 0.2, 0.05], 0.003, curve_only=True),
    "Beta": Case(0, 20, 401, [0.1, 10.0, 3.0, 10.0, 3.0, 3.0], 0.003),
    "Extreme": Case(0, 20, 301, [0.1, 10.0, 2.0, 3.0], 0.004),
    "Weibull3": Case(0, 20, 401, [0.1, 5.0, 3.0, 4.0, 2.5], 0.003),
    "ECS": Case(0, 20, 401, [0.1, 10.0, 3.0, 1.5, 0.3, 0.2], 0.003, curve_only=True),
    "GCAS": Case(0, 20, 401, [0.1, 10.0, 3.0, 1.5, 0.3, 0.2], 0.003),
    "PearsonVII": Case(0, 20, 401, [0.1, 10.0, 3.0, 2.5, 2.0], 0.003),
    "SchulzFlory": Case(0, 3, 401, [0.1, 1.0, 0.3, 5.0], 0.004),
    "SineSqr": Case(0, 20, 401, [0.2, 1.0, 4.0, 2.0], 0.004, wrap=(1, 2)),
    "SawtoothWave": Case(0, 20, 801, [0.5, 0.2, 3.0, 4.0], 0.004, wrap=(0, 3)),
}
