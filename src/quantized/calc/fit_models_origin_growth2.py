"""More Origin built-in **Growth/Sigmoidal** functions (category "Growth/Sigmoidal").

Pure calc layer, imported for its registration side effects. Names, parameter
order and default bounds follow the Origin installation's function library;
only formulas and parameter names are recorded. Declared with
``fit_models_origin_dsl.define``.

Notes
-----
* ``Biphasic``, ``BiDoseResp`` and ``DoubleBoltzmann`` are two-step sigmoids;
  their x axis is log10(dose) for the first two.
* ``SRichards1`` is undefined at ``d == 1`` (NaN there, a limit of the
  family: the Gompertz curve); the branch is picked by the sign of ``d - 1``.
* ``Freundlich3PMod`` is in the power module; the Origin naming quirk of a
  function whose parameter list and formula disagree is noted there.
"""

from __future__ import annotations

import numpy as np

from .fit_models_origin_dsl import define

GROWTH = "Growth/Sigmoidal"
E = np.exp

define("ExpGrowth", GROWTH, "x0,k", lambda x, x0, k: E(k * (x - x0)),
       kinds="x0=xe k=kp", lb={"k": 0.0})
define("TimePow", GROWTH, "a,b", lambda x, a, b: a * x**b, lin="a", kinds="b=e", positive_x=True)
define("MnMolecular", GROWTH, "A,xc,k", lambda x, A, xc, k: A * (1 - E(-k * (x - xc))),
       lin="A", kinds="xc=xe k=k", lb={"A": 0.0})
define("MnMolecular1", GROWTH, "A1,A2,k", lambda x, A1, A2, k: A1 - A2 * E(-k * x),
       lin="A1,A2", kinds="k=k", lb={"A1": 0.0, "A2": 0.0})
define("Asymptotic1", GROWTH, "a,b,c", lambda x, a, b, c: a - b * c**x, lin="a,b", kinds="c=base")
define("Asymptotic2", GROWTH, "a,b,k", lambda x, a, b, k: a - b * E(-k * x),
       lin="a,b", kinds="k=k")
define("Asymptotic3", GROWTH, "a,xc,k", lambda x, a, xc, k: a * (1 - E(-k * (x - xc))),
       lin="a", kinds="xc=xe k=k")
define("Asymptotic4", GROWTH, "a,b,I", lambda x, a, b, i: a + (i - a) * b**x,
       lin="a,I", kinds="b=base")
define("Asymptotic5", GROWTH, "a,I,k", lambda x, a, i, k: a + (i - a) * E(-k * x),
       lin="a,I", kinds="k=k")
define("Asymptotic6", GROWTH, "a,b,k", lambda x, a, b, k: a - E(-(b + k * x)),
       lin="a", kinds="b=lny k=k")
define("Asymptotic7", GROWTH, "I,b,k", lambda x, i, b, k: i + b * (1 - E(-k * x)),
       lin="I,b", kinds="k=k")
define("SLogistic2", GROWTH, "y0,a,Wmax",
       lambda x, y0, a, w: a / (1 + ((a - y0) / y0) * E(-4 * w * x / a)),
       kinds="y0=ysc a=ysc Wmax=slope", lb={"y0": 0.0, "a": 0.0, "Wmax": 0.0})
define("SLogistic3", GROWTH, "a,b,k", lambda x, a, b, k: a / (1 + b * E(-k * x)),
       lin="a", kinds="b=bp k=kp", lb={"a": 0.0, "b": 0.0, "k": 0.0})
define("SLogistic4", GROWTH, "a,b,xc,k",
       lambda x, a, b, xc, k: b + (a - b) / (1 + E(-k * (x - xc))),
       lin="a,b", kinds="xc=x k=k", lb={"a": 0.0, "b": 0.0, "xc": 0.0})
define("SWeibull2", GROWTH, "a,b,d,k",
       lambda x, a, b, d, k: a - (a - b) * E(-((k * x) ** d)),
       lin="a,b", kinds="d=ep k=kp", lb={"a": 0.0, "b": 0.0, "k": 0.0}, positive_x=True)


def _srichards1(x, a, xc, d, k):  # type: ignore[no-untyped-def]
    ex = E(-k * (x - xc))
    inner = np.where(d < 1, a ** (1 - d) - ex, a ** (1 - d) + ex)
    return np.where(d == 1, np.nan, inner ** (1 / (1 - d)))


define("SRichards1", GROWTH, "a,xc,d,k", _srichards1, kinds="a=ysc xc=x d=e k=kp",
       lb={"a": 0.0, "k": 0.0})
define("SRichards2", GROWTH, "a,xc,d,k",
       lambda x, a, xc, d, k: a * (1 + (d - 1) * E(-k * (x - xc))) ** (1 / (1 - d)),
       lin="a", kinds="xc=x d=e k=kp", lb={"a": 0.0, "k": 0.0})
define("Richards", GROWTH, "a,l,k,d",
       lambda x, a, lo, k, d: a * (1 + E(-(lo + k * x) / d)) ** d,
       lin="a", kinds="l=o k=k d=e")


def _mwchang(x, vmax, k1, k2, big_l, q):  # type: ignore[no-untyped-def]
    l1 = (big_l * (1 + k1 * x) / (1 + k2 * x)) ** q
    return vmax * (k1 * x / (1 + k1 * x) + l1 * k2 * x / (1 + k2 * x)) / (l1 + 1)


define("MWChang", GROWTH, "Vmax,k1,k2,L,q", _mwchang, lin="Vmax", kinds="k1=kp k2=kp L=bp q=ep",
       positive_x=True)
define("DoubleBoltzmann", GROWTH, "y0,A,frac,x01,x02,k1,k2",
       lambda x, y0, a, frac, x01, x02, k1, k2:
       y0 + a * (frac / (1 + E((x - x01) / k1)) + (1 - frac) / (1 + E((x - x02) / k2))),
       lin="y0,A", kinds="frac=u3 x01=x5 x02=x5 k1=w4 k2=w4", lb={"frac": 0.0}, ub={"frac": 1.0},
       p0={"frac": 0.5}, polish=False)
define("Biphasic", GROWTH, "Amin,Amax1,Amax2,x0_1,x0_2,h1,h2",
       lambda x, amin, a1, a2, x1, x2, h1, h2:
       amin + (a1 - amin) / (1 + 10 ** ((x - x1) * h1)) + (a2 - amin) / (1 + 10 ** ((x2 - x) * h2)),
       lin="Amin,Amax1,Amax2", kinds="x0_1=x5 x0_2=x5 h1=kp4 h2=kp4")
define("BiDoseResp", GROWTH, "A1,A2,LOGx01,LOGx02,h1,h2,p",
       lambda x, a1, a2, c1, c2, h1, h2, p:
       a1 + (a2 - a1) * p / (1 + 10 ** ((c1 - x) * h1))
       + (a2 - a1) * (1 - p) / (1 + 10 ** ((c2 - x) * h2)),
       lin="A1,A2", kinds="LOGx01=x5 LOGx02=x5 h1=kp4 h2=kp4 p=u3")
