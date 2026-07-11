"""Interactive + domain-specific backgrounds (GOTO_PLAN #2, #3, #7).

New features beyond MATLAB parity (no goldens — reference-value and
invariant tests in ``tests/test_calc_backgrounds.py``):

- :func:`anchor_baseline` — baseline through user-picked (x, y) anchor
  points (linear / pchip / spline), extrapolation clamped to the end
  anchors.
- :func:`shirley_background` — the classic iterative Shirley step
  background for XPS/XAS spectra (Shirley 1972).
- :func:`xrd_low_angle_background` — hyperbolic air-scatter / beam-tail
  background for powder XRD low-angle upturn (TOPAS ``One_on_X`` form).
- :func:`footprint_factor` / :func:`footprint_correction` — geometric
  beam-footprint correction for XRR/NR specular scans (Gibaud & Vignaud).

Pure layer: ndarray in -> ndarray out. No fastapi / pydantic imports.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = [
    "anchor_baseline",
    "footprint_correction",
    "footprint_factor",
    "shirley_background",
    "xrd_low_angle_background",
]

_EPS = float(np.finfo(float).eps)


def anchor_baseline(
    x: ArrayLike,
    y: ArrayLike,
    anchors: ArrayLike,
    *,
    method: str = "pchip",
) -> NDArray[np.float64]:
    """Baseline through user-picked (x, y) anchor points. GOTO_PLAN #2.

    Interpolates the ``anchors`` — a sequence of ``(x, y)`` pairs picked on
    the plot — across the full data grid ``x``:

    - ``method='linear'``: piecewise-linear through the anchors.
    - ``method='pchip'``: shape-preserving cubic (Fritsch & Carlson 1980,
      SIAM J. Numer. Anal. 17, 238) — no overshoot between anchors.
    - ``method='spline'``: interpolating B-spline of degree
      ``min(3, n_anchors - 1)`` (degrades gracefully: 2 anchors -> linear,
      3 -> quadratic, >=4 -> cubic).

    Outside the anchor x-range the baseline is CLAMPED to the end anchors'
    y values (constant extrapolation) — a subtraction should never invent
    a diverging polynomial tail beyond where the user anchored it.

    ``y`` (the signal the baseline sits under) is validated against ``x``
    for length but does not influence the curve: the baseline is defined
    by the anchors alone. Anchors are sorted by x internally; duplicate or
    non-finite anchor x values raise ``ValueError`` (the interpolant needs
    strictly monotone knots).
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError(f"x and y must have the same length (got {xv.size} vs {yv.size})")
    a = np.asarray(anchors, dtype=float)
    if a.ndim != 2 or a.shape[1] != 2:
        raise ValueError("anchors must be a sequence of (x, y) pairs")
    if a.shape[0] < 2:
        raise ValueError(f"need at least 2 anchors (got {a.shape[0]})")
    if not np.all(np.isfinite(a)):
        raise ValueError("anchor coordinates must be finite")
    order = np.argsort(a[:, 0], kind="stable")
    ax, ay = a[order, 0], a[order, 1]
    if np.any(np.diff(ax) <= 0):
        raise ValueError("anchor x values must be strictly monotone (no duplicates)")

    if method == "linear":
        base = np.interp(xv, ax, ay, left=ay[0], right=ay[-1])
    elif method == "pchip":
        from scipy.interpolate import PchipInterpolator

        base = PchipInterpolator(ax, ay, extrapolate=False)(xv)
    elif method == "spline":
        from scipy.interpolate import make_interp_spline

        k = min(3, ax.size - 1)
        spl = make_interp_spline(ax, ay, k=k)
        base = np.asarray(spl(xv), dtype=float)
        # make_interp_spline extrapolates; clamp outside the anchor range.
        base[xv < ax[0]] = np.nan
        base[xv > ax[-1]] = np.nan
    else:
        raise ValueError("method must be linear/pchip/spline")

    base = np.asarray(base, dtype=float)
    # Clamp extrapolation to the end anchors (pchip/spline left NaN outside).
    base = np.where(xv < ax[0], ay[0], base)
    base = np.where(xv > ax[-1], ay[-1], base)
    return np.asarray(base, dtype=float)


