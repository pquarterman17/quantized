"""General unit-expression converter. Port of calc.unitConvert.

Pure calc layer. Parses compound unit strings (e.g. ``mA/cm^2``, ``uOhm*cm``)
into a 7-D SI dimension vector + scale, then converts by ratio of scales — with
special handling for temperature offsets (K/C/F) and equivalence bridges: the
photon/thermal-energy family (energy↔wavelength/frequency/wavenumber↔K, all
routed through a common energy hub so any pair converts directly) and H↔B
field (via vacuum permeability).
"""

from __future__ import annotations

import math
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
    # Offset temperature SCALES: registered so they parse (dims/scale for the
    # info payload), but a conversion touching one always takes the affine
    # path in `unit_convert` -- never this scale-1.0 ratio (see _offset_scale).
    "C": ((0, 0, 0, 0, 1, 0, 0), 1.0),
    "F": ((0, 0, 0, 0, 1, 0, 0), 1.0),
    "degC": ((0, 0, 0, 0, 1, 0, 0), 1.0),
    "degF": ((0, 0, 0, 0, 1, 0, 0), 1.0),
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
    "arcmin": (_ZERO, float(np.pi / 10800.0)),
    "arcsec": (_ZERO, float(np.pi / 648000.0)),
    "ions": (_ZERO, 1.0),
    "counts": (_ZERO, 1.0),
    "sq": (_ZERO, 1.0),
    # Imperial / mixed length (m, cm, mm, um, nm, pm, km, Ang all reach via
    # the SI-prefix + "m" mechanism below; these three don't have an SI prefix
    # form so they're explicit).
    "in": ((0, 1, 0, 0, 0, 0, 0), 0.0254),
    "ft": ((0, 1, 0, 0, 0, 0, 0), 0.3048),
    "mil": ((0, 1, 0, 0, 0, 0, 0), 2.54e-5),  # thou = 0.001 in
    # Mass.
    "lb": ((1, 0, 0, 0, 0, 0, 0), 0.45359237),
    # Time: "h" alias for hour (kept alongside the pre-existing "hr").
    "h": ((0, 0, 1, 0, 0, 0, 0), 3600.0),
    # Energy: watt-hour (kWh reaches via the "k" prefix), Rydberg, Hartree
    # (CODATA 2018 exact-defined-constant-derived values, J).
    "Wh": ((1, 2, -2, 0, 0, 0, 0), 3600.0),
    "Ry": ((1, 2, -2, 0, 0, 0, 0), 2.1798723611035e-18),
    "Ha": ((1, 2, -2, 0, 0, 0, 0), 4.3597447222071e-18),
    # Volume: liter (mL reaches via the "m" prefix).
    "L": ((0, 3, 0, 0, 0, 0, 0), 1e-3),
    # Frequency: revolutions per minute (1 rpm = 1/60 Hz; a revolution is a
    # dimensionless count, same convention as Hz's implicit "per cycle").
    "rpm": ((0, 0, -1, 0, 0, 0, 0), 1.0 / 60.0),
}

_PREFIXES: dict[str, float] = {
    "Y": 1e24, "Z": 1e21, "E": 1e18, "P": 1e15, "T": 1e12, "G": 1e9, "M": 1e6,
    "k": 1e3, "h": 1e2, "da": 1e1, "d": 1e-1, "c": 1e-2, "m": 1e-3, "u": 1e-6,
    "mu": 1e-6, "micro": 1e-6, "n": 1e-9, "p": 1e-12, "f": 1e-15, "a": 1e-18,
}
# Longest prefix first (ties don't matter — each first char maps uniquely).
_PREFIX_KEYS = sorted(_PREFIXES, key=len, reverse=True)

_TEMP_DIM = np.array([0, 0, 0, 0, 1, 0, 0], dtype=float)


_DIGITS = frozenset("0123456789")


