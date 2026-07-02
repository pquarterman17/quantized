r"""Pawley whole-pattern refinement for powder XRD (``fitting.pawleyRefine``).

Pure calc layer. Pawley refinement fits **integrated peak intensities freely** —
it does not require a structural model (that is Rietveld). This is the same
scaffold as the MATLAB original: lattice parameters + an overall scale are
refined by an adaptive grid search around the initial cell, while at each trial
the peak intensities and a linear background are solved by linear least-squares.

Pipeline
--------
1. For a trial cell, enumerate allowed reflections via
   :func:`quantized.calc.crystallography.plane_spacings` (centering rules only —
   glide/screw absences are not applied, matching the MATLAB scaffold), keeping
   ``0 < 2θ <= max_two_theta``.
2. Build a fixed-width pseudo-Voigt (50–50 Gaussian/Lorentzian) basis, one column
   per peak, plus a linear background basis ``[1, 2θ]``; solve
   ``[peaks | bg] · x = I_obs`` by least-squares, clamping peak intensities ``≥ 0``.
3. ``χ² = Σ (model − obs)²`` scores the trial cell. An adaptive grid search steps
   each free axis ``± 0.02·a₀`` (halving on stalls), tying axes by crystal system
   (cubic ``a=b=c``; tetragonal ``a=b≠c``; else all three free).
4. Report the refined cell, the fitted model/background/residual, per-peak
   intensities, and the weighted-profile R-factor
   ``R_wp = sqrt( Σ w·resid² / Σ w·obs² )`` with Poisson-like weights
   ``w = 1/max(I, 1)``.

Verified by invariants (cell recovery on a synthetic pattern, output-field
presence, size-mismatch rejection) rather than golden values — mirroring
``tests/fitting/test_pawleyRefine.m``, since the adaptive grid search + LAPACK
least-squares can branch differently from MATLAB at the last significant digit.

References
----------
Pawley, G.S., *Unit-cell refinement from powder diffraction scans*,
J. Appl. Cryst. **14**, 357 (1981).
Cagliotti, G. et al., Nucl. Instrum. **3**, 223 (1958) — U/V/W profile.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.crystallography import plane_spacings

__all__ = ["pawley_refine"]

_REQUIRED_FIELDS = ("a", "b", "c", "symmetry")
_BACKGROUNDS = ("linear", "polynomial", "cheby")


def pawley_refine(
    two_theta: NDArray[np.float64] | list[float],
    intensity: NDArray[np.float64] | list[float],
    phase_info: dict[str, Any],
    *,
    wavelength: float = 1.5406,
    max_two_theta: float = 120.0,
    background: str = "linear",
    profile_fwhm: float = 0.05,
    refine_cell: bool = True,
    max_iter: int = 20,
) -> dict[str, Any]:
    r"""Pawley refine a powder pattern against a phase's lattice.

    Parameters
    ----------
    two_theta, intensity
        Observed scan (``2θ`` in degrees, counts/intensity). Same length.
    phase_info
        Dict with ``a``, ``b``, ``c`` (Å) and ``symmetry`` (Bravais letter /
        centering, e.g. ``'F'``); optional ``alpha``/``beta``/``gamma`` (deg,
        default 90) and ``hklMax`` (default 6).
    wavelength
        X-ray wavelength (Å); CuKα1 by default.
    max_two_theta
        Upper ``2θ`` cut-off (deg).
    background
        ``'linear'`` (only linear is implemented, matching the scaffold).
    profile_fwhm
        Fixed pseudo-Voigt FWHM per peak (deg).
    refine_cell
        Refine the lattice parameters (else keep the initial cell).
    max_iter
        Outer grid-search iterations.

    Returns
    -------
    dict
        ``cell`` / ``cell_initial`` ``[a b c α β γ]``, ``scale`` (NaN — folded
        into per-peak intensity), ``peaks`` (list of ``hkl``/``two_theta``/``d``/
        ``multiplicity``/``intensity``), ``background``/``model``/``residual``
        ``[N]``, ``rwp``, ``n_peaks``.
    """
    tt = np.asarray(two_theta, dtype=float).ravel()
    obs = np.asarray(intensity, dtype=float).ravel()
    if tt.size == 0 or obs.size == 0:
        raise ValueError("two_theta and intensity must be non-empty")
    if tt.size != obs.size:
        raise ValueError(
            f"two_theta ({tt.size}) and intensity ({obs.size}) must have the same length."
        )
    if background not in _BACKGROUNDS:
        raise ValueError(f"background must be one of {_BACKGROUNDS}, got {background!r}")

    for field in _REQUIRED_FIELDS:
        if field not in phase_info:
            raise ValueError(f'phase_info is missing required field "{field}".')
    alpha = float(phase_info.get("alpha", 90.0))
    beta = float(phase_info.get("beta", 90.0))
    gamma = float(phase_info.get("gamma", 90.0))
    hkl_max = int(phase_info.get("hklMax", 6))
    symmetry = str(phase_info["symmetry"])
    cell0 = [
        float(phase_info["a"]),
        float(phase_info["b"]),
        float(phase_info["c"]),
        alpha,
        beta,
        gamma,
    ]

    def compute_peaks(cell: list[float]) -> list[dict[str, Any]]:
        ps = plane_spacings(
            cell[0],
            b=cell[1],
            c=cell[2],
            alpha=cell[3],
            beta=cell[4],
            gamma=cell[5],
            centering=symmetry,
            max_hkl=hkl_max,
            lambda_=wavelength,
        )
        peaks: list[dict[str, Any]] = []
        for hkl, d, tth, mult in zip(
            ps["hkl"], ps["d"], ps["two_theta"], ps["multiplicity"], strict=True
        ):
            if math.isnan(tth) or tth > max_two_theta or tth <= 0:
                continue
            peaks.append(
                {"hkl": hkl, "two_theta": tth, "d": d, "multiplicity": mult, "intensity": 0.0}
            )
        return peaks

    def trial_chi2(cell: list[float]) -> float:
        peaks = compute_peaks(cell)
        if not peaks:
            return math.inf
        model_y, _bg, _peak_i = _build_model(peaks, tt, obs, profile_fwhm)
        resid = model_y - obs
        return float(np.sum(resid**2))

    # ── Adaptive grid search around the initial cell ────────────────────────
    cell_refined = list(cell0)
    if refine_cell:
        tol_eq = 1e-4
        is_cubic = abs(cell0[0] - cell0[1]) < tol_eq and abs(cell0[1] - cell0[2]) < tol_eq
        is_tetrag = abs(cell0[0] - cell0[1]) < tol_eq and abs(cell0[1] - cell0[2]) >= tol_eq
        if is_cubic:
            axes_to_step = [0]  # a only; mirror to b, c
        elif is_tetrag:
            axes_to_step = [0, 2]  # a (mirror to b) and c
        else:
            axes_to_step = [0, 1, 2]

        step = [0.02 * cell0[0], 0.02 * cell0[1], 0.02 * cell0[2]]
        for _ in range(max_iter):
            chi_base = trial_chi2(cell_refined)
            improved = False
            for ax in axes_to_step:
                for sign in (1, -1):
                    trial = list(cell_refined)
                    if is_cubic:
                        new_val = cell_refined[0] + sign * step[0]
                        trial = [new_val, new_val, new_val, *cell_refined[3:6]]
                    elif is_tetrag and ax == 0:
                        new_val = cell_refined[0] + sign * step[0]
                        trial = [new_val, new_val, cell_refined[2], *cell_refined[3:6]]
                    else:
                        trial[ax] = cell_refined[ax] + sign * step[ax]
                    if trial_chi2(trial) < chi_base:
                        cell_refined = trial
                        improved = True
                        break
            if not improved:
                step = [s / 2 for s in step]
                if max(abs(s) for s in step) < 1e-5:
                    break

    # ── Final model on the refined cell ─────────────────────────────────────
    peaks = compute_peaks(cell_refined)
    model_y, bg, peak_i = _build_model(peaks, tt, obs, profile_fwhm)
    residual = obs - model_y

    weights = 1.0 / np.maximum(obs, 1.0)  # Poisson-like weights
    rwp_num = float(np.sum(weights * residual**2))
    rwp_den = float(np.sum(weights * obs**2))
    rwp = math.sqrt(rwp_num / rwp_den) if rwp_den > 0 else float("nan")

    for k, pk in enumerate(peaks):
        pk["intensity"] = float(peak_i[k]) if k < peak_i.size else 0.0

    return {
        "cell": cell_refined,
        "cell_initial": cell0,
        "scale": float("nan"),  # folded into per-peak intensity (scaffold)
        "peaks": peaks,
        "background": bg,
        "model": model_y,
        "residual": residual,
        "rwp": rwp,
        "n_peaks": len(peaks),
    }


def _build_model(
    peaks: list[dict[str, Any]],
    two_theta: NDArray[np.float64],
    intensity: NDArray[np.float64],
    profile_fwhm: float,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """Fit peak intensities + a linear background by least-squares (``buildModel``).

    Each peak is a fixed-FWHM 50–50 pseudo-Voigt column; the background basis is
    ``[1, 2θ]``. Solves ``[peaks | bg] · x = I`` and clamps peak intensities ``≥ 0``.
    """
    n_pk = len(peaks)
    if n_pk == 0:
        zeros = np.zeros_like(two_theta)
        return zeros, np.zeros_like(two_theta), np.zeros(0, dtype=float)

    w = profile_fwhm / 2.0
    basis = np.zeros((two_theta.size, n_pk), dtype=float)
    for k, pk in enumerate(peaks):
        dx = two_theta - pk["two_theta"]
        lorentz = 1.0 / (1.0 + (dx / w) ** 2)
        gauss = np.exp(-0.5 * (dx / (w / math.sqrt(2.0 * math.log(2.0)))) ** 2)
        basis[:, k] = 0.5 * lorentz + 0.5 * gauss

    bg_basis = np.column_stack([np.ones_like(two_theta), two_theta])
    design = np.column_stack([basis, bg_basis])
    coeffs, *_ = np.linalg.lstsq(design, intensity, rcond=None)

    peak_intensity = np.asarray(np.maximum(coeffs[:n_pk], 0.0), dtype=float)
    bg_coeff = coeffs[n_pk:]
    bg = np.asarray(bg_basis @ bg_coeff, dtype=float)
    model_y = np.asarray(basis @ peak_intensity + bg, dtype=float)
    return model_y, bg, peak_intensity
