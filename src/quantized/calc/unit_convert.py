"""General unit-expression converter. Port of calc.unitConvert.

Pure calc layer. Parses compound unit strings (e.g. ``mA/cm^2``, ``uOhm*cm``)
into a 7-D SI dimension vector + scale, then converts by ratio of scales — with
special handling for temperature offsets (K/C/F) and equivalence bridges
(energy↔wavelength/frequency/wavenumber, H↔B field).
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from .constants import constants

__all__ = ["unit_convert"]

# Dimension vector order: [M L T I Theta N J]  (kg m s A K mol cd)
_ZERO = (0, 0, 0, 0, 0, 0, 0)

# Base unit registry: name -> (dimension tuple, factor to SI).
_BASE_UNITS: dict[str, tuple[tuple[int, ...], float]] = {
    "m": ((0, 1, 0, 0, 0, 0, 0), 1.0),
    "Ang": ((0, 1, 0, 0, 0, 0, 0), 1e-10),
    "angstrom": ((0, 1, 0, 0, 0, 0, 0), 1e-10),
    "kg": ((1, 0, 0, 0, 0, 0, 0), 1.0),
    "g": ((1, 0, 0, 0, 0, 0, 0), 1e-3),
    "u": ((1, 0, 0, 0, 0, 0, 0), 1.66053906660e-27),
    "amu": ((1, 0, 0, 0, 0, 0, 0), 1.66053906660e-27),
    "s": ((0, 0, 1, 0, 0, 0, 0), 1.0),
    "min": ((0, 0, 1, 0, 0, 0, 0), 60.0),
    "hr": ((0, 0, 1, 0, 0, 0, 0), 3600.0),
    "A": ((0, 0, 0, 1, 0, 0, 0), 1.0),
    "K": ((0, 0, 0, 0, 1, 0, 0), 1.0),
    "C": ((0, 0, 0, 0, 1, 0, 0), 1.0),
    "F": ((0, 0, 0, 0, 1, 0, 0), 1.0),
    "mol": ((0, 0, 0, 0, 0, 1, 0), 1.0),
    "Hz": ((0, 0, -1, 0, 0, 0, 0), 1.0),
    "THz": ((0, 0, -1, 0, 0, 0, 0), 1e12),
    "N": ((1, 1, -2, 0, 0, 0, 0), 1.0),
    "J": ((1, 2, -2, 0, 0, 0, 0), 1.0),
    "eV": ((1, 2, -2, 0, 0, 0, 0), 1.602176634e-19),
    "erg": ((1, 2, -2, 0, 0, 0, 0), 1e-7),
    "cal": ((1, 2, -2, 0, 0, 0, 0), 4.184),
    "W": ((1, 2, -3, 0, 0, 0, 0), 1.0),
    "Pa": ((1, -1, -2, 0, 0, 0, 0), 1.0),
    "bar": ((1, -1, -2, 0, 0, 0, 0), 1e5),
    "atm": ((1, -1, -2, 0, 0, 0, 0), 101325.0),
    "Torr": ((1, -1, -2, 0, 0, 0, 0), 133.322),
    "mbar": ((1, -1, -2, 0, 0, 0, 0), 100.0),
    "psi": ((1, -1, -2, 0, 0, 0, 0), 6894.76),
    "GPa": ((1, -1, -2, 0, 0, 0, 0), 1e9),
    "MPa": ((1, -1, -2, 0, 0, 0, 0), 1e6),
    "V": ((1, 2, -3, -1, 0, 0, 0), 1.0),
    "Ohm": ((1, 2, -3, -2, 0, 0, 0), 1.0),
    "ohm": ((1, 2, -3, -2, 0, 0, 0), 1.0),
    "S": ((-1, -2, 3, 2, 0, 0, 0), 1.0),
    "F_cap": ((-1, -2, 4, 2, 0, 0, 0), 1.0),
    "Coul": ((0, 0, 1, 1, 0, 0, 0), 1.0),
    "T": ((1, 0, -2, -1, 0, 0, 0), 1.0),
    "G": ((1, 0, -2, -1, 0, 0, 0), 1e-4),
    "Oe": ((0, -1, 0, 1, 0, 0, 0), 1000.0 / (4 * np.pi)),
    "emu": ((0, 2, 0, 1, 0, 0, 0), 1e-3),
    "rad": (_ZERO, 1.0),
    "deg": (_ZERO, float(np.pi / 180.0)),
    "mrad": (_ZERO, 1e-3),
    "ions": (_ZERO, 1.0),
    "counts": (_ZERO, 1.0),
    "sq": (_ZERO, 1.0),
}

_PREFIXES: dict[str, float] = {
    "Y": 1e24, "Z": 1e21, "E": 1e18, "P": 1e15, "T": 1e12, "G": 1e9, "M": 1e6,
    "k": 1e3, "h": 1e2, "da": 1e1, "d": 1e-1, "c": 1e-2, "m": 1e-3, "u": 1e-6,
    "mu": 1e-6, "micro": 1e-6, "n": 1e-9, "p": 1e-12, "f": 1e-15, "a": 1e-18,
}
# Longest prefix first (ties don't matter — each first char maps uniquely).
_PREFIX_KEYS = sorted(_PREFIXES, key=len, reverse=True)

_TEMP_DIM = np.array([0, 0, 0, 0, 1, 0, 0], dtype=float)


def _tokenize(unit_str: str) -> list[dict[str, Any]]:
    tokens: list[dict[str, Any]] = []
    in_denom = False
    remaining = unit_str.strip()
    while remaining:
        match = re.search(r"[/*]", remaining)
        if match is None:
            chunk, op, remaining = remaining, None, ""
        else:
            i = match.start()
            chunk, op, remaining = remaining[:i], remaining[i], remaining[i + 1 :]
        chunk = chunk.strip()
        if not chunk:
            if op == "/":
                in_denom = True
            continue
        exp_match = re.match(r"^(.+?)\^([+-]?\d+\.?\d*)$", chunk)
        if exp_match:
            tok_str, tok_exp = exp_match.group(1), float(exp_match.group(2))
        else:
            tok_str, tok_exp = chunk, 1.0
        tokens.append({"str": tok_str, "exp": tok_exp, "in_denom": in_denom})
        if op == "/":
            in_denom = True
    return tokens


def _decompose_token(tok_str: str) -> tuple[NDArray[np.float64], float]:
    if tok_str in _BASE_UNITS:
        dims, to_si = _BASE_UNITS[tok_str]
        return np.array(dims, dtype=float), to_si
    for pfx in _PREFIX_KEYS:
        if len(tok_str) > len(pfx) and tok_str.startswith(pfx):
            rem = tok_str[len(pfx) :]
            if rem in _BASE_UNITS:
                dims, to_si = _BASE_UNITS[rem]
                return np.array(dims, dtype=float), to_si * _PREFIXES[pfx]
    return np.zeros(7), 1.0


def _parse_units(unit_str: str) -> dict[str, Any]:
    dims = np.zeros(7)
    scale = 1.0
    for tok in _tokenize(unit_str):
        base_dims, base_scale = _decompose_token(tok["str"])
        total_scale = base_scale ** tok["exp"]
        if tok["in_denom"]:
            dims = dims - base_dims * tok["exp"]
            scale = scale / total_scale
        else:
            dims = dims + base_dims * tok["exp"]
            scale = scale * total_scale
    return {"dims": dims, "scale": scale, "display": unit_str}


def _identify_temp_unit(unit_str: str) -> str:
    return {"K": "K", "C": "C", "degC": "C", "F": "F", "degF": "F"}.get(unit_str.strip(), "")


def _try_temperature(
    value: NDArray[np.float64], from_p: dict[str, Any], to_p: dict[str, Any],
    from_str: str, to_str: str,
) -> tuple[bool, NDArray[np.float64] | None, float]:
    if not (np.array_equal(from_p["dims"], _TEMP_DIM) and np.array_equal(to_p["dims"], _TEMP_DIM)):
        return False, None, float("nan")
    from_u, to_u = _identify_temp_unit(from_str), _identify_temp_unit(to_str)
    if not from_u or not to_u:
        return False, None, float("nan")
    val_k = {"K": value, "C": value + 273.15, "F": (value - 32) * 5 / 9 + 273.15}[from_u]
    result = {"K": val_k, "C": val_k - 273.15, "F": (val_k - 273.15) * 9 / 5 + 32}[to_u]
    return True, np.asarray(result, dtype=float), float("nan")


def _try_bridge(
    value: NDArray[np.float64], from_p: dict[str, Any], to_p: dict[str, Any]
) -> tuple[bool, NDArray[np.float64] | None, float]:
    c = constants()
    si = value * from_p["scale"]
    hc = c["h"] * c["c"]
    ts = to_p["scale"]
    energy = np.array([1, 2, -2, 0, 0, 0, 0], dtype=float)
    length = np.array([0, 1, 0, 0, 0, 0, 0], dtype=float)
    freq = np.array([0, 0, -1, 0, 0, 0, 0], dtype=float)
    inv_len = np.array([0, -1, 0, 0, 0, 0, 0], dtype=float)
    h_field = np.array([0, -1, 0, 1, 0, 0, 0], dtype=float)
    b_field = np.array([1, 0, -2, -1, 0, 0, 0], dtype=float)
    nan = float("nan")
    fd, td = from_p["dims"], to_p["dims"]

    def done(result_si: NDArray[np.float64]) -> tuple[bool, NDArray[np.float64], float]:
        return True, np.asarray(result_si / ts, dtype=float), nan

    if np.array_equal(fd, energy) and np.array_equal(td, length):
        return done(hc / si)
    if np.array_equal(fd, length) and np.array_equal(td, energy):
        return done(hc / si)
    if np.array_equal(fd, energy) and np.array_equal(td, freq):
        return done(si / c["h"])
    if np.array_equal(fd, freq) and np.array_equal(td, energy):
        return done(si * c["h"])
    if np.array_equal(fd, energy) and np.array_equal(td, inv_len):
        return done(si / hc)
    if np.array_equal(fd, inv_len) and np.array_equal(td, energy):
        return done(si * hc)
    if np.array_equal(fd, h_field) and np.array_equal(td, b_field):
        return done(si * c["mu0"])
    if np.array_equal(fd, b_field) and np.array_equal(td, h_field):
        return done(si / c["mu0"])
    return False, None, nan


def unit_convert(
    value: ArrayLike, from_str: str, to_str: str
) -> tuple[NDArray[np.float64], dict[str, Any]]:
    """Convert ``value`` between unit expressions. Port of calc.unitConvert.

    Returns ``(result, info)`` where ``info`` has ``factor`` (NaN for nonlinear
    temperature/bridge conversions), ``fromParsed``/``toParsed`` (dims + scale),
    and a ``description``. Raises ``ValueError`` on incompatible dimensions.
    """
    val = np.asarray(value, dtype=float)
    from_p = _parse_units(from_str)
    to_p = _parse_units(to_str)

    ok, result, factor = _try_temperature(val, from_p, to_p, from_str, to_str)
    if not ok:
        if np.array_equal(from_p["dims"], to_p["dims"]):
            factor = float(from_p["scale"] / to_p["scale"])
            result = np.asarray(val * factor, dtype=float)
        else:
            ok, result, factor = _try_bridge(val, from_p, to_p)
            if not ok:
                raise ValueError(
                    f"cannot convert from '{from_str}' to '{to_str}': incompatible dimensions"
                )
    assert result is not None
    desc = f"{from_str} -> {to_str}" if np.isnan(factor) else f"1 {from_str} = {factor:g} {to_str}"
    info = {
        "factor": factor,
        "fromParsed": {"dims": from_p["dims"], "scale": from_p["scale"], "display": from_str},
        "toParsed": {"dims": to_p["dims"], "scale": to_p["scale"], "display": to_str},
        "description": desc,
    }
    return result, info