def shirley_background(
    x: ArrayLike,
    y: ArrayLike,
    *,
    max_iter: int = 50,
    tol: float = 1e-6,
    edge_average: int = 1,
) -> tuple[NDArray[np.float64], dict[str, Any]]:
    """Iterative Shirley step background for XPS/XAS spectra. GOTO_PLAN #3.

    The Shirley background at a point is proportional to the integrated
    peak intensity (signal above background) remaining on ONE side of that
    point — it steps up under a peak by exactly the fraction of the peak
    area crossed. With endpoint levels ``I1 = y[0]`` and ``I2 = y[-1]``
    (each optionally averaged over ``edge_average`` samples) the fixed
    point iterated here is::

        B_{n+1}(x_i) = I2 + (I1 - I2) * A_i(B_n) / A_0(B_n)
        A_i(B)       = integral_{x_i}^{x_end} (y - B) dx   (trapezoidal)

    which pins ``B(x_0) = I1`` and ``B(x_end) = I2`` at every iteration.
    Iteration stops when ``max|B_{n+1} - B_n|`` drops below ``tol`` times
    the spectrum's peak-to-peak range; exceeding ``max_iter`` raises
    ``ValueError`` (surfaced as 422 at the route boundary, never a 500).

    A flat spectrum (no peak area, ``A_0 ~ 0``) short-circuits to the
    linear ramp between the endpoint levels — for constant data that is a
    constant equal to the data, i.e. a near-zero background after
    subtraction of the flat level.

    x may be ascending or descending (XPS binding-energy scans are often
    descending); the result is returned in the input order.

    References:
        D. A. Shirley, Phys. Rev. B 5, 4709 (1972).
        A. Proctor & P. M. A. Sherwood, Anal. Chem. 54, 13 (1982)
        (the iterative scheme).
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError(f"x and y must have the same length (got {xv.size} vs {yv.size})")
    n = xv.size
    if n < 3:
        raise ValueError("need at least 3 points for a Shirley background")
    if not np.all(np.isfinite(xv)) or not np.all(np.isfinite(yv)):
        raise ValueError("x and y must be finite")
    if max_iter < 1:
        raise ValueError("max_iter must be >= 1")
    if tol <= 0:
        raise ValueError("tol must be positive")
    if edge_average < 1:
        raise ValueError("edge_average must be >= 1")

    dx = np.diff(xv)
    flipped = False
    if np.all(dx < 0):
        xv, yv = xv[::-1], yv[::-1]
        flipped = True
    elif not np.all(dx > 0):
        raise ValueError("x must be strictly monotone (ascending or descending)")

    m = min(edge_average, n)
    i1 = float(np.mean(yv[:m]))  # background level at the low-x end
    i2 = float(np.mean(yv[-m:]))  # background level at the high-x end
    y_range = float(np.ptp(yv))
    scale = max(y_range, abs(i1 - i2), _EPS)

    # Start from the linear ramp between the endpoint levels.
    ramp = np.asarray(np.interp(xv, [xv[0], xv[-1]], [i1, i2]), dtype=float)
    b = ramp.copy()
    converged = False
    n_iter = 0
    for it in range(1, max_iter + 1):
        n_iter = it
        resid = yv - b
        # A_i = trapezoidal integral of (y - B) from x_i to the end.
        seg = 0.5 * (resid[:-1] + resid[1:]) * np.diff(xv)
        a_right = np.concatenate([np.cumsum(seg[::-1])[::-1], [0.0]])
        a_tot = float(a_right[0])
        if abs(a_tot) < _EPS * scale:
            b = ramp
            converged = True  # no peak area -> the ramp IS the fixed point
            break
        b_new = i2 + (i1 - i2) * a_right / a_tot
        delta = float(np.max(np.abs(b_new - b)))
        b = np.asarray(b_new, dtype=float)
        if delta < tol * scale:
            converged = True
            break

    if not converged:
        raise ValueError(
            f"Shirley background did not converge after {max_iter} iterations; "
            "increase max_iter or loosen tol"
        )
    if flipped:
        b = b[::-1]
    return np.asarray(b, dtype=float), {"nIter": n_iter, "converged": converged}


def xrd_low_angle_background(
    x: ArrayLike,
    y: ArrayLike,
    *,
    include_x2: bool = True,
    max_iter: int = 100,
    tol: float = 1e-6,
) -> tuple[NDArray[np.float64], dict[str, Any]]:
    """Low-angle air-scatter / beam-tail background for powder XRD. GOTO_PLAN #7a.

    The low-2theta intensity upturn from air scatter and the direct-beam
    tail is conventionally modelled with a hyperbolic term in 2theta —
    the ``One_on_X`` background of TOPAS (A. A. Coelho, J. Appl. Cryst.
    51, 210 (2018)); GSAS-II and FullProf ship the same 1/x form. Fitted
    model (linear in its coefficients)::

        B(2theta) = b0 + b1 / (2theta) [+ b2 / (2theta)^2]

    with the optional ``1/x^2`` term (``include_x2``) sharpening the
    beam-tail rise. So Bragg peaks cannot inflate the fit, the
    least-squares solve is wrapped in the Lieber-Mahadevan-Jansen
    iterative clip (Appl. Spectrosc. 57, 1363 (2003)): after each fit the
    working signal is clamped to ``min(signal, fit)`` and refit, until
    the RMS change falls below ``tol`` times the data range (converged)
    or ``max_iter`` is reached (returned with ``converged=False``, like
    :func:`quantized.calc.baseline.baseline_modpoly`).

    Requires strictly positive x (2theta in degrees) — the hyperbolic
    basis diverges at 0. Returns ``(background, info)`` with
    ``info = {"coeffs": [b0, b1(, b2)], "nIter", "converged"}``.
    """
    xv = np.asarray(x, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError(f"x and y must have the same length (got {xv.size} vs {yv.size})")
    n = xv.size
    n_terms = 3 if include_x2 else 2
    if n < n_terms + 1:
        raise ValueError(f"need at least {n_terms + 1} points (got {n})")
    if not np.all(np.isfinite(xv)) or not np.all(np.isfinite(yv)):
        raise ValueError("x and y must be finite")
    if np.any(xv <= 0):
        raise ValueError("x must be strictly positive (2-theta in degrees)")
    if max_iter < 1:
        raise ValueError("max_iter must be >= 1")

    cols = [np.ones(n), 1.0 / xv]
    if include_x2:
        cols.append(1.0 / xv**2)
    basis = np.column_stack(cols)

    y_work = yv.copy()
    y_range = max(float(np.ptp(yv)), _EPS)
    coeffs = np.zeros(n_terms)
    bg = np.zeros(n)
    converged = False
    n_iter = 0
    for it in range(1, max_iter + 1):
        n_iter = it
        coeffs, *_ = np.linalg.lstsq(basis, y_work, rcond=None)
        bg = np.asarray(basis @ coeffs, dtype=float)
        y_new = np.asarray(np.minimum(y_work, bg), dtype=float)
        rms = math.sqrt(float(np.mean((y_new - y_work) ** 2)))
        y_work = y_new
        if rms / y_range < tol:
            converged = True
            break

    info = {
        "coeffs": [float(c) for c in coeffs],
        "nIter": n_iter,
        "converged": converged,
    }
    return np.asarray(bg, dtype=float), info


def footprint_factor(
    theta_deg: ArrayLike,
    *,
    beam_width: float,
    sample_length: float,
) -> NDArray[np.float64]:
    """Illuminated fraction F(theta) of the beam for XRR/NR geometry.

    A beam of (full) width ``w`` incident at grazing angle theta
    illuminates a strip of length ``w / sin(theta)`` on the sample. Below
    the spill-over angle ``theta_spill = arcsin(w / L)`` that strip
    exceeds the sample length ``L`` and only the fraction::

        F(theta) = L * sin(theta) / w        (theta < theta_spill)
        F(theta) = 1                          (theta >= theta_spill)

    of the beam actually strikes the sample (uniform / top-hat beam
    profile assumed). Points with ``sin(theta) <= 0`` get ``F = 1``
    (a non-grazing point cannot be footprint-corrected; leave it alone).

    Reference: A. Gibaud & G. Vignaud, "Specular Reflectivity from Smooth
    and Rough Surfaces", in J. Daillant & A. Gibaud (eds), *X-ray and
    Neutron Reflectivity*, Lect. Notes Phys. 770, Springer (2009), sec.
    3.3 (beam footprint / spill-over).
    """
    if beam_width <= 0:
        raise ValueError("beam_width must be positive")
    if sample_length <= 0:
        raise ValueError("sample_length must be positive")
    th = np.asarray(theta_deg, dtype=float).ravel()
    s = np.sin(np.radians(th))
    frac = np.asarray(sample_length * s / beam_width, dtype=float)
    out = np.where(s <= 0, 1.0, np.minimum(frac, 1.0))
    return np.asarray(out, dtype=float)


def footprint_correction(
    theta: ArrayLike,
    y: ArrayLike,
    *,
    beam_width: float,
    sample_length: float,
    two_theta: bool = False,
) -> tuple[NDArray[np.float64], dict[str, Any]]:
    """Beam-footprint (spill-over) correction for XRR/NR scans. GOTO_PLAN #7b.

    Divides the measured intensity by the illuminated fraction
    :func:`footprint_factor`, i.e. multiplies by ``w / (L sin(theta))``
    below the spill-over angle and by exactly 1 above it — applying the
    correction twice above spill-over is therefore a no-op (idempotent
    there). ``two_theta=True`` reads the axis as the detector angle
    2theta and uses ``theta = x / 2`` for the geometry.

    ``beam_width`` and ``sample_length`` share any one length unit (only
    the ratio ``w / L`` enters). Returns ``(corrected, info)`` with
    ``info = {"spilloverDeg": ...}`` (the incidence angle, in degrees,
    above which no correction is applied; 90 when ``w >= L``).

    Reference: Gibaud & Vignaud (2009), see :func:`footprint_factor`.
    """
    xv = np.asarray(theta, dtype=float).ravel()
    yv = np.asarray(y, dtype=float).ravel()
    if xv.size != yv.size:
        raise ValueError(f"theta and y must have the same length (got {xv.size} vs {yv.size})")
    th = xv / 2.0 if two_theta else xv
    factor = footprint_factor(th, beam_width=beam_width, sample_length=sample_length)
    corrected = np.asarray(yv / factor, dtype=float)
    ratio = min(beam_width / sample_length, 1.0)
    spill = math.degrees(math.asin(ratio))
    return corrected, {"spilloverDeg": spill}
