"""Complex numbers inside a headless worksheet formula: the vectorised twin of
``frontend/src/lib/formulaComplex.ts`` (plans/COMPLEX_FORMULA_CONTRACT.md C1-C6).

A value is a real float vector or a :class:`Cx` (two float vectors), and only
exists while the expression is evaluated (C1): the formula's last step turns it
back into one real number per row. Where a complex value comes from is exactly
``complex(re, im)``, ``polar(r, theta)`` and an imaginary literal such as
``2i`` (C2); arithmetic is real unless an operand is a ``Cx`` and a function
with a complex form uses it only for a ``Cx`` argument, so ``sqrt(-1)`` stays
NaN (C3). ``column_formula`` compiles an expression through this module only
when it contains one of those sources: every real formula keeps its result bit
for bit.

The app throws per row (a real-only function given ``1 + 2i``, ``//`` or ``%``
on a complex value) and blanks THAT cell; here the row is NaN as well. A
complex RESULT on any row (C6) blanks the whole column, like the app. Neither
raises: the script computes the column the app showed.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray

__all__ = ["SOURCES", "Cx", "ComplexOps", "REAL_PART_FUNCS", "make_ops"]

Vec = NDArray[np.float64]
SOURCES = frozenset({"complex", "polar"})
_BAD = "\0bad"  # rows where the app throws: those cells are NaN
_WHOLE = "\0whole"  # a complex result somewhere (C6): the whole column is NaN
_BIG = 355.0  # past this cosh/sinh of 2x overflow; the ratio has reached its limit


@dataclass(frozen=True)
class Cx:
    """A complex value: the two parts, each a float vector (or 0-d)."""

    re: Vec
    im: Vec


Val = Any  # Vec | Cx
Env = Mapping[str, Any]  # the columns, plus the two private masks of one evaluation


def _f(x: Any) -> Vec:
    return np.asarray(x, dtype=float)


def _re(v: Val) -> Vec:
    return v.re if isinstance(v, Cx) else v


def _im(v: Val) -> Vec:
    return v.im if isinstance(v, Cx) else _f(0.0)


def _cdiv(a: Vec, b: Vec, c: Vec, d: Vec) -> Cx:
    """(a + bi) / (c + di), Smith's method; complex zero is NaN, never inf."""
    with np.errstate(all="ignore"):
        r1 = d / c
        den1 = c + d * r1
        r2 = c / d
        den2 = c * r2 + d
        wide = np.abs(c) >= np.abs(d)
        re = np.where(wide, (a + b * r1) / den1, (a * r2 + b) / den2)
        im = np.where(wide, (b - a * r1) / den1, (b * r2 - a) / den2)
        nul = (c == 0) & (d == 0)
        return Cx(_f(np.where(nul, np.nan, re)), _f(np.where(nul, np.nan, im)))


def _ipow(re: Vec, im: Vec, n: Vec) -> Cx:
    """z^n for a whole |n| <= 64 by repeated squaring (so (1+2i)^2 is exact)."""
    re, im, n = (_f(a).copy() for a in np.broadcast_arrays(re, im, n))
    e = np.abs(np.where(np.isfinite(n), n, 0.0)).astype(np.int64)
    rr, ri, br, bi = np.ones_like(re), np.zeros_like(re), re, im
    with np.errstate(all="ignore"):
        for _ in range(7):
            odd = (e & 1) == 1
            rr, ri = np.where(odd, rr * br - ri * bi, rr), np.where(odd, rr * bi + ri * br, ri)
            br, bi = br * br - bi * bi, 2 * br * bi
            e = e >> 1
    inv = _cdiv(_f(1.0), _f(0.0), rr, ri)
    return Cx(_f(np.where(n < 0, inv.re, rr)), _f(np.where(n < 0, inv.im, ri)))


def _clog(re: Vec, im: Vec) -> Cx:
    """The principal log, with CPython's log1p form near |z| = 1."""
    with np.errstate(all="ignore"):
        h = np.hypot(re, im)
        big = np.maximum(np.abs(re), np.abs(im))
        small = np.minimum(np.abs(re), np.abs(im))
        near = np.log1p((big - 1) * (big + 1) + small * small) / 2
        lr = np.where((h >= 0.71) & (h <= 1.73), near, np.log(h))
        nul = (re == 0) & (im == 0)
        return Cx(_f(np.where(nul, np.nan, lr)), _f(np.where(nul, np.nan, np.arctan2(im, re))))


def _cexp(re: Vec, im: Vec) -> Cx:
    with np.errstate(all="ignore"):
        m = np.exp(re)
        return Cx(_f(m * np.cos(im)), _f(m * np.sin(im)))


