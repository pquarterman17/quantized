"""Specular reflectivity (Parratt recursion). Port of fitting.parrattRefl.

Pure calc layer. Computes X-ray/neutron specular reflectivity R(Q) from a layer
stack via the Parratt recursion, with optional Névot-Croce roughness and Gaussian
resolution smearing. Internally complex (Fresnel); the returned R = |r|^2 is real.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["parratt_refl"]


def parratt_refl(
    q: ArrayLike,
    layers: ArrayLike,
    *,
    roughness: bool = True,
    scale: float = 1.0,
    background: float = 0.0,
    resolution: ArrayLike | None = None,
) -> NDArray[np.float64]:
    """Specular reflectivity R(Q) from a layer stack. Port of parrattRefl.

    ``layers`` is (M, 4): [thickness Å, SLD_real Å⁻², SLD_imag Å⁻², roughness Å],
    layer 0 = incident medium, last = substrate. ``resolution`` is None, a scalar
    dQ/Q, or a per-point σ_Q vector (Gaussian-smeared over 21 samples, ±3σ).
    """
    lay = np.asarray(layers, dtype=float)
    n_layers = lay.shape[0]
    if n_layers < 2:
        raise ValueError("need at least 2 layers (incident medium + substrate)")
    q2 = np.asarray(q, dtype=float).ravel()
    n = q2.size

    if resolution is not None and np.any(np.asarray(resolution, dtype=float) > 0):
        res = np.asarray(resolution, dtype=float)
        if res.size == 1:
            dq = q2 * float(res)
        elif res.size == n:
            dq = res.ravel()
        else:
            raise ValueError("resolution must be empty, a scalar dQ/Q, or an N-vector σ_Q")
        n_over, n_sigma = 21, 3
        offsets = np.linspace(-n_sigma, n_sigma, n_over)
        zero_res = dq <= 0
        dq_safe = dq.copy()
        dq_safe[zero_res] = 1.0
        q_full = np.maximum(q2[:, None] + dq_safe[:, None] * offsets[None, :], 1e-6)
        r_flat = parratt_refl(
            q_full.ravel(), lay, roughness=roughness, scale=scale, background=background
        )
        r_mat = r_flat.reshape(n, n_over)
        w = np.exp(-0.5 * ((q_full - q2[:, None]) / dq_safe[:, None]) ** 2)
        r_out = np.sum(w * r_mat, axis=1) / np.sum(w, axis=1)
        if np.any(zero_res):
            r_out[zero_res] = r_mat[zero_res, n_over // 2]
        return np.asarray(r_out, dtype=float)

    d = lay[:, 0]
    sigma = lay[:, 3]
    sld = lay[:, 1] + 1j * lay[:, 2]
    kz = np.sqrt((q2[:, None] / 2) ** 2 - 4 * np.pi * sld[None, :])  # (N, M) complex
    r = np.zeros(n, dtype=complex)
    for j in range(n_layers - 1, 0, -1):
        kz_above = kz[:, j - 1]
        kz_below = kz[:, j]
        fj = (kz_above - kz_below) / (kz_above + kz_below)
        if roughness and sigma[j] > 0:
            fj = fj * np.exp(-2 * kz_above * kz_below * sigma[j] ** 2)
        if j < n_layers - 1 and d[j] > 0:
            phase = np.exp(2j * kz_below * d[j])
        else:
            phase = np.ones(n, dtype=complex)
        r = (fj + r * phase) / (1 + fj * r * phase)

    refl = scale * np.abs(r) ** 2 + background
    return np.asarray(np.maximum(refl, 0.0), dtype=float)
