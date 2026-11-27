"""More Origin built-in **Exponential** functions (category "Exponential").

Pure calc layer, imported for its registration side effects. Names, parameter
order and default bounds follow the Origin installation's function library;
only formulas and parameter names are recorded here. Declared with
``fit_models_origin_dsl.define`` (see there for the linear/kind annotations
that drive the automatic initial guess).

Notes
-----
* ExpGro3 and ExpGrow live in ``fit_models_origin_exp`` (the n-term family).
* ``x0``-style onsets that only shift an amplitude (``TD`` of ExpAssoc1/2,
  ``TD1`` of ExpAssocDelay*) are not independent of the amplitude; the
  automatic guess holds them at min(x), as for ExpDecay*.
* ExpGrowDec / ExpGrow3Dec2 are the growth-then-decay curves with a switch
  at ``xc``; Pulse / Pulse1 are zero before ``x0``.
"""

from __future__ import annotations

import numpy as np

from .fit_models_origin_dsl import NEW_ORIGIN_MODELS, define

EXPONENTIAL = "Exponential"
E = np.exp
# Declared by the n-term family in fit_models_origin_exp (new in this port).
NEW_ORIGIN_MODELS.extend(("ExpGro3", "ExpGrow"))


# ── one-parameter and two-parameter forms ───────────────────────────────
define("Exp1P1", EXPONENTIAL, "A", lambda x, A: E(x - A), kinds="A=xe")
define("Exp1p2", EXPONENTIAL, "A", lambda x, A: E(-A * x), kinds="A=k")
define("Exp1p2Md", EXPONENTIAL, "B", lambda x, B: B**x, kinds="B=base")
define("Exp1p3", EXPONENTIAL, "A", lambda x, A: A * E(-A * x), kinds="A=kp")
define("Exp1P3Md", EXPONENTIAL, "B", lambda x, B: -np.log(B) * B**x, kinds="B=bl")
define("Exp1P4", EXPONENTIAL, "A", lambda x, A: 1 - E(-A * x), kinds="A=k")
define("Exp1P4Md", EXPONENTIAL, "B", lambda x, B: 1 - B**x, kinds="B=base")
define("Exp2P", EXPONENTIAL, "a,b", lambda x, a, b: a * b**x, lin="a", kinds="b=base")
define("Exp2PMod1", EXPONENTIAL, "a,b", lambda x, a, b: a * E(b * x), lin="a", kinds="b=k")
define("Exp2PMod2", EXPONENTIAL, "a,b", lambda x, a, b: E(a + b * x), kinds="a=lny b=k")
define("Exp3P1", EXPONENTIAL, "a,b,c", lambda x, a, b, c: a * E(b / (x + c)),
       lin="a", kinds="b=ysc c=sh")
define("Exp3P1Md", EXPONENTIAL, "a,b,c", lambda x, a, b, c: E(a + b / (x + c)),
       kinds="a=lny b=ysc c=sh")
define("Exp3P2", EXPONENTIAL, "a,b,c", lambda x, a, b, c: E(a + b * x + c * x**2),
       kinds="a=lny b=k c=k")
define("BoxLucas1", EXPONENTIAL, "a,b", lambda x, a, b: a * (1 - E(-b * x)), lin="a", kinds="b=k")
define("BoxLucas1Mod", EXPONENTIAL, "a,b", lambda x, a, b: a * (1 - b**x), lin="a", kinds="b=base")
define("BoxLucas2", EXPONENTIAL, "a1,a2",
       lambda x, a1, a2: (a1 / (a1 - a2)) * (E(-a2 * x) - E(-a1 * x)), kinds="a1=kp a2=kp")
define("Chapman", EXPONENTIAL, "a,b,c", lambda x, a, b, c: a * (1 - E(-b * x)) ** c,
       lin="a", kinds="b=kp c=ep")
define("Reich", EXPONENTIAL, "a1,b1,a2,b2",
       lambda x, a1, b1, a2, b2: a1 * E(-b1 * x) + a2 * E(-b2 * x),
       lin="a1,a2", kinds="b1=k b2=k")
