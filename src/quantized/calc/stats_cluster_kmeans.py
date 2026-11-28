"""k-means clustering (ORIGIN_FEATURE_GAP_PLAN item 11, JMP_GAP_PLAN J13).

Own Lloyd iteration over numpy (not ``scipy.cluster.vq.kmeans2``): the seeded
k-means++ start, the empty-cluster rule and the restart policy are all stated
here, so a seed reproduces the same answer on every machine.

* Start: k-means++ (D^2 weighting) or ``random`` distinct rows, from
  ``numpy.random.default_rng([seed, restart])``.
* Iterate assign / update until the assignment stops changing or
  ``max_iter``. An empty cluster takes the point farthest from its own centre.
* ``initial_centers`` (k x p, original units) replaces the random start and the
  restarts: one deterministic run from those centres (``init`` then reads
  ``"given"``). This is how an Origin run is reproduced exactly, and cluster
  ``i`` is the one that grew from centre ``i`` as typed (no sorting).
* Restarts: ``n_init`` independent starts, the lowest within-cluster sum of
  squares wins (the earlier restart on an exact tie).
* Cluster numbers 1..k are assigned by sorting the centroids (original units)
  lexicographically, so a label never depends on which restart won. With given
  centres the numbers follow the order the centres were given instead.
* Distances, centroids and the sums of squares are taken in the scaled space
  that was clustered (``standardize``); centroids are also reported in
  original units, and ``wcss_original`` is the same partition's within sum of
  squares in original units.
* The silhouette (Euclidean, scaled space) is computed up to
  ``SILHOUETTE_MAX_ROWS`` rows and reported as null above that.

Fail closed: non-numeric data, NaN rows, fewer rows than k, fewer distinct
rows than k and constant columns under scaling are refused with a reason.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.spatial.distance import cdist

from quantized.calc.stats_cluster_common import check_matrix, standardize_columns

SILHOUETTE_MAX_ROWS = 3000
MAX_K = 100
MAX_RESTARTS = 200


def _start(
    z: NDArray[np.float64], k: int, init: str, rng: np.random.Generator
) -> NDArray[np.float64]:
    n = z.shape[0]
    if init == "random":
        return np.asarray(z[rng.choice(n, size=k, replace=False)], dtype=float).copy()
    centers = np.empty((k, z.shape[1]))
    centers[0] = z[int(rng.integers(n))]
    d2 = ((z - centers[0]) ** 2).sum(axis=1)
    for c in range(1, k):
        total = float(d2.sum())
        idx = int(rng.choice(n, p=d2 / total)) if total > 0 else int(rng.integers(n))
        centers[c] = z[idx]
        d2 = np.minimum(d2, ((z - centers[c]) ** 2).sum(axis=1))
    return centers


def _lloyd(
    z: NDArray[np.float64], centers: NDArray[np.float64], max_iter: int
) -> tuple[NDArray[np.intp], NDArray[np.float64], int, bool]:
    k = centers.shape[0]
    labels: NDArray[np.intp] | None = None
    converged = False
    it = 0
    for it in range(1, max_iter + 1):  # noqa: B007 (read after the loop)
        d = cdist(z, centers, "sqeuclidean")
        new = d.argmin(axis=1)
        counts = np.bincount(new, minlength=k)
        for c in np.flatnonzero(counts == 0):  # take the worst-fitted point of a larger cluster
            own = d[np.arange(len(z)), new]
            own[counts[new] <= 1] = -1.0
            far = int(own.argmax())
            counts[new[far]] -= 1
            new[far] = c
            counts[c] = 1
        centers = np.vstack([z[new == c].mean(axis=0) for c in range(k)])
        if labels is not None and np.array_equal(new, labels):
            converged = True
            break
        labels = new
    assert labels is not None
    return labels, centers, it, converged


def silhouette(z: NDArray[np.float64], labels: NDArray[np.intp], k: int) -> NDArray[np.float64]:
    """Per-point silhouette widths (Euclidean); a singleton cluster scores 0."""
    d = cdist(z, z)
    sums = np.stack([d[:, labels == c].sum(axis=1) for c in range(k)], axis=1)
    counts = np.bincount(labels, minlength=k).astype(float)
    n = len(z)
    own = counts[labels]
    a = sums[np.arange(n), labels] / np.maximum(own - 1.0, 1.0)
    mean_to = sums / counts
    mean_to[np.arange(n), labels] = np.inf
    b = mean_to.min(axis=1)
    s = (b - a) / np.maximum(a, b)
    s[own <= 1] = 0.0
    s[~np.isfinite(s)] = 0.0  # a = b = 0 (coincident points)
    return np.asarray(s, dtype=float)


def _check_given(
    centers: object, k: int, p: int, shift: NDArray[np.float64], scale: NDArray[np.float64]
) -> NDArray[np.float64]:
    """User-specified starting centres (original units) as scaled-space rows."""
    try:
        c = np.asarray(centers, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"initial centres must be numeric: {exc}") from exc
    if c.shape != (k, p) or not np.isfinite(c).all():
        raise ValueError(f"initial centres must be a finite {k} x {p} matrix (one row per cluster)")
    if len(np.unique(c, axis=0)) < k:
        raise ValueError("initial centres must be distinct")
    return np.asarray((c - shift) / scale, dtype=float)


def kmeans_cluster(
    x: object,
    k: int,
    *,
    standardize: str = "zscore",
    init: str = "kmeans++",
    seed: int = 0,
    max_iter: int = 300,
    n_init: int = 10,
    initial_centers: object = None,
) -> dict[str, Any]:
    """Cluster the rows of ``x`` into ``k`` groups. See the module docstring."""
    if isinstance(k, bool) or not isinstance(k, int | np.integer) or not 2 <= k <= MAX_K:
        raise ValueError(f"k must be a whole number from 2 to {MAX_K}")
    if init not in ("kmeans++", "random"):
        raise ValueError("init must be 'kmeans++' or 'random'")
    if not 1 <= max_iter <= 100000:
        raise ValueError("max_iter must be from 1 to 100000")
    if not 1 <= n_init <= MAX_RESTARTS:
        raise ValueError(f"n_init must be from 1 to {MAX_RESTARTS}")
    if seed < 0:
        raise ValueError("seed must be a non-negative whole number")
    arr = check_matrix(x, min_rows=k)
    if len(np.unique(arr, axis=0)) < k:
        raise ValueError(f"fewer than {k} distinct rows: {k} clusters cannot all be non-empty")
    z, shift, scale = standardize_columns(arr, standardize)
    given: NDArray[np.float64] | None = None
    if initial_centers is not None:
        given = _check_given(initial_centers, k, arr.shape[1], shift, scale)
        init, n_init = "given", 1

    best: tuple[float, NDArray[np.intp], int, bool, int] | None = None
    for r in range(n_init):
        rng = np.random.default_rng([seed, r])
        start = given if given is not None else _start(z, k, init, rng)
        labels, centers, iters, ok = _lloyd(z, start, max_iter)
        inertia = float(((z - centers[labels]) ** 2).sum())
        if best is None or inertia < best[0]:
            best = (inertia, labels, iters, ok, r)
    assert best is not None
    _, raw, iters, converged, best_restart = best

    cent_orig = np.vstack([arr[raw == c].mean(axis=0) for c in range(k)])
    # lexicographic: first column, then the next; given centres keep the order they were typed in
    order = np.arange(k) if given is not None else np.lexsort(cent_orig.T[::-1])
    rank = np.empty(k, dtype=np.intp)
    rank[order] = np.arange(k)
    labels = rank[raw]
    centroids = cent_orig[order]
    cent_z = np.vstack([z[labels == c].mean(axis=0) for c in range(k)])
    counts = np.bincount(labels, minlength=k)
    wcss = ((z - cent_z[labels]) ** 2).sum(axis=1)
    wcss_c = np.bincount(labels, weights=wcss, minlength=k)
    wcss_o = ((arr - centroids[labels]) ** 2).sum(axis=1)
    tss = float(((z - z.mean(axis=0)) ** 2).sum())

    sil: NDArray[np.float64] | None = None
    if len(arr) <= SILHOUETTE_MAX_ROWS:
        sil = silhouette(z, labels, k)
    return {
        "k": int(k),
        "n": int(len(arr)),
        "p": int(arr.shape[1]),
        "standardize": standardize,
        "init": init,
        "seed": int(seed),
        "max_iter": int(max_iter),
        "n_init": int(n_init),
        "iterations": int(iters),
        "converged": bool(converged),
        "best_restart": int(best_restart) + 1,
        "labels": (labels + 1).tolist(),
        "centroids": centroids.tolist(),
        "centroids_scaled": cent_z.tolist(),
        "counts": counts.tolist(),
        "wcss_by_cluster": wcss_c.tolist(),
        "total_wcss": float(wcss_c.sum()),
        "between_ss": float(tss - wcss_c.sum()),
        "total_ss": tss,
        "wcss_original": float(wcss_o.sum()),
        "silhouette": None if sil is None else float(sil.mean()),
        "silhouette_by_cluster": None
        if sil is None
        else [float(sil[labels == c].mean()) for c in range(k)],
        "silhouette_points": None if sil is None else sil.tolist(),
        "silhouette_note": None
        if sil is not None
        else f"not computed above {SILHOUETTE_MAX_ROWS} rows",
    }
