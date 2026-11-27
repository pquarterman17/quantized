"""Recovery cases for the Hyperbola, Logarithm, Rational, Polynomial and Power functions."""

from __future__ import annotations

from _origin_ext_cases_exp import Case

CASES: dict[str, Case] = {
    # Hyperbola
    "Hyperbl": Case(0, 20, 201, [5.0, 2.0], 0.004),
    "RectHyperbola": Case(0, 20, 201, [5.0, 0.5], 0.004),
    "Dhyperbl": Case(0, 50, 401, [3.0, 1.0, 2.0, 10.0, 0.05], 0.002),
    "HyperbolaGen": Case(0, 20, 201, [5.0, 4.0, 0.5, 2.0], 0.002),
    "HyperbolaMod": Case(0.1, 20, 201, [0.2, 1.5], 0.003),
    "BentHyperblSmp": Case(0, 10, 201, [3.0, 0.8, 0.5, 2.0], 0.003),
    # Logarithm
    "Logarithm": Case(0, 10, 201, [-1.0], 0.003),
    "Log2P1": Case(0, 10, 201, [-1.0, 2.0], 0.003),
    "Log2P2": Case(0, 20, 201, [1.0, 0.5], 0.003),
    "Log3P1": Case(0, 10, 201, [5.0, 1.5, 2.0], 0.003),
    "Bradley": Case(0.05, 0.9, 201, [2.0, 3.0], 0.003),
    # Rational
    "Reciprocal0": Case(0, 10, 201, [0.5], 0.004),
    "Reciprocal1": Case(0, 10, 201, [2.0], 0.004),
    "Reciprocal": Case(0, 10, 201, [1.0, 0.5], 0.004),
    "ReciprocalMod": Case(0, 10, 201, [3.0, 0.4], 0.004),
    "Rational0": Case(0, 10, 201, [0.5, 1.0, 2.0], 0.003),
    "Rational1": Case(0, 10, 201, [1.0, 0.5, 2.0], 0.003),
    "Rational2": Case(0, 10, 201, [2.0, 1.0, 3.0], 0.003),
    "Rational3": Case(0, 10, 201, [1.0, 3.0, 0.5], 0.003),
    "Rational4": Case(0, 10, 201, [2.0, 3.0, 1.0], 0.003),
    "Rational5": Case(0, 10, 201, [1.0, 2.0, 0.3, 0.1], 0.003),
    "Holliday": Case(0, 10, 201, [1.0, 0.5, 0.1], 0.003),
    "Holliday1": Case(0, 10, 201, [3.0, 0.5, 0.1], 0.003),
    "Nelder": Case(0, 10, 201, [1.0, 1.0, 0.5, 0.2], 0.002),
    "BET": Case(0.02, 0.9, 201, [2.0, 20.0], 0.003),
    "BETMod": Case(0.05, 0.9, 201, [2.0, 1.0], 0.003),
    # Polynomial extras
    "Constant": Case(0, 10, 101, [2.5], 0.004),
    "Line": Case(0, 10, 101, [1.0, 0.5], 0.003),
    "LineMod": Case(0, 10, 101, [0.7, 2.0], 0.003),
    "Parabola": Case(0, 10, 101, [1.0, -0.5, 0.1], 0.002),
    "Cubic (Origin)": Case(0, 10, 101, [1.0, 0.5, -0.2, 0.01], 0.002),
    "Poly4": Case(0, 10, 201, [1.0, 0.5, -0.2, 0.03, -0.001], 0.002),
    "PolyCtr5": Case(0, 10, 201, [1.0, 5.0, 0.5, -0.1, 0.01, 0.001, -0.0001], 0.002, ("x0",)),
    # Power
    "Power": Case(0.1, 5, 201, [0.7], 0.004),
    "Freundlich": Case(0.1, 5, 201, [2.0, 0.6], 0.004),
    "FreundlichMod1": Case(0.1, 5, 201, [2.0, 1.7], 0.004),
    "Freundlich3P": Case(0.1, 5, 201, [1.0, 2.0, 0.6], 0.003),
    "Freundlich3PMod": Case(0.1, 5, 201, [1.0, 2.0, 1.8], 0.003),
    "FreundlichEXT": Case(0.2, 10, 201, [2.0, 0.8, 0.5], 0.003),
    "Belehradek": Case(0, 10, 201, [2.0, -1.0, 1.5], 0.003),
    "Pow2P1": Case(0.2, 10, 201, [3.0, 0.8], 0.003),
    "Pow2P2": Case(0, 10, 201, [2.0, 0.6], 0.003),
    "Pow2P3": Case(0, 10, 201, [0.5, 1.5], 0.004),
    "Pareto": Case(1, 10, 201, [1.5], 0.004),
    "Pareto2": Case(1.05, 10, 201, [2.0, 1.0], 0.004),
    "Power0": Case(0, 6, 201, [1.0, 2.0, 0.5, 1.5], 0.003),
    "Power1": Case(0, 6, 201, [2.0, 0.5, 1.5], 0.003),
    "Power2": Case(0, 6, 201, [3.0, 0.5, 1.2, 0.8], 0.003),
    "LangmuirEXT1": Case(0.05, 10, 201, [3.0, 2.0, 0.4], 0.003),
    "LangmuirEXT2": Case(0.1, 10, 201, [0.5, 0.4, 1.5], 0.003),
    "Gunary": Case(0.1, 10, 201, [0.5, 0.3, 0.4], 0.003),
    "BlNeldSmp": Case(0, 10, 201, [1.0, 0.5, 2.0], 0.003),
    "BlNeld": Case(0, 10, 201, [1.0, 0.5, 2.0, 1.5], 0.003),
    "FarazdaghiHarris": Case(0.1, 10, 201, [0.5, 0.3, 1.2], 0.003),
    "Allometric2": Case(0.1, 5, 201, [1.0, 2.0, 0.6], 0.003),
}
