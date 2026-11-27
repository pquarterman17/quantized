"""More Origin built-in **Waveform** functions (category "Waveform").

Pure calc layer, imported for its registration side effects. Names, parameter
order and default bounds follow the Origin installation's function library;
only formulas and parameter names are recorded.

* ``SineSqr``: y0 + A*sin^2(pi*(x - xc)/w); ``w`` is the full period (bound
  w > 0). Its guess scans the period over the strongest Fourier component and
  solves ``const + a*cos + b*sin`` exactly.
* ``SawtoothWave``: y0 + A*((x - x0) mod T)/T, a ramp from y0 to y0 + A that
  resets every ``T``.
* The square waves (SquareWave, SquareWaveMod) are not ported: the first is an
  Origin C routine whose phase convention is not stated in the definition.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray

from .fit_guess_origin_peak import _dominant_period
from .fit_guess_tools import varpro
from .fit_models_origin_dsl import define

FloatArray = NDArray[np.float64]
WAVEFORM = "Waveform"


def _sine_sqr(x, y0, xc, w, a):  # type: ignore[no-untyped-def]
    return y0 + a * np.sin(math.pi * (x - xc) / w) ** 2


def _g_sine_sqr(x: FloatArray, y: FloatArray) -> list[float] | None:
    if x.size < 8 or float(x[-1] - x[0]) <= 0:
        return None
    period = _dominant_period(x, y)

    def design(theta: FloatArray) -> FloatArray | None:
        om = 2 * math.pi / math.exp(float(theta[0]))
        return np.column_stack([np.ones_like(x), np.cos(om * x), np.sin(om * x)])

    out = varpro(design, y, [[math.log(period * f)] for f in np.geomspace(0.8, 1.25, 11)])
    if out is None:
        return None
    theta, (c, a, b) = out
    w = math.exp(float(theta[0]))
    om = 2 * math.pi / w
    r, phi = math.hypot(a, b), math.atan2(b, a)  # c + r*cos(om*x - phi)
    # y0 + A/2 - (A/2) cos(om (x - xc)), with A = 2r: phase  phi = om*xc - pi.
    return [float(c - r), float((phi + math.pi) / om), w, float(2 * r)]


define("SineSqr", WAVEFORM, "y0,xc,w,A", _sine_sqr, lb={"w": 0.0}, guess=_g_sine_sqr)
define("SawtoothWave", WAVEFORM, "x0,y0,A,T",
       lambda x, x0, y0, a, t: y0 + a / t * (x - np.floor((x - x0) / t) * t - x0),
       lin="y0,A", kinds="x0=x T=per")
