"""Variable clustering: hierarchical clustering of the COLUMNS (as Origin and JMP offer).

The distance between two variables comes from their Pearson correlation ``r``:

* ``abs``    ``1 - |r|``: a strongly negative pair is as close as a strongly
  positive one (the variables carry the same information up to sign);
* ``signed`` ``1 - r``: an anti-correlated pair is far apart.

``scipy.cluster.hierarchy.linkage`` joins the variables on that distance
(single, complete or average; Ward is refused because ``1 - |r|`` and ``1 - r``
are not Euclidean distances). A correlation is scale-free, so there is no
scaling option. The tree is cut by a number of clusters or a distance and the
result has the same shape as ``hierarchical_cluster`` (labels are per variable,
the dendrogram leaves are the variables), plus the correlation matrix.

Fail closed: non-numeric data, NaN rows, fewer than 3 variables or 3 rows, and
a constant variable (its correlation is undefined) are refused with a reason.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy.spatial.distance import squareform

from quantized.calc.stats_cluster_common import check_matrix
from quantized.calc.stats_cluster_hier import cut_linkage

VAR_METHODS = ("single", "complete", "average")
VAR_DISTANCES = ("abs", "signed")


def variable_cluster(
    x: object,
    *,
    method: str = "average",
    distance: str = "abs",
    k: int | None = None,
    cut_distance: float | None = None,
) -> dict[str, Any]:
    """Cluster the columns of ``x``. Give exactly one of ``k`` and ``cut_distance``."""
    if method == "ward":
        raise ValueError(
            "Ward linkage is defined only for Euclidean distances, and 1 - |r| / 1 - r is not "
            "one: choose single, complete or average linkage for variables"
        )
    if method not in VAR_METHODS:
        raise ValueError(f"method must be one of {list(VAR_METHODS)}")
    if distance not in VAR_DISTANCES:
        raise ValueError(f"distance must be one of {list(VAR_DISTANCES)}")
    if (k is None) == (cut_distance is None):
        raise ValueError("give exactly one of k (number of clusters) and cut_distance")
    arr = check_matrix(x, min_rows=3)
    p = arr.shape[1]
    if p < 3:
        raise ValueError("variable clustering needs at least 3 columns")
    if k is not None and (isinstance(k, bool) or not 1 <= k <= p):
        raise ValueError(f"k must be a whole number from 1 to the {p} variables")
    if cut_distance is not None and not (np.isfinite(cut_distance) and cut_distance >= 0):
        raise ValueError("cut_distance must be a finite, non-negative number")
    flat = np.flatnonzero(np.ptp(arr, axis=0) == 0)
    if flat.size:
        cols = ", ".join(str(int(j) + 1) for j in flat)
        raise ValueError(
            f"column(s) {cols} are constant: their correlation is undefined; drop them"
        )
    r = np.corrcoef(arr, rowvar=False)
    r = np.clip((r + r.T) / 2.0, -1.0, 1.0)
    np.fill_diagonal(r, 1.0)
    d = 1.0 - (np.abs(r) if distance == "abs" else r)
    np.fill_diagonal(d, 0.0)
    d = np.maximum(d, 0.0)
    out = cut_linkage(
        squareform(d, checks=False),
        p,
        method=method,
        metric=distance,
        k=k,
        cut_distance=cut_distance,
    )
    out["distance"] = out.pop("metric")
    out.update(n=int(arr.shape[0]), p=int(p), correlation=r.tolist())
    return out
