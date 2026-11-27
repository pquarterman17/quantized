"""Dendrogram geometry from a SciPy linkage matrix (pure numpy).

Own layout, not ``scipy.cluster.hierarchy.dendrogram``: that function emits its
links in recursion order, so a link cannot be tied back to the merge (and so to
the cluster) it belongs to. Here leaf ``i`` of the left-to-right order sits at
``x = i`` and merge ``m`` (node ``n + m``) at the mean of its two children, at
height ``Z[m, 2]``. Every merge is one U-shaped link
``(xa, ya) -> (xa, h) -> (xb, h) -> (xb, yb)``.

A link is coloured by the cluster number when every leaf under it is in one
cluster, and 0 ("above the cut") otherwise. The screen view
(``cluster/dendrogramModel.ts``) and the matplotlib export
(``figure_dendrogram.py``) both draw exactly this geometry; the shared wire
fixture ``tests/fixtures/wire/dendrogram.json`` pins them to it.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.cluster.hierarchy import leaves_list


def dendrogram_geometry(
    z: NDArray[np.float64], labels: NDArray[np.intp], cut: float
) -> dict[str, Any]:
    """Segments, leaf order and cut height for linkage ``z`` and cluster ``labels`` (1-based)."""
    n = z.shape[0] + 1
    order = [int(i) for i in leaves_list(z)]
    xpos = np.empty(2 * n - 1)
    height = np.zeros(2 * n - 1)
    node_cluster = np.zeros(2 * n - 1, dtype=np.intp)
    for rank, leaf in enumerate(order):
        xpos[leaf] = rank
        node_cluster[leaf] = labels[leaf]
    segments: list[dict[str, Any]] = []
    for m in range(n - 1):
        a, b, h = int(z[m, 0]), int(z[m, 1]), float(z[m, 2])
        node = n + m
        xpos[node] = (xpos[a] + xpos[b]) / 2.0
        height[node] = h
        ca, cb = int(node_cluster[a]), int(node_cluster[b])
        node_cluster[node] = ca if ca == cb else 0
        segments.append(
            {
                "x": [float(xpos[a]), float(xpos[a]), float(xpos[b]), float(xpos[b])],
                "y": [float(height[a]), h, h, float(height[b])],
                "cluster": int(node_cluster[node]),
            }
        )
    return {
        "n_leaves": n,
        "leaf_order": order,
        "leaf_cluster": [int(labels[i]) for i in order],
        "segments": segments,
        "cut": float(cut),
        "max_height": float(z[-1, 2]),
    }
