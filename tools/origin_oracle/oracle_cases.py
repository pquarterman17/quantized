"""The case registry: one entry per Origin function, as data.

To add a case: write (or reuse) a generator in ``oracle_inputs.py`` and append
a ``Case``. ``{book}`` in a step becomes the input book's short name. Each
step is one ``Execute``. The runner captures every worksheet the steps create
(``books`` in oracle.json), so ``reads`` only names scalar LabTalk variables.
"""

from __future__ import annotations

import oracle_inputs as gen
import oracle_inputs_map as genmap
import oracle_inputs_signal as gensig
from oracle_cases_cluster import ABSENT_CASES, CLUSTER_CASES
from oracle_cases_extra import EXTRA_CASES
from oracle_cases_fit import FIT_CASES
from oracle_model import Case, Read

B = "[{book}]1!"
XYZ = "([{book}]1!1,[{book}]1!2,[{book}]1!3)"

_BASE_CASES: tuple[Case, ...] = (
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
    Case(
        id="unwrap_phase",
        description="unwrap of a wrapped phase ramp (radians)",
        seed=107,
        generate=gensig.wrapped_phase,
        steps=(f"unwrap ix:={B}2 unit:=rad ox:=<new>;",),
    ),
    Case(
        id="cohere",
        description="Welch coherence of two records sharing a 10 Hz tone (Hanning, 256)",
        seed=108,
        generate=gensig.coherent_pair,
        steps=(
            f"cohere ix1:={B}2 ix2:={B}3 interval:=0.01 fftlen:=256 win:=hanning "
            "winlen:=256 overlap:=128 oy:=<new>;",
        ),
    ),
    Case(
        id="decimate_fir",
        description="decimate by 4 with Origin's FIR anti-alias filter (order 32)",
        seed=109,
        generate=gensig.aliasing_tones,
        steps=(f"decimate iy:=({B}1,{B}2) d:=4 filter:=fir order:=32 oy:=<new>;",),
    ),
    Case(
        id="envelope",
        description="upper and lower envelope of an amplitude-modulated carrier",
        seed=110,
        generate=gensig.modulated_carrier,
        steps=(
            f"envelope iy:=({B}1,{B}2) type:=upper;",
            f"envelope iy:=({B}1,{B}2) type:=lower;",
        ),
    ),
    Case(
        id="smooth_rank_binomial",
        description="percentile (30%, 9 pts) and binomial (order 4 = 9-point window) smoothing",
        seed=111,
        generate=gensig.noisy_with_spikes,
        steps=(
            f"smooth iy:=({B}1,{B}2) method:=pf npts:=9 percent:=30 boundary:=repeat "
            "oy:=(<input>,<new>);",
            # bm ignores npts: its window is 2 * order + 1 (measured, see the README)
            f"smooth iy:=({B}1,{B}2) method:=bm order:=4 boundary:=repeat oy:=(<input>,<new>);",
        ),
    ),
    Case(
        id="integ2_volume",
        description="integ2 volume of a Gaussian on an offset, regular 61 x 41 matrix",
        seed=112,
        generate=genmap.gaussian_on_offset,
        steps=(
            f"xyz_regular iz:={XYZ} om:=[IntegGrid]<new>;",
            "integ2 im:=[IntegGrid]1! integral:=vol;",
        ),
        reads=(Read("vol"),),
    ),
    Case(
        id="xyz_renka",
        description="xyz_renka gridding of 150 scattered points onto 30 rows x 36 columns",
        seed=113,
        generate=genmap.scattered_surface,
        steps=(f"xyz_renka iz:={XYZ} rows:=30 cols:=36 om:=<new>;",),
    ),
    Case(
        id="xyz_shep",
        description="xyz_shep (modified Shepard, q=13, w=19) onto 30 rows x 36 columns",
        seed=114,
        generate=genmap.scattered_surface,
        steps=(f"xyz_shep iz:={XYZ} rows:=30 cols:=36 q:=13 w:=19 om:=<new>;",),
    ),
    Case(
        id="xyz_tps",
        description="xyz_tps thin-plate gridding, smoothing 0 (interpolating), 30 x 36",
        seed=115,
        generate=genmap.scattered_surface,
        steps=(f"xyz_tps iz:={XYZ} rows:=30 cols:=36 s:=0 outlier:=extrap om:=<new>;",),
    ),
    Case(
        id="interp1_curve",
        description="interp1 linear and cubic spline of a 25-point curve onto 60 query x",
        seed=116,
        generate=gensig.irregular_curve,
        steps=(
            f"interp1 ix:={B}3 iy:=({B}1,{B}2) method:=linear ox:=<new>;",
            f"interp1 ix:={B}3 iy:=({B}1,{B}2) method:=spline ox:=<new>;",
        ),
    ),
    Case(
        id="polyarea",
        description="polyarea of an irregular counter-clockwise polygon (math and abs)",
        seed=117,
        generate=gensig.star_polygon,
        steps=(
            f"polyarea iy:=({B}1,{B}2) type:=math area:=am;",
            f"polyarea iy:=({B}1,{B}2) type:=abs area:=aa;",
        ),
        reads=(Read("am"), Read("aa")),
    ),
    Case(
        id="corr1_lag",
        description="corr1 cross-correlation of a record and a copy delayed by 7 rows",
        seed=118,
        generate=gensig.shifted_pair,
        steps=(f"corr1 ix1:={B}1 ix2:={B}2 interval:=1 oy:=<new>;",),
    ),
)

CASES: tuple[Case, ...] = _BASE_CASES + EXTRA_CASES + CLUSTER_CASES + ABSENT_CASES + FIT_CASES
