"""Hierarchical (agglomerative) clustering (ORIGIN_FEATURE_GAP_PLAN item 11, J13).

``scipy.cluster.hierarchy`` does the work: ``pdist`` -> ``linkage`` ->
``fcluster`` / ``cophenet``. Options:

* method: single, complete, average, ward;
* metric: euclidean, sqeuclidean (squared Euclidean), cityblock, cosine
  (1 - cos of the angle between two rows), correlation (1 - Pearson r between
  rows); Ward is defined only for Euclidean distances (it minimises a sum of
  squares, as in SciPy) and is refused with that reason for any other metric.
  A cut distance is in the units of the chosen metric (squared units for
  sqeuclidean);
* cut: a number of clusters ``k``, or a distance ``cut_distance``
  (clusters whose merge height is <= the distance stay together).

Cluster numbers follow the left-to-right leaf order of the dendrogram (the
first cluster met from the left is 1). A cut by ``k`` is refused when tied
merge heights make exactly ``k`` clusters impossible (cut by distance instead).

Fail closed: non-numeric, NaN rows, fewer than 3 rows, constant columns under
scaling, and (for correlation) rows with no variation are refused.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.cluster.hierarchy import cophenet, fcluster, leaves_list, linkage
from scipy.spatial.distance import pdist

from quantized.calc.stats_cluster_common import check_matrix, standardize_columns
from quantized.calc.stats_cluster_dendrogram import dendrogram_geometry

METHODS = ("single", "complete", "average", "ward")
METRICS = ("euclidean", "sqeuclidean", "cityblock", "cosine", "correlation")


def _renumber(raw: NDArray[np.intp], order: list[int]) -> NDArray[np.intp]:
    """Cluster numbers 1.. by first appearance along the dendrogram's leaf order."""
    new = np.zeros_like(raw)
    seen: dict[int, int] = {}
    for leaf in order:
        c = int(raw[leaf])
        if c not in seen:
            seen[c] = len(seen) + 1
        new[leaf] = seen[c]
    return new


def hierarchical_cluster(
    x: object,
    *,
    method: str = "average",
    metric: str = "euclidean",
    standardize: str = "zscore",
    k: int | None = None,
    cut_distance: float | None = None,
) -> dict[str, Any]:
    """Cluster the rows of ``x``. Give exactly one of ``k`` and ``cut_distance``."""
    if method not in METHODS:
        raise ValueError(f"method must be one of {list(METHODS)}")
    if metric not in METRICS:
        raise ValueError(f"metric must be one of {list(METRICS)}")
    if method == "ward" and metric != "euclidean":
        raise ValueError(
            "Ward linkage is defined only for Euclidean distances (it minimises a sum of "
            f"squares), not {metric}: choose Euclidean, or single, complete or average linkage"
        )
    if (k is None) == (cut_distance is None):
        raise ValueError("give exactly one of k (number of clusters) and cut_distance")
    arr = check_matrix(x, min_rows=3)
    n, p = arr.shape
    if metric == "correlation":
        if p < 2:
            raise ValueError("correlation distance needs at least 2 columns")
        if np.any(np.ptp(arr, axis=1) == 0):
            raise ValueError(
                "a row with identical values in every column has no defined correlation distance"
            )
    if k is not None and (isinstance(k, bool) or not 1 <= k <= n):
        raise ValueError(f"k must be a whole number from 1 to the {n} rows")
    if cut_distance is not None and not (np.isfinite(cut_distance) and cut_distance >= 0):
        raise ValueError("cut_distance must be a finite, non-negative number")
    zs, _, _ = standardize_columns(arr, standardize)
    if metric == "cosine" and np.any(~zs.any(axis=1)):
        raise ValueError(
            "a row of all zeros (after scaling) has no defined cosine distance; "
            "use another distance or scaling 'none' on non-centred data"
        )
    dist = pdist(zs, metric=metric)
    if not np.all(np.isfinite(dist)):
        raise ValueError("some pairwise distances are not finite; check the columns and scaling")
    out = cut_linkage(dist, n, method=method, metric=metric, k=k, cut_distance=cut_distance)
    labels = np.asarray(out["labels"], dtype=np.intp)
    out.update(p=int(p), standardize=standardize, **_cluster_stats(arr, zs, labels))
    return out


def _cluster_stats(
    arr: NDArray[np.float64], zs: NDArray[np.float64], labels: NDArray[np.intp]
) -> dict[str, Any]:
    """Centroids (original units) and within sums of squares (scaled space) per cluster."""
    ks = range(1, int(labels.max()) + 1)
    cent = np.vstack([arr[labels == c].mean(axis=0) for c in ks])
    wcss = [float(((zs[labels == c] - zs[labels == c].mean(axis=0)) ** 2).sum()) for c in ks]
    return {"centroids": cent.tolist(), "wcss_by_cluster": wcss, "total_wcss": float(sum(wcss))}


def cut_linkage(
    dist: NDArray[np.float64],
    n: int,
    *,
    method: str,
    metric: str,
    k: int | None,
    cut_distance: float | None,
) -> dict[str, Any]:
    """Link the condensed distances ``dist`` of ``n`` items and cut the tree.

    Shared by the row and the variable clustering; ``metric`` is only recorded
    (the distances are already computed).
    """
    zmat = np.asarray(linkage(dist, method=method), dtype=float)
    coph_r, _ = cophenet(zmat, dist)

    if k is not None:
        raw = np.asarray(fcluster(zmat, t=k, criterion="maxclust"), dtype=np.intp)
        if int(raw.max()) != k:
            raise ValueError(
                f"tied merge heights make exactly {k} clusters impossible "
                f"(the cut gives {int(raw.max())}); cut by distance instead"
            )
        cut = (
            float(zmat[n - k - 1, 2] + zmat[n - k, 2]) / 2.0
            if 1 < k < n
            else (float(zmat[-1, 2]) * 1.05 if k == 1 else float(zmat[0, 2]) / 2.0)
        )
    else:
        assert cut_distance is not None
        raw = np.asarray(fcluster(zmat, t=cut_distance, criterion="distance"), dtype=np.intp)
        cut = float(cut_distance)
    order = [int(i) for i in leaves_list(zmat)]
    labels = _renumber(raw, order)
    counts = np.bincount(labels)[1:]
    return {
        "n": int(n),
        "method": method,
        "metric": metric,
        "cut_by": "k" if k is not None else "distance",
        "k": int(labels.max()),
        "cut_distance": cut,
        "labels": labels.tolist(),
        "counts": counts.tolist(),
        "linkage": zmat.tolist(),
        "cophenetic_correlation": float(coph_r) if np.isfinite(coph_r) else None,
        "dendrogram": dendrogram_geometry(zmat, labels, cut),
    }