define("Shah", EXPONENTIAL, "a,b,c,r", lambda x, a, b, c, r: a + b * x + c * r**x,
       lin="a,b,c", kinds="r=bl", lb={"r": 0.0}, ub={"r": 1.0}, p0={"r": 0.5})
define("Stirling", EXPONENTIAL, "a,b,k", lambda x, a, b, k: a + b * (E(k * x) - 1) / k,
       lin="a,b", kinds="k=k")
define("YldFert", EXPONENTIAL, "a,b,r", lambda x, a, b, r: a + b * r**x,
       lin="a,b", kinds="r=bl", lb={"r": 0.0}, ub={"r": 1.0}, p0={"r": 0.5})
define("YldFert1", EXPONENTIAL, "a,b,k", lambda x, a, b, k: a + b * E(-k * x),
       lin="a,b", kinds="k=kp", lb={"k": 0.0})
define("Exponential", EXPONENTIAL, "y0,A,R0", lambda x, y0, A, R0: y0 + A * E(R0 * x),
       lin="y0,A", kinds="R0=k")
define("ExpLinear", EXPONENTIAL, "p1,p2,p3,p4",
       lambda x, p1, p2, p3, p4: p1 * E(-x / p2) + p3 + p4 * x, lin="p1,p3,p4", kinds="p2=w")
define("SingleExp", EXPONENTIAL, "ymax,k", lambda x, ymax, k: ymax * E(-k * x),
       lin="ymax", kinds="k=kp", lb={"k": 0.0})
define("SingleExpOffset", EXPONENTIAL, "ymax,y0,k", lambda x, ymax, y0, k: y0 + ymax * E(-k * x),
       lin="ymax,y0", kinds="k=kp", lb={"k": 0.0})
define("DoubleExp", EXPONENTIAL, "ymax1,k1,ymax2,k2",
       lambda x, a1, k1, a2, k2: a1 * E(-k1 * x) + a2 * E(-k2 * x),
       lin="ymax1,ymax2", kinds="k1=kp k2=kp", lb={"k1": 0.0, "k2": 0.0})
define("DoubleExpOffset", EXPONENTIAL, "y0,ymax1,ymax2,k1,k2",
       lambda x, y0, a1, a2, k1, k2: y0 + a1 * E(-k1 * x) + a2 * E(-k2 * x),
       lin="y0,ymax1,ymax2", kinds="k1=kp k2=kp", lb={"k1": 0.0, "k2": 0.0})
define("FirstOrder", EXPONENTIAL, "lmt,k", lambda x, lmt, k: lmt * (1 - E(-k * x)),
       lin="lmt", kinds="k=kp", lb={"lmt": 0.0, "k": 0.0})
define("FirstOrderOffset", EXPONENTIAL, "lmt,k,offset",
       lambda x, lmt, k, off: lmt * (1 - E(-k * x)) + off,
       lin="lmt,offset", kinds="k=kp", lb={"lmt": 0.0, "k": 0.0, "offset": 0.0})
define("ExponentialCDF", EXPONENTIAL, "y0,A,mu",
       lambda x, y0, A, mu: np.where(x < 0, y0, y0 + A * (1 - E(-x / mu))),
       lin="y0,A", kinds="mu=w", lb={"A": 0.0, "mu": 0.0})
define("Lanczos3", EXPONENTIAL, "b1,b2,b3,b4,b5,b6",
       lambda x, b1, b2, b3, b4, b5, b6: b1 * E(-b2 * x) + b3 * E(-b4 * x) + b5 * E(-b6 * x),
       lin="b1,b3,b5", kinds="b2=kp b4=kp b6=kp")

# ── association (saturating) forms ──────────────────────────────────────
define("ExpAssoc", EXPONENTIAL, "y0,A1,t1,A2,t2",
       lambda x, y0, a1, t1, a2, t2: y0 + a1 * (1 - E(-x / t1)) + a2 * (1 - E(-x / t2)),
       lin="y0,A1,A2", kinds="t1=w t2=w", lb={"t1": 0.0, "t2": 0.0})
define("ExpAssoc1", EXPONENTIAL, "TD,Yb,A,Tau",
       lambda x, td, yb, a, tau: yb + a * (1 - E(-(x - td) / tau)),
       lin="Yb,A", kinds="TD=xmin Tau=w")
