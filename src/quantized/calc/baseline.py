"""Baseline estimation. Ports of MATLAB +utilities/baseline*.m.

Pure functions: spectrum in, baseline out.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray
from scipy import sparse
from scipy.sparse.linalg import spsolve

__all__ = ["baseline_als"]


def baseline_als(
    y: NDArray[np.float64],
    *,
    lam: float = 1e6,
    p: float = 0.01,
    max_iter: int = 20,
    tol: float = 1e-6,
) -> NDArray[np.float64]:
    """Asymmetric least-squares (Eilers/Whittaker) baseline. Port of baselineALS.

    Solves ``(W + lam·DᵀD) z = W·y`` iteratively, reweighting w = p where
    y>z else (1-p), until the weights converge.
    """
    if lam <= 0:
        raise ValueError("lam must be positive")
    if not 0 < p < 1:
        raise ValueError("p must be in (0, 1)")
    yv = np.asarray(y, dtype=float).ravel()
    n = yv.size
    if n < 3:
        return yv.copy()

    # Second-difference operator D: (n-2) x n  (rows: y[i] - 2y[i+1] + y[i+2]).
    diff2 = sparse.diags(
        diagonals=[1.0, -2.0, 1.0], offsets=[0, 1, 2], shape=(n - 2, n)
    ).tocsc()
    dtd = (diff2.T @ diff2).tocsc()

    w = np.ones(n)
    z = yv.copy()
    for _ in range(max_iter):
        big_w = sparse.diags(w, 0, shape=(n, n))
        c = (big_w + lam * dtd).tocsc()
        z = spsolve(c, w * yv)
        w_new = p * (yv > z) + (1.0 - p) * (yv <= z)
        if float(np.max(np.abs(w_new - w))) < tol:
            w = w_new
            break
        w = w_new
    return np.asarray(z, dtype=float)
