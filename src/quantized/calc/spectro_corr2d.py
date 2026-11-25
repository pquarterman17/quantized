"""2-D correlation spectroscopy, Noda's generalized method (gap audit 9, G21).

For ``m`` spectra measured under an ordered perturbation (temperature, field,
time) the **dynamic** spectra are ``y~_j(v) = y_j(v) - mean_j y_j(v)``. With
``X`` the ``(m, n)`` matrix of dynamic spectra:

* synchronous    ``Phi = X^T X / (m - 1)``
* asynchronous   ``Psi = X^T N X / (m - 1)``

where ``N`` is the Hilbert-Noda matrix, ``N_jk = 0`` for ``j = k`` and
``1 / (pi (k - j))`` otherwise (Noda, *Appl. Spectrosc.* 47, 1329, 1993, and
*Appl. Spectrosc.* 54, 994, 2000; formulas as summarised in the Wikipedia
article "Two-dimensional correlation analysis", unverified against the
originals, owner to check). Noda's reading: ``Phi > 0`` bands change in the
same direction, ``Phi < 0`` opposite; when ``Phi * Psi > 0`` the change at
``v1`` comes before ``v2``, when ``Phi * Psi < 0`` after (with ``Phi = 0`` the
order is undetermined).

Provisional, owner to confirm: the spectra are taken in the order given and
**equally spaced** in the perturbation is assumed (the Hilbert-Noda matrix is
defined for that); explicit perturbation values are only checked for equal
spacing and refused otherwise. At least 3 spectra. Maps come out with ascending
axes (rows/columns reordered together), as native-grid map DataStructs.
Pure numpy.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.io._array_books import grid_map_datastruct

__all__ = ["correlation_2d", "correlation_maps", "hilbert_noda_matrix"]

Vec = NDArray[np.float64]


def hilbert_noda_matrix(m: int) -> NDArray[np.float64]:
    """``N[j, k] = 1 / (pi (k - j))`` off the diagonal, 0 on it."""
    idx = np.arange(m, dtype=float)
    diff = idx[None, :] - idx[:, None]
    with np.errstate(divide="ignore"):
        n = 1.0 / (np.pi * diff)
    n[np.diag_indices(m)] = 0.0
    return np.asarray(n, dtype=float)


def _check_perturbation(values: list[float] | None, m: int) -> None:
    if values is None:
        return
    p = np.asarray(values, dtype=float)
    if p.size != m or not np.isfinite(p).all():
        raise ValueError(f"give one finite perturbation value per spectrum ({m})")
    d = np.diff(p)
    if np.any(d == 0) or not (np.all(d > 0) or np.all(d < 0)):
        raise ValueError("perturbation values must be strictly increasing or decreasing")
    if not np.allclose(d, d[0], rtol=1e-3, atol=0.0):
        raise ValueError(
            "perturbation values are not equally spaced; the Hilbert-Noda matrix assumes equal "
            "steps (unevenly spaced sets are not supported yet)"
        )


def correlation_2d(
    x: Vec, spectra: NDArray[np.float64], perturbation: list[float] | None = None
) -> dict[str, Any]:
    """Synchronous and asynchronous maps of ``spectra`` (shape ``(m, n)``,
    one spectrum per row, in perturbation order) over the axis ``x`` (length
    ``n``). Returns ``x`` ascending, ``synchronous``, ``asynchronous`` (both
    ``(n, n)``, ``[i, j]`` = (v_i, v_j)) and the mean ``reference`` spectrum."""
    xv = np.asarray(x, dtype=float).ravel()
    s = np.asarray(spectra, dtype=float)
    if s.ndim != 2 or s.shape[1] != xv.size:
        raise ValueError("spectra must be a list of equal-length spectra matching x")
    m, n = s.shape
    if m < 3:
        raise ValueError("2-D correlation needs at least 3 spectra")
    if n < 2:
        raise ValueError("2-D correlation needs at least 2 points per spectrum")
    if not (np.isfinite(xv).all() and np.isfinite(s).all()):
        raise ValueError("2-D correlation needs finite values everywhere (blank rows are refused)")
    if np.any(np.diff(xv) == 0):
        raise ValueError("x has repeated values")
    _check_perturbation(perturbation, m)
    order = np.argsort(xv)
    xv, s = xv[order], s[:, order]
    ref = s.mean(axis=0)
    dyn = s - ref
    phi = dyn.T @ dyn / (m - 1)
    psi = dyn.T @ (hilbert_noda_matrix(m) @ dyn) / (m - 1)
    return {"x": xv, "synchronous": phi, "asynchronous": psi, "reference": ref, "m": m}


def correlation_maps(
    x: Vec,
    spectra: NDArray[np.float64],
    perturbation: list[float] | None = None,
    *,
    x_label: str = "X",
    x_unit: str = "",
    x_range: tuple[float | None, float | None] = (None, None),
) -> tuple[DataStruct, DataStruct, dict[str, Any]]:
    """The two maps as native-grid map DataStructs (X = v1, Y = v2)."""
    xa = np.asarray(x, dtype=float).ravel()
    sa = np.asarray(spectra, dtype=float)
    lo, hi = x_range
    if lo is not None or hi is not None:
        keep = np.ones(xa.size, dtype=bool)
        if lo is not None:
            keep &= xa >= lo
        if hi is not None:
            keep &= xa <= hi
        if sa.ndim == 2 and sa.shape[1] == xa.size:
            xa, sa = xa[keep], sa[:, keep]
    r = correlation_2d(xa, sa, perturbation)
    info: dict[str, Any] = {"spectra": int(r["m"]), "points": int(r["x"].size)}
    if perturbation is not None:
        info["perturbation"] = [float(v) for v in perturbation]
    out = []
    for kind in ("synchronous", "asynchronous"):
        meta = {"corr2d": {**info, "kind": kind}}
        out.append(
            grid_map_datastruct(
                r[kind],
                r["x"],
                r["x"],
                x_label=f"{x_label} 1",
                x_unit=x_unit,
                y_label=f"{x_label} 2",
                y_unit=x_unit,
                z_unit="",
                metadata=meta,
            )
        )
    info["reference"] = [float(v) for v in r["reference"]]
    info["x"] = [float(v) for v in r["x"]]
    return out[0], out[1], info
