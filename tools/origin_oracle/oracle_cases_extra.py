"""Wave-4 oracle cases (see ``oracle_cases`` for the registry contract)."""

from __future__ import annotations

import oracle_inputs_extra as ge
import oracle_inputs_map as genmap
from oracle_model import Case, Read

B = "[{book}]1!"
XYZ = "([{book}]1!1,[{book}]1!2,[{book}]1!3)"
QXY = "([{book}]1!4,[{book}]1!5)"

EXTRA_CASES: tuple[Case, ...] = (
    Case(
        id="corr2_maps",
        description="corr2 (FFT, normalised) of two 28 x 22 maps, the second shifted 3 x 2 cells",
        seed=119,
        generate=ge.map_pair,
        steps=(
            "xyz_regular iz:=([{book}]1!1,[{book}]1!2,[{book}]1!3) om:=[CorrA]<new>;",
            "xyz_regular iz:=([{book}]1!1,[{book}]1!2,[{book}]1!4) om:=[CorrB]<new>;",
            "corr2 im1:=[CorrA]1! im2:=[CorrB]1! norm:=1 om:=<new>;",
        ),
    ),
    Case(
        id="interp1trace",
        description="interp1trace along a spiral path (spline and bspline), 50 points",
        seed=120,
        generate=ge.spiral_path,
        steps=(
            f"interp1trace iy:=({B}1,{B}2) method:=spline npts:=50 oy:=<new>;",
            f"interp1trace iy:=({B}1,{B}2) method:=bspline npts:=50 oy:=<new>;",
        ),
    ),
    Case(
        id="interp2_nearest_triangle",
        description="interp2 onto 40 query points: nearest and triangle (Delaunay) methods",
        seed=121,
        generate=ge.scattered_with_queries,
        steps=(
            f"interp2 ixy:={QXY} ir:={XYZ} method:=nr oz:=<new>;",
            f"interp2 ixy:={QXY} ir:={XYZ} method:=ta oz:=<new>;",
        ),
    ),
    Case(
        id="interp2_tps_renka",
        description="interp2 onto 40 query points: thin-plate spline (smooth 0) and Renka-Cline",
        seed=122,
        generate=ge.scattered_with_queries,
        steps=(
            f"interp2 ixy:={QXY} ir:={XYZ} method:=tps smooth:=0 oz:=<new>;",
            f"interp2 ixy:={QXY} ir:={XYZ} method:=rc oz:=<new>;",
        ),
    ),
    Case(
        id="bspline_curve",
        description="bspline of a noisy 30-point curve onto 70 x: sf 0 and sf 0.05",
        seed=123,
        generate=ge.noisy_curve,
        steps=(
            f"bspline ix:={B}3 iy:=({B}1,{B}2) sf:=0 ox:=<new> coef:=<new>;",
            f"bspline ix:={B}3 iy:=({B}1,{B}2) sf:=0.05 ox:=<new> coef:=<new>;",
        ),
    ),
    Case(
        id="marea_surface",
        description="marea surface area of a Gaussian-on-offset 61 x 41 matrix",
        seed=124,
        generate=genmap.gaussian_on_offset,
        steps=(
            f"xyz_regular iz:={XYZ} om:=[SurfGrid]<new>;",
            "marea im:=[SurfGrid]1! area:=sa;",
        ),
        reads=(Read("sa"),),
    ),
    Case(
        id="xyz_renka_nag",
        description="xyz_renka_nag gridding of 150 scattered points onto 30 rows x 36 columns",
        seed=125,
        generate=genmap.scattered_surface,
        steps=(f"xyz_renka_nag iz:={XYZ} rows:=30 cols:=36 om:=<new>;",),
    ),
    Case(
        id="xyz_shep_nag",
        description="xyz_shep_nag gridding of 150 scattered points onto 30 rows x 36 columns",
        seed=126,
        generate=genmap.scattered_surface,
        steps=(f"xyz_shep_nag iz:={XYZ} rows:=30 cols:=36 om:=<new>;",),
    ),
    Case(
        id="psd_scaling",
        description="fft1 power spectrum, one-sided, rectangular window: MSA, SSA, TISA norms",
        seed=127,
        generate=ge.psd_record,
        steps=tuple(
            f"fft1 ix:={B}2 interval:=0.005 win:=rect psd:=1 norm:={n} st:=oneside rd:=<new>;"
            for n in ("msa", "ssa", "tisa")
        ),
    ),
    Case(
        id="avecurves_mean",
        description="avecurves method:=ave of three curves on a shared x grid",
        seed=128,
        generate=ge.curve_family,
        steps=(f"avecurves iy:=(({B}1,{B}2),({B}1,{B}3),({B}1,{B}4)) method:=ave avex:=same;",),
    ),
    Case(
        id="reduce_mean_ratio",
        description="reduce_ex every 5 points, Y mean (block average), of a 120-point ramp",
        seed=129,
        generate=ge.dense_ramp,
        steps=(
            f"reduce_ex iy:=({B}1,{B}2) subgroup:=ratio rfactor:=5 method:=ymeanxbinc oy:=<new>;",
        ),
    ),
    Case(
        id="rowttest2",
        description="rowttest2 of two groups of three replicates in each of 8 rows",
        seed=130,
        generate=ge.row_groups,
        steps=(f"rowttest2 irng1:={B}(1:3) irng2:={B}(4:6);",),
    ),
    Case(
        id="zoom_fft",
        description="Zoom FFT: no X-Function in the install",
        seed=131,
        generate=ge.psd_record,
        steps=(),
        not_exercised=(
            "searched every .OXF under Origin2026b/X-Functions for 'zoom fft' and "
            "'zoomfft': only graph-zoom functions exist; no spectral zoom X-Function",
        ),
    ),
)