def _parse_exponent(s: str) -> float | None:
    r"""Parse a unit exponent of the form ``[+-]?\d+\.?\d*`` (e.g. ``2``, ``-3``,
    ``2.5``, ``2.``) without a regular expression.

    The previous ``re.match(r"^(.+?)\^([+-]?\d+\.?\d*)$", chunk)`` was a
    polynomial-ReDoS sink: the lazy ``.+?`` and the two unbounded digit runs let
    an adversarial unit string (``"a^9" + "99"*n``) force O(n²) backtracking. A
    single linear scan removes the sink while keeping identical accept/reject
    semantics. Returns the float value, or ``None`` if ``s`` is not a valid
    exponent (so the caller treats the chunk as having an implicit exponent 1)."""
    body = s[1:] if s[:1] in "+-" else s
    if not body or body[0] == "." or body.count(".") > 1:
        return None  # need ≥1 leading digit and at most one decimal point
    if any(c not in _DIGITS and c != "." for c in body):
        return None
    return float(s)


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
        # First '^' splits base from exponent (mirrors the old lazy ``.+?\^``).
        caret = chunk.find("^")
        exp_val = _parse_exponent(chunk[caret + 1 :]) if caret > 0 else None
        if exp_val is not None:
            tok_str, tok_exp = chunk[:caret], exp_val
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
    # A bare numeric literal (e.g. the "1" in "1/cm") is a dimensionless scale
    # factor, not a unit -- keep accepting it silently.
    try:
        return np.zeros(7), float(tok_str)
    except ValueError:
        pass
    raise ValueError(f"unknown unit {tok_str!r}")


def _parse_units(unit_str: str) -> dict[str, Any]:
    dims = np.zeros(7)
    scale = 1.0
    for tok in _tokenize(unit_str):
        base_dims, base_scale = _decompose_token(tok["str"])
        try:
            total_scale = base_scale ** tok["exp"]
        except OverflowError as exc:
            raise ValueError(f"unit exponent too large in {unit_str!r}") from exc
        if total_scale == 0.0:
            # A zero-scale token would divide-by-zero downstream -- both when it
            # sits in a denominator (the `scale / total_scale` below) and, even
            # if not, when it later becomes a same-dimension conversion factor's
            # denominator in `unit_convert`. Two ways to get here: a bare
            # numeric-literal token of "0" itself (`base_scale == 0.0`, e.g. the
            # nonsensical "0" or "m/0"), or a huge negative exponent underflowing
            # a genuine unit's scale to exactly 0.0. Reject both instead of
            # crashing with an uncaught ZeroDivisionError.
            if base_scale == 0.0:
                raise ValueError(f"unit token in {unit_str!r} scales to zero (not a valid unit)")
            raise ValueError(f"unit exponent underflows the scale to zero in {unit_str!r}")
        if tok["in_denom"]:
            dims = dims - base_dims * tok["exp"]
            scale = scale / total_scale
        else:
            dims = dims + base_dims * tok["exp"]
            scale = scale * total_scale
    return {"dims": dims, "scale": scale, "display": unit_str}


_OFFSET_SCALES = {"C": "C", "degC": "C", "F": "F", "degF": "F"}


def _is_offset_token(name: str) -> bool:
    """A token naming an offset scale, bare or SI-prefixed (``C``, ``mC``, ``pF``)."""
    if name in _OFFSET_SCALES:
        return True
    return name not in _BASE_UNITS and any(
        name.startswith(p) and name[len(p) :] in _OFFSET_SCALES for p in _PREFIX_KEYS
    )


def _offset_scale(unit_str: str) -> str:
    """``"C"``/``"F"`` when ``unit_str`` is exactly one offset temperature scale
    (C, degC, F, degF), ``""`` when it contains none. An offset scale is an
    ABSOLUTE temperature with a zero offset, so it has no meaning prefixed or
    inside a compound expression (``C/min``, ``J/C``, ``mC``): refuse those
    rather than silently treating the scale as a linear alias of K."""
    toks = _tokenize(unit_str)
    if len(toks) == 1:
        tok = toks[0]
        if tok["str"] in _OFFSET_SCALES and tok["exp"] == 1.0 and not tok["in_denom"]:
            return _OFFSET_SCALES[tok["str"]]
    if any(_is_offset_token(t["str"]) for t in toks):
        raise ValueError(
            f"'{unit_str}': C/F are offset temperature scales and cannot be prefixed or "
            "combined with other units; use K (e.g. 'K/min'); farad is 'F_cap'"
        )
    return ""


def _to_kelvin(value: NDArray[np.float64], scale: str) -> NDArray[np.float64]:
    k = value + 273.15 if scale == "C" else (value - 32) * 5 / 9 + 273.15
    return np.asarray(k, dtype=float)