define("ExpAssoc2", EXPONENTIAL, "TD1,TD2,Yb,A1,A2,Tau1,Tau2",
       lambda x, td1, td2, yb, a1, a2, t1, t2: yb + a1 * (1 - E(-(x - td1) / t1))
       + np.where(x < td2, 0.0, a2 * (1 - E(-(x - td2) / t2))),
       lin="Yb,A1,A2", kinds="TD1=xmin TD2=x Tau1=w Tau2=w")
define("ExpAssocDelay1", EXPONENTIAL, "TD,Yb,A,Tau",
       lambda x, td, yb, a, tau: np.where(x < td, yb, yb + a * (1 - E(-(x - td) / tau))),
       lin="Yb,A", kinds="TD=x Tau=w")
define("ExpAssocDelay2", EXPONENTIAL, "TD1,TD2,Yb,A1,A2,Tau1,Tau2",
       lambda x, td1, td2, yb, a1, a2, t1, t2: np.where(
           x < td1, yb,
           yb + a1 * (1 - E(-(x - td1) / t1))
           + np.where(x < td2, 0.0, a2 * (1 - E(-(x - td2) / t2)))),
       lin="Yb,A1,A2", kinds="TD1=x TD2=x Tau1=w Tau2=w")
define("ExpGrowDec", EXPONENTIAL, "y0,xc,Ag,tg,Ad,td",
       lambda x, y0, xc, ag, tg, ad, td: np.where(
           x < xc, y0 + ad + ag * (E(-xc / tg) - E(-x / tg)), y0 + ad * E(-(x - xc) / td)),
       lin="y0,Ag,Ad", kinds="xc=x tg=w td=w",
       lb={"xc": 0.0, "Ag": 0.0, "tg": 0.0, "Ad": 0.0, "td": 0.0})


def _grow3dec2(x, y0, xc, ag1, tg1, ag2, tg2, ag3, tg3, ad1, td1, ad2, td2):  # type: ignore[no-untyped-def]
    def g(t):  # type: ignore[no-untyped-def]
        return 1 - E(-xc / t)

    rise = (y0 + ad1 + ad2 - (ag1 * g(tg1) + ag2 * g(tg2) + ag3 * g(tg3))
            + ag1 * (1 - E(-x / tg1)) + ag2 * (1 - E(-x / tg2)) + ag3 * (1 - E(-x / tg3)))
    fall = y0 + ad1 * E(-(x - xc) / td1) + ad2 * E(-(x - xc) / td2)
    return np.where(x < xc, rise, fall)


define("ExpGrow3Dec2", EXPONENTIAL, "y0,xc,Ag1,tg1,Ag2,tg2,Ag3,tg3,Ad1,td1,Ad2,td2", _grow3dec2,
       lin="y0,Ag1,Ag2,Ag3,Ad1,Ad2", kinds="xc=x tg1=w tg2=w tg3=w td1=w td2=w",
       lb={n: 0.0 for n in ("xc", "Ag1", "tg1", "Ag2", "tg2", "Ag3", "tg3", "Ad1", "td1",
                            "Ad2", "td2")})

# ── pulses ──────────────────────────────────────────────────────────────
define("Pulse", EXPONENTIAL, "y0,x0,A,t1,P,t2",
       lambda x, y0, x0, A, t1, P, t2: np.where(
           x < x0, 0.0, y0 + A * (1 - E(-(x - x0) / t1)) ** P * E(-(x - x0) / t2)),
       lin="y0,A", kinds="x0=x t1=w P=ep t2=w",
       lb={"A": 0.0, "t1": 0.0, "P": 0.0, "t2": 0.0})
define("Pulse1", EXPONENTIAL, "x0,A,t1,t2,P",
       lambda x, x0, A, t1, t2, P: np.where(
           x < x0, 0.0, A * (1 - E(-(x - x0) / t1)) ** P * E(-(x - x0) / t2)),
       lin="A", kinds="x0=x t1=w t2=w P=ep", lb={"A": 0.0, "t1": 0.0, "t2": 0.0, "P": 0.0})