def _cpow(a: Val, b: Val) -> Cx:
    ar, ai, br, bi = _re(a), _im(a), _re(b), _im(b)
    with np.errstate(all="ignore"):
        one = (br == 0) & (bi == 0)
        small = (bi == 0) & np.isfinite(br) & (br == np.floor(br)) & (np.abs(br) <= 64)
        zero_base = (ar == 0) & (ai == 0)
        ip = _ipow(ar, ai, _f(np.where(small, br, 0.0)))
        lg = _clog(ar, ai)
        ex = _cexp(br * lg.re - bi * lg.im, bi * lg.re + br * lg.im)
        zb = np.where(br > 0, 0.0, np.nan)
        conds = [one, small, zero_base]
        return Cx(
            _f(np.select(conds, [1.0, ip.re, zb], ex.re)),
            _f(np.select(conds, [0.0, ip.im, zb], ex.im)),
        )


def _csqrt(re: Vec, im: Vec) -> Cx:
    with np.errstate(all="ignore"):
        s = np.sqrt((np.abs(re) + np.hypot(re, im)) / 2)
        pos_re = im / (2 * s)
        neg_re = np.abs(im) / (2 * s)
        neg_im = np.where(np.signbit(im), -s, s)
        nul = (re == 0) & (im == 0)
        out_re = np.where(re >= 0, s, neg_re)
        out_im = np.where(re >= 0, pos_re, neg_im)
        return Cx(_f(np.where(nul, 0.0, out_re)), _f(np.where(nul, im, out_im)))


def _tan(a: Vec, b: Vec) -> Cx:
    with np.errstate(all="ignore"):
        q = _cdiv(np.sin(2 * a), np.sinh(2 * b), np.cos(2 * a) + np.cosh(2 * b), _f(0.0))
        sat = np.abs(b) > _BIG
        return Cx(_f(np.where(sat, 0.0, q.re)), _f(np.where(sat, np.sign(b), q.im)))


def _tanh(a: Vec, b: Vec) -> Cx:
    with np.errstate(all="ignore"):
        q = _cdiv(np.sinh(2 * a), np.sin(2 * b), np.cosh(2 * a) + np.cos(2 * b), _f(0.0))
        sat = np.abs(a) > _BIG
        return Cx(_f(np.where(sat, np.sign(a), q.re)), _f(np.where(sat, 0.0, q.im)))


def _log10(re: Vec, im: Vec) -> Cx:
    lg = _clog(re, im)
    return Cx(_f(lg.re / np.log(10.0)), _f(lg.im / np.log(10.0)))


def _cx(f: Callable[..., Any]) -> Callable[[Vec, Vec], Val]:
    def call(re: Vec, im: Vec) -> Val:
        with np.errstate(all="ignore"):
            return f(re, im)

    return call


# The one-argument functions with a complex form (contract C5), used only for a Cx argument.
_CFN: dict[str, Callable[[Vec, Vec], Val]] = {
    "re": _cx(lambda a, b: a),
    "real": _cx(lambda a, b: a),
    "im": _cx(lambda a, b: b),
    "imag": _cx(lambda a, b: b),
    "abs": _cx(lambda a, b: np.hypot(a, b)),
    "arg": _cx(lambda a, b: np.arctan2(b, a)),
    "angle": _cx(lambda a, b: np.arctan2(b, a)),
    "conj": _cx(lambda a, b: Cx(a, -b)),
    "exp": _cexp,
    "log": _clog,
    "ln": _clog,
    "log10": _log10,
    "sqrt": _csqrt,
    "sin": _cx(lambda a, b: Cx(np.sin(a) * np.cosh(b), np.cos(a) * np.sinh(b))),
    "cos": _cx(lambda a, b: Cx(np.cos(a) * np.cosh(b), -np.sin(a) * np.sinh(b))),
    "sinh": _cx(lambda a, b: Cx(np.sinh(a) * np.cos(b), np.cosh(a) * np.sin(b))),
    "cosh": _cx(lambda a, b: Cx(np.cosh(a) * np.cos(b), np.sinh(a) * np.sin(b))),
    "tan": _tan,
    "tanh": _tanh,
}


def _unary(f: Callable[[Vec], Vec]) -> Callable[..., Vec]:
    def call(*args: Vec) -> Vec:
        if not args:
            return _f(np.nan)
        with np.errstate(all="ignore"):
            return _f(f(args[0]))

    return call


# The part functions of a formula with NO complex value in it (the app's
# REAL_COMPLEX_FUNCS): re(A) is A, im(A) is 0, arg(A) is 0 or pi.
REAL_PART_FUNCS: dict[str, Callable[..., Vec]] = {
    "re": _unary(lambda v: v),
    "real": _unary(lambda v: v),
    "conj": _unary(lambda v: v),
    "im": _unary(lambda v: np.where(np.isnan(v), np.nan, 0.0)),
    "imag": _unary(lambda v: np.where(np.isnan(v), np.nan, 0.0)),
    "arg": _unary(lambda v: np.arctan2(0.0, v)),
    "angle": _unary(lambda v: np.arctan2(0.0, v)),
}