def _from_kelvin(val_k: NDArray[np.float64], scale: str) -> NDArray[np.float64]:
    out = val_k - 273.15 if scale == "C" else (val_k - 273.15) * 9 / 5 + 32
    return np.asarray(out, dtype=float)


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

    if np.array_equal(fd, h_field) and np.array_equal(td, b_field):
        return done(si * c["mu0"])
    if np.array_equal(fd, b_field) and np.array_equal(td, h_field):
        return done(si / c["mu0"])

    # Photon/thermal-energy family: energy <-> wavelength/wavenumber/frequency
    # /temperature, all routed through a common energy (J) hub -- so e.g.
    # nm <-> K or nm <-> cm^-1 work directly, not just energy <-> X. Every
    # member is physically >= 0, and wavelength additionally sits on a true
    # reciprocal (E=hc/lambda), so a non-positive input is rejected up front
    # rather than silently producing +/-inf.
    def to_energy_si(
        v: NDArray[np.float64], dims: NDArray[np.float64]
    ) -> NDArray[np.float64] | None:
        if np.array_equal(dims, energy):
            return v
        if np.array_equal(dims, length):
            return np.asarray(hc / v, dtype=float)
        if np.array_equal(dims, freq):
            return np.asarray(v * c["h"], dtype=float)
        if np.array_equal(dims, inv_len):
            return np.asarray(v * hc, dtype=float)
        if np.array_equal(dims, _TEMP_DIM):
            return np.asarray(v * c["kB"], dtype=float)
        return None

    def from_energy_si(
        e: NDArray[np.float64], dims: NDArray[np.float64]
    ) -> NDArray[np.float64] | None:
        if np.array_equal(dims, energy):
            return e
        if np.array_equal(dims, length):
            return np.asarray(hc / e, dtype=float)
        if np.array_equal(dims, freq):
            return np.asarray(e / c["h"], dtype=float)
        if np.array_equal(dims, inv_len):
            return np.asarray(e / hc, dtype=float)
        if np.array_equal(dims, _TEMP_DIM):
            return np.asarray(e / c["kB"], dtype=float)
        return None

    photon_dims = (energy, length, freq, inv_len, _TEMP_DIM)
    fd_in_family = any(np.array_equal(fd, d) for d in photon_dims)
    td_in_family = any(np.array_equal(td, d) for d in photon_dims)
    if fd_in_family and td_in_family:
        if np.any(si <= 0):
            raise ValueError("photon/thermal energy conversions require a positive value")
        e_si = to_energy_si(si, fd)
        assert e_si is not None  # fd_in_family guarantees a match
        result_si = from_energy_si(e_si, td)
        assert result_si is not None  # td_in_family guarantees a match
        return done(result_si)

    return False, None, nan


# --- LaTeX rendering (the scalar result's "copy LaTeX" form) -----------------
# Everything is emitted in MATH mode -- upright unit names via \mathrm, braced
# exponents, \cdot products -- because `^` and `\cdot` are math-only and fail
# to compile inside \text{} (pdflatex "Missing $", KaTeX parse error). The
# output is pure ASCII, so it also compiles without inputenc. This is a
# Python-side presentation helper, not a golden-verified MATLAB parity output.
_LATEX_BASE: dict[str, str] = {
    "Ang": r"\mathring{A}",
    "angstrom": r"\mathring{A}",
    "Ohm": r"\Omega",
    "ohm": r"\Omega",
    "deg": r"{}^{\circ}",
    "C": r"{}^{\circ}\mathrm{C}",  # the registry's "C" is degrees Celsius
    "F": r"{}^{\circ}\mathrm{F}",  # ... and "F" Fahrenheit (farad is "F_cap")
    "degC": r"{}^{\circ}\mathrm{C}",
    "degF": r"{}^{\circ}\mathrm{F}",
    "F_cap": r"\mathrm{F}",
    "Coul": r"\mathrm{C}",
}
_LATEX_PREFIX: dict[str, str] = {"u": r"\mu", "mu": r"\mu", "micro": r"\mu"}


def _latex_base(name: str) -> str:
    return _LATEX_BASE.get(name, rf"\mathrm{{{name}}}")


def _latex_token(name: str) -> str:
    """One unit token (no exponent) as math-mode LaTeX, splitting an SI prefix
    exactly the way ``_decompose_token`` resolves it."""
    if name in _BASE_UNITS:
        return _latex_base(name)
    for pfx in _PREFIX_KEYS:
        base = name[len(pfx) :]
        if len(name) > len(pfx) and name.startswith(pfx) and base in _BASE_UNITS:
            if pfx not in _LATEX_PREFIX and base not in _LATEX_BASE:
                return rf"\mathrm{{{name}}}"  # e.g. mA, cm, kOe: one upright group
            return _LATEX_PREFIX.get(pfx, rf"\mathrm{{{pfx}}}") + _latex_base(base)
    return name  # a bare numeric literal (the "1" in "1/cm")


