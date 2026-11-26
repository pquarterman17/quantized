"""The case registry: one entry per Origin function, as data.

To add a case: write (or reuse) a generator in ``oracle_inputs.py`` and append
a ``Case``. ``{book}`` in a step becomes the input book's short name. Each
step is one ``Execute``. The runner captures every worksheet the steps create
(``books`` in oracle.json), so ``reads`` only names scalar LabTalk variables.
"""

from __future__ import annotations

import oracle_inputs as gen
from oracle_model import Case, Read

B = "[{book}]1!"

CASES: tuple[Case, ...] = (
    Case(
        id="intersect",
        description="Intersect of sin(x) and the level 0.3 on one irregular x grid",
        seed=101,
        generate=gen.two_curves,
        steps=(f"intersect iy1:={B}(1,2) iy2:={B}(1,3) oy:=<new>;",),
    ),
    Case(
        id="levelcrossing",
        description="Level crossings of a seeded sine at level 0.25",
        seed=102,
        generate=gen.sine_level,
        steps=(f"levelcrossing iy:={B}(1,2) level:=0.25 ncrossing:=ncr;",),
        reads=(Read("ncr"),),
    ),
    Case(
        id="nlfit_gauss",
        description="Control: nlbegin/nlfit/nlend with the Origin gauss function",
        seed=103,
        generate=gen.gauss_noisy,
        steps=(f"nlbegin iy:={B}(1,2) func:=gauss;", "nlfit;", "nlend output:=1;"),
    ),
    Case(
        id="integ1_area",
        description="Control: integ1 of y = 2x on [0, 5]; exact area 25",
        seed=104,
        generate=gen.known_area,
        steps=(f"integ1 iy:={B}(1,2) area:=ar;",),
        reads=(Read("ar"),),
    ),
    Case(
        id="pkfind",
        description="pkFind on three planted Gaussians",
        seed=105,
        generate=gen.planted_peaks,
        steps=(f"pkFind iy:={B}(1,2) ocenter_x:=<new> ocenter_y:=<new>;",),
    ),
    Case(
        id="fitlrxerr",
        description="York line fit with per-point X and Y errors, via Origin's own engine",
        seed=106,
        generate=gen.line_xy_errors,
        load_oc=("qz_york.c",),
        steps=('double qzr = qz_york_fit("{book}", 0.95);',),
        reads=tuple(
            Read(n)
            for n in (
                "qz_ret", "qz_n", "qz_intercept", "qz_intercept_err", "qz_slope",
                "qz_slope_err", "qz_slope_lcl", "qz_slope_ucl", "qz_dof", "qz_chisq",
                "qz_redchisq", "qz_rsq", "qz_cov_ab",
            )
        ),
    ),
)