@dataclass(frozen=True)
class ComplexOps:
    """What ``column_formula`` compiles a complex formula with."""

    binop: Callable[[str, Val, Val, Env], Val]
    power: Callable[[Val, Val, Env], Val]
    neg: Callable[[Val], Val]
    imaginary: Callable[[float], Val]
    check_call: Callable[[str, int], None]
    call: Callable[[str, Callable[..., Vec] | None, list[Val], Env], Val]
    finish: Callable[[Callable[[Env], Val]], Callable[[Env], Vec]]
    # The real operators with the same signatures, for a formula with no complex source.
    real_binop: Callable[[str, Val, Val, Env], Val]
    real_power: Callable[[Val, Val, Env], Val]
    real_neg: Callable[[Val], Val]


def make_ops(
    real_binop: Callable[[str, Vec, Vec], Vec],
    real_pow: Callable[[Vec, Vec], Vec],
) -> ComplexOps:
    """The complex operators, built over the real ones (``column_formula``'s
    own, so two real operands compute exactly as in a real formula)."""

    def real_of(v: Val, name: str, env: Env) -> Vec:
        """The real number ``v`` stands for: a blank part is blank, a non-zero
        imaginary part is the app's per-row error (the row is NaN)."""
        if not isinstance(v, Cx):
            return _f(v)
        blank = np.isnan(v.re) | np.isnan(v.im)
        bad = ~blank & (v.im != 0)
        if bad.any():
            env[_BAD][...] |= bad
        return _f(np.where(blank | bad, np.nan, v.re))

    def fail_all(env: Env) -> Vec:
        env[_BAD][...] = True
        return _f(np.nan)

    def binop(op: str, a: Val, b: Val, env: Env) -> Val:
        plain = not isinstance(a, Cx) and not isinstance(b, Cx)
        if plain:
            return real_binop(op, a, b)
        if op in ("//", "%"):
            return fail_all(env)  # real only (C4)
        ar, ai, br, bi = _re(a), _im(a), _re(b), _im(b)
        with np.errstate(all="ignore"):
            if op == "+":
                return Cx(_f(ar + br), _f(ai + bi))
            if op == "-":
                return Cx(_f(ar - br), _f(ai - bi))
            if op == "/":
                return _cdiv(ar, ai, br, bi)
            if not isinstance(a, Cx):
                return Cx(_f(a * br), _f(a * bi))
            if not isinstance(b, Cx):
                return Cx(_f(ar * b), _f(ai * b))
            return Cx(_f(ar * br - ai * bi), _f(ar * bi + ai * br))

    def power(a: Val, b: Val, env: Env) -> Val:
        if not isinstance(a, Cx) and not isinstance(b, Cx):
            return real_pow(a, b)
        return _cpow(a, b)

    def neg(v: Val) -> Val:
        if isinstance(v, Cx):
            return Cx(_f(-v.re), _f(-v.im))
        return _f(-v)

    def check_call(name: str, n_args: int) -> None:
        if name in SOURCES and n_args != 2:
            raise ValueError(f"{name}() takes two arguments")

    def call(
        name: str, fn: Callable[..., Vec] | None, vals: list[Val], env: Env
    ) -> Val:
        if name in SOURCES:
            p, q = real_of(vals[0], name, env), real_of(vals[1], name, env)
            if name == "complex":
                return Cx(_f(p), _f(q))
            with np.errstate(all="ignore"):
                return Cx(_f(p * np.cos(q)), _f(p * np.sin(q)))
        cf = _CFN.get(name)
        if cf is not None and vals and isinstance(vals[0], Cx):
            return cf(vals[0].re, vals[0].im)
        assert fn is not None
        return fn(*[real_of(v, name, env) for v in vals])

    def finish(fn: Callable[[Env], Val]) -> Callable[[Env], Vec]:
        def run(env: Env) -> Vec:
            n = np.shape(env["x"])
            local: dict[str, Any] = {
                **env,
                _BAD: np.zeros(n, dtype=bool),
                _WHOLE: np.zeros((), dtype=bool),
            }
            v = fn(local)
            if isinstance(v, Cx):  # the formula's result must be real (C6)
                blank = np.isnan(v.re) | np.isnan(v.im)
                whole = ~blank & (v.im != 0)
                v = _f(np.where(blank | whole, np.nan, v.re))
                local[_WHOLE] |= whole.any()
            out = np.array(np.broadcast_to(_f(v), n), dtype=float)
            out[local[_BAD].astype(bool)] = np.nan
            if bool(local[_WHOLE]):
                out[...] = np.nan
            return out

        return run

    return ComplexOps(
        binop,
        power,
        neg,
        lambda v: Cx(_f(0.0), _f(v)),
        check_call,
        call,
        finish,
        lambda op, a, b, _env: real_binop(op, a, b),
        lambda a, b, _env: real_pow(a, b),
        lambda v: _f(-v),
    )