def _latex_units(unit_str: str) -> str:
    """Render a unit expression as ``num/den`` in math mode with the parser's
    semantics: everything after the first ``/`` is denominator, so ``J/mol*K``
    renders as ``J/(mol.K)``. A bare reciprocal (``1/cm``) becomes ``cm^{-1}``."""

    def power(tex: str, exp: float) -> str:
        return tex if exp == 1.0 else f"{tex}^{{{exp:g}}}"

    toks = _tokenize(unit_str)
    num = [power(_latex_token(t["str"]), float(t["exp"])) for t in toks if not t["in_denom"]]
    den = [(_latex_token(t["str"]), float(t["exp"])) for t in toks if t["in_denom"]]
    if den and num in ([], ["1"]):
        return r"\cdot ".join(power(tex, -exp) for tex, exp in den)
    out = r"\cdot ".join(num) or "1"
    if den:
        joined = r"\cdot ".join(power(tex, exp) for tex, exp in den)
        out += "/" + (f"({joined})" if len(den) > 1 else joined)
    return out


def _latex_number(x: float) -> str:
    r"""Full precision -- the shortest round-trip repr, the same digits as the
    frontend copy-value path's ``String(x)`` -- with ``e±NN`` written as
    ``\times 10^{NN}`` and a trailing ``.0`` trimmed."""
    if math.isnan(x):
        return r"\mathrm{NaN}"
    if math.isinf(x):
        return r"-\infty" if x < 0 else r"\infty"
    mant, _, exp = repr(x).partition("e")
    if mant.endswith(".0"):
        mant = mant[:-2]
    if not exp:
        return mant
    power = str(int(exp))
    if mant in ("1", "-1"):
        return f"{mant[:-1]}10^{{{power}}}"
    return rf"{mant}\times 10^{{{power}}}"


def unit_convert(
    value: ArrayLike, from_str: str, to_str: str
) -> tuple[NDArray[np.float64], dict[str, Any]]:
    """Convert ``value`` between unit expressions. Port of calc.unitConvert.

    Returns ``(result, info)`` where ``info`` has ``factor`` (NaN for nonlinear
    temperature/bridge conversions), ``fromParsed``/``toParsed`` (dims + scale),
    and a ``description``. Raises ``ValueError`` on incompatible dimensions.
    """
    val = np.asarray(value, dtype=float)
    from_off, to_off = _offset_scale(from_str), _offset_scale(to_str)
    from_p = _parse_units(from_str)
    to_p = _parse_units(to_str)

    def linear_or_bridge(
        v: NDArray[np.float64], fp: dict[str, Any], tp: dict[str, Any]
    ) -> tuple[NDArray[np.float64], float]:
        if np.array_equal(fp["dims"], tp["dims"]):
            f = float(fp["scale"] / tp["scale"])
            return np.asarray(v * f, dtype=float), f
        ok, out, f = _try_bridge(v, fp, tp)
        if not ok or out is None:
            raise ValueError(
                f"cannot convert from '{from_str}' to '{to_str}': incompatible dimensions"
            )
        return out, f

    if from_off or to_off:
        # Affine: pivot through ABSOLUTE kelvin, so 25 C -> mK is 298150 and
        # 25 C -> eV is kB*298.15 K -- never 25 K. Any K-side conversion
        # (prefixed K, the photon/thermal bridge) runs on the kelvin value.
        kelvin = _parse_units("K")
        val_k = _to_kelvin(val, from_off) if from_off else linear_or_bridge(val, from_p, kelvin)[0]
        result = _from_kelvin(val_k, to_off) if to_off else linear_or_bridge(val_k, kelvin, to_p)[0]
        factor = float("nan")
    else:
        result, factor = linear_or_bridge(val, from_p, to_p)
    desc = f"{from_str} -> {to_str}" if np.isnan(factor) else f"1 {from_str} = {factor:g} {to_str}"
    latex = ""
    if val.size == 1 and result.size == 1:
        latex = (
            f"${_latex_number(float(val.reshape(-1)[0]))}\\,{_latex_units(from_str)} = "
            f"{_latex_number(float(result.reshape(-1)[0]))}\\,{_latex_units(to_str)}$"
        )
    info = {
        "factor": factor,
        "fromParsed": {"dims": from_p["dims"], "scale": from_p["scale"], "display": from_str},
        "toParsed": {"dims": to_p["dims"], "scale": to_p["scale"], "display": to_str},
        "description": desc,
        "latex": latex,
    }
    return result, info
