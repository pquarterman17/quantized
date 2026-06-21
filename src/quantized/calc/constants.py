"""Fundamental physical constants (CODATA 2018, SI units). Port of calc.constants."""

from __future__ import annotations

import math

__all__ = ["constants"]


def constants() -> dict[str, float]:
    """Return a dict of fundamental physical constants (CODATA 2018, SI)."""
    return {
        "h": 6.62607015e-34,  # Planck constant (J*s)
        "hbar": 1.054571817e-34,  # reduced Planck constant (J*s)
        "c": 2.99792458e8,  # speed of light (m/s)
        "e": 1.602176634e-19,  # elementary charge (C)
        "kB": 1.380649e-23,  # Boltzmann constant (J/K)
        "NA": 6.02214076e23,  # Avogadro number (1/mol)
        "mu0": 4 * math.pi * 1e-7,  # vacuum permeability (H/m)
        "eps0": 8.8541878128e-12,  # vacuum permittivity (F/m)
        "muB": 9.2740100783e-24,  # Bohr magneton (J/T)
        "r_e": 2.8179403262e-15,  # classical electron radius (m)
        "m_e": 9.1093837015e-31,  # electron mass (kg)
        "R": 8.314462618,  # molar gas constant (J/mol/K)
        "F": 96485.33212,  # Faraday constant (C/mol)
        "Phi0": 2.067833848e-15,  # magnetic flux quantum (Wb)
    }
