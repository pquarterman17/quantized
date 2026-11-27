"""Origin built-in **Hyperbola**, **Logarithm**, **Rational** and extra
**Polynomial** functions.

Pure calc layer, imported for its registration side effects. Names, parameter
order and default bounds follow the Origin installation's function library
(none of these carry default bounds); only formulas and parameter names are
recorded. Declared with ``fit_models_origin_dsl.define``.

Notes
-----
* Origin's ``Cubic`` (A + Bx + Cx^2 + Dx^3, ascending) differs from quantized's
  MATLAB-parity ``Cubic`` (descending a, b, c, d), so it is registered as
  ``Cubic (Origin)``; ``Poly4`` and the others have no clash.
* Rational and reciprocal forms get an equation-error (linearised least
  squares) start, e.g. ``y*(1 + a*x) = b + c*x`` is linear in ``a, b, c``; the
  fit then refines it on the true residuals.
* ``Freundlich``-style power laws live in ``fit_models_origin_power``.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from .fit_models_origin_dsl import define

FloatArray = NDArray[np.float64]
HYPERBOLA, LOGARITHM, RATIONAL, POLYNOMIAL = "Hyperbola", "Logarithm", "Rational", "Polynomial"
LN = np.log


def _solve(cols: list[FloatArray], rhs: FloatArray) -> list[float] | None:
    a = np.column_stack(cols)
    if not (np.all(np.isfinite(a)) and np.all(np.isfinite(rhs))):
        return None
    coef, *_ = np.linalg.lstsq(a, rhs, rcond=None)
    return [float(v) for v in coef]


def _nonzero(x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
    ok = np.abs(y) > 1e-12 * max(float(np.max(np.abs(y))), 1e-300)
    return x[ok], y[ok]


# ── equation-error guesses ──────────────────────────────────────────────
def _g_rational1(x: FloatArray, y: FloatArray) -> list[float] | None:
    # y*(a + b*x) = 1 + c*x  ->  [y, x*y, -x] . [a, b, c] = 1
    return _solve([y, x * y, -x], np.ones_like(x))


def _g_rational3(x: FloatArray, y: FloatArray) -> list[float] | None:
    # y*(a + c*x) = b + x  ->  [y, x*y, -1] . [a, c, b] = x
    r = _solve([y, x * y, -np.ones_like(x)], x)
    return None if r is None else [r[0], r[2], r[1]]


def _g_rational5(x: FloatArray, y: FloatArray) -> list[float] | None:
    # y*(1 + c*x + d*x^2) = a + b*x  ->  [1, x, -x*y, -x^2*y] . [a, b, c, d] = y
    return _solve([np.ones_like(x), x, -x * y, -(x**2) * y], y)


def _g_holliday(x: FloatArray, y: FloatArray) -> list[float] | None:
    xs, ys = _nonzero(x, y)  # 1/y = a + b*x + c*x^2
    return _solve([np.ones_like(xs), xs, xs**2], 1.0 / ys) if xs.size > 3 else None


def _g_holliday1(x: FloatArray, y: FloatArray) -> list[float] | None:
    # y*(1 + b*x + c*x^2) = a  ->  [1, -x*y, -x^2*y] . [a, b, c] = y
    return _solve([np.ones_like(x), -x * y, -(x**2) * y], y)


def _g_reciprocal(x: FloatArray, y: FloatArray) -> list[float] | None:
    xs, ys = _nonzero(x, y)  # 1/y = a + b*x
    return _solve([np.ones_like(xs), xs], 1.0 / ys) if xs.size > 2 else None


def _g_betmod(x: FloatArray, y: FloatArray) -> list[float] | None:
    # x/y = a*(1 - x^2) + b*(x - x^2)
    xs, ys = _nonzero(x, y)
    return _solve([1 - xs**2, xs - xs**2], xs / ys) if xs.size > 2 else None


def _g_gunary(x: FloatArray, y: FloatArray) -> list[float] | None:
    keep = x > 0  # x/y = a + b*x + c*sqrt(x)
    xs, ys = _nonzero(x[keep], y[keep])
    return _solve([np.ones_like(xs), xs, np.sqrt(xs)], xs / ys) if xs.size > 3 else None


def _g_hyperbola_mod(x: FloatArray, y: FloatArray) -> list[float] | None:
    xs, ys = _nonzero(x, y)  # x/y = T1*x + T2
    return _solve([xs, np.ones_like(xs)], xs / ys) if xs.size > 2 else None


def _g_nelder(x: FloatArray, y: FloatArray) -> list[float] | None:
    """(x + a)/(b0 + b1 (x+a) + b2 (x+a)^2): scan a, regress u/y on 1, u, u^2."""
    span = float(x[-1] - x[0])
    best: tuple[float, list[float]] | None = None
    for a in [float(-x[0] + v) for v in np.geomspace(span / 100, 5 * span, 12)]:
        u = x + a
        ok = np.abs(y) > 1e-12 * float(np.max(np.abs(y)))
        coef = _solve([np.ones(int(ok.sum())), u[ok], u[ok] ** 2], u[ok] / y[ok])
        if coef is None:
            continue
        with np.errstate(all="ignore"):
            pred = u / (coef[0] + coef[1] * u + coef[2] * u**2)
        ssr = float(np.sum((pred - y) ** 2))
        if np.isfinite(ssr) and (best is None or ssr < best[0]):
            best = (ssr, [a, *coef])
    return None if best is None else best[1]


def _g_linemod(x: FloatArray, y: FloatArray) -> list[float] | None:
    slope, icpt = np.polyfit(x, y, 1)  # y = a*(x - b) = a*x - a*b
    return None if slope == 0 else [float(slope), float(-icpt / slope)]


def _g_log2p2(x: FloatArray, y: FloatArray) -> list[float] | None:
    return _solve([np.ones_like(x), x], np.exp(y))  # exp(y) = a + b*x


# ── Hyperbola ───────────────────────────────────────────────────────────
define("Hyperbl", HYPERBOLA, "P1,P2", lambda x, p1, p2: p1 * x / (p2 + x), lin="P1", kinds="P2=w")
define("RectHyperbola", HYPERBOLA, "a,b", lambda x, a, b: a * b * x / (1 + b * x),
       lin="a", kinds="b=k")
define("Dhyperbl", HYPERBOLA, "P1,P2,P3,P4,P5",
       lambda x, p1, p2, p3, p4, p5: p1 * x / (p2 + x) + p3 * x / (p4 + x) + p5 * x,
       lin="P1,P3,P5", kinds="P2=w P4=w")
define("HyperbolaGen", HYPERBOLA, "a,b,c,d", lambda x, a, b, c, d: a - b / (1 + c * x) ** (1 / d),
       lin="a,b", kinds="c=kp d=ep")
define("HyperbolaMod", HYPERBOLA, "T1,T2", lambda x, t1, t2: x / (t1 * x + t2),
       guess=_g_hyperbola_mod)
define("BentHyperblSmp", HYPERBOLA, "a,b,c,d",
       lambda x, a, b, c, d: a * (1 + b * (x + c) - (1 + (b * (x + c)) ** d) ** (1 / d)),
       lin="a", kinds="b=k c=xe d=ep")

# ── Logarithm ───────────────────────────────────────────────────────────
define("Logarithm", LOGARITHM, "A", lambda x, a: LN(x - a), kinds="A=below")
define("Log2P1", LOGARITHM, "a,b", lambda x, a, b: b * LN(x - a), lin="b", kinds="a=below")
define("Log2P2", LOGARITHM, "a,b", lambda x, a, b: LN(a + b * x), guess=_g_log2p2)
define("Log3P1", LOGARITHM, "a,b,c", lambda x, a, b, c: a - b * LN(x + c),
       lin="a,b", kinds="c=sh")
define("Bradley", LOGARITHM, "a,b", lambda x, a, b: a * LN(-b * LN(x)),
       lin="a", kinds="b=bp", positive_x=True)

# ── Rational ────────────────────────────────────────────────────────────
define("Reciprocal0", RATIONAL, "A", lambda x, a: 1 / (1 + a * x), kinds="A=k")
define("Reciprocal1", RATIONAL, "A", lambda x, a: 1 / (x + a), kinds="A=sh")
define("Reciprocal", RATIONAL, "a,b", lambda x, a, b: 1 / (a + b * x), guess=_g_reciprocal)
define("ReciprocalMod", RATIONAL, "a,b", lambda x, a, b: a / (1 + b * x), lin="a", kinds="b=k")
define("Rational0", RATIONAL, "a,b,c", lambda x, a, b, c: (b + c * x) / (1 + a * x),
       lin="b,c", kinds="a=k")
define("Rational1", RATIONAL, "a,b,c", lambda x, a, b, c: (1 + c * x) / (a + b * x),
       guess=_g_rational1)
define("Rational2", RATIONAL, "a,b,c", lambda x, a, b, c: (b + c * x) / (a + x),
       lin="b,c", kinds="a=sh")
define("Rational3", RATIONAL, "a,b,c", lambda x, a, b, c: (b + x) / (a + c * x),
       guess=_g_rational3)
define("Rational4", RATIONAL, "a,b,c", lambda x, a, b, c: c + b / (x + a), lin="b,c", kinds="a=sh")
define("Rational5", RATIONAL, "a,b,c,d",
       lambda x, a, b, c, d: (a + b * x) / (1 + c * x + d * x**2), guess=_g_rational5)
define("Holliday", RATIONAL, "a,b,c", lambda x, a, b, c: 1 / (a + b * x + c * x**2),
       guess=_g_holliday)
define("Holliday1", RATIONAL, "a,b,c", lambda x, a, b, c: a / (1 + b * x + c * x**2),
       guess=_g_holliday1)
define("Nelder", RATIONAL, "a,b0,b1,b2",
       lambda x, a, b0, b1, b2: (x + a) / (b0 + b1 * (x + a) + b2 * (x + a) ** 2),
       guess=_g_nelder)
define("BET", RATIONAL, "a,b", lambda x, a, b: a * b * x / (1 + (b - 2) * x - (b - 1) * x**2),
       lin="a", kinds="b=bp", positive_x=True)
define("BETMod", RATIONAL, "a,b", lambda x, a, b: x / (a + b * x - (a + b) * x**2),
       guess=_g_betmod)

# ── Polynomial extras ───────────────────────────────────────────────────
define("Constant", POLYNOMIAL, "y0", lambda x, y0: y0 + 0 * x, lin="y0")
define("Line", POLYNOMIAL, "A,B", lambda x, a, b: a + b * x, lin="A,B")
define("LineMod", POLYNOMIAL, "a,b", lambda x, a, b: a * (x - b), guess=_g_linemod)
define("Parabola", POLYNOMIAL, "A,B,C", lambda x, a, b, c: a + b * x + c * x**2, lin="A,B,C")
define("Cubic (Origin)", POLYNOMIAL, "A,B,C,D",
       lambda x, a, b, c, d: a + b * x + c * x**2 + d * x**3, lin="A,B,C,D")
define("Poly4", POLYNOMIAL, "A0,A1,A2,A3,A4",
       lambda x, a0, a1, a2, a3, a4: a0 + a1 * x + a2 * x**2 + a3 * x**3 + a4 * x**4,
       lin="A0,A1,A2,A3,A4")
define("PolyCtr5", POLYNOMIAL, "y0,x0,p1,p2,p3,p4,p5",
       lambda x, y0, x0, p1, p2, p3, p4, p5: y0 + p1 * (x - x0) + p2 * (x - x0) ** 2
       + p3 * (x - x0) ** 3 + p4 * (x - x0) ** 4 + p5 * (x - x0) ** 5,
       lin="y0,p1,p2,p3,p4,p5", kinds="x0=xmean")
