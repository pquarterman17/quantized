"""Clustering remainders (item 11): given k-means centres, two more distances, variables.

Oracles: scikit-learn ``KMeans(init=<array>, n_init=1)`` and scipy
``kmeans2(minit="matrix")`` started from the SAME centres, a hand Lloyd loop,
scipy ``pdist`` / ``linkage`` for the distances, and columns built with exactly
known pairwise correlations for the variable clustering.
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy.cluster.hierarchy import cophenet, fcluster, linkage
from scipy.cluster.vq import kmeans2
from scipy.spatial.distance import pdist, squareform

from quantized.calc.stats_cluster_hier import hierarchical_cluster
from quantized.calc.stats_cluster_kmeans import kmeans_cluster
from quantized.calc.stats_cluster_vars import variable_cluster


def same_partition(a: list[int], b: list[int]) -> bool:
    pairs = {(int(p), int(q)) for p, q in zip(a, b, strict=True)}
    return len(pairs) == len(set(a)) == len(set(b))


def overlapping(seed: int = 7, n: int = 90) -> np.ndarray:
    """Overlapping clouds: the k-means answer depends on the start."""
    rng = np.random.default_rng(seed)
    centres = np.array([[0, 0, 0], [2.0, 1.0, 0], [1.0, 3.0, 1.0], [3.0, 3.0, 2.0]])
    return np.vstack([rng.normal(c, 1.1, (n // 4, 3)) for c in centres])


def hand_lloyd(z: np.ndarray, start: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    c = start.copy()
    labels = np.full(len(z), -1)
    for _ in range(500):
        new = ((z[:, None, :] - c[None]) ** 2).sum(axis=2).argmin(axis=1)
        if np.array_equal(new, labels):
            break
        labels = new
        c = np.vstack([z[labels == j].mean(axis=0) for j in range(len(c))])
    return labels, c


def _sorted(a: object) -> np.ndarray:
    return np.sort(np.asarray(a), axis=0)


@pytest.mark.parametrize("scaling", ["none", "zscore", "range"])
def test_given_centres_equal_sklearn_scipy_and_hand_lloyd(scaling: str) -> None:
    x = overlapping()
    rows = [0, 30, 50, 80]  # the user picks these rows as the starting centres
    start = x[rows]
    if scaling == "zscore":
        shift, scale = x.mean(axis=0), x.std(axis=0, ddof=1)
    elif scaling == "range":
        shift, scale = x.min(axis=0), np.ptp(x, axis=0)
    else:
        shift, scale = np.zeros(3), np.ones(3)
    z, z0 = (x - shift) / scale, (start - shift) / scale

    got = kmeans_cluster(x, 4, standardize=scaling, initial_centers=start.tolist())
    assert got["init"] == "given" and got["n_init"] == 1

    hl, hc = hand_lloyd(z, z0)
    assert same_partition(got["labels"], (hl + 1).tolist())
    np.testing.assert_allclose(_sorted(got["centroids_scaled"]), _sorted(hc), atol=1e-10)

    centres, lab = kmeans2(z, z0.copy(), iter=300, minit="matrix", missing="raise")
    assert same_partition(got["labels"], (lab + 1).tolist())
    np.testing.assert_allclose(_sorted(got["centroids_scaled"]), _sorted(centres), atol=1e-9)

    sk = pytest.importorskip("sklearn.cluster")
    km = sk.KMeans(n_clusters=4, init=z0, n_init=1, algorithm="lloyd", tol=0, max_iter=300).fit(z)
    assert same_partition(got["labels"], (km.labels_ + 1).tolist())
    np.testing.assert_allclose(got["total_wcss"], km.inertia_, rtol=1e-9)
    np.testing.assert_allclose(
        _sorted(got["centroids_scaled"]), _sorted(km.cluster_centers_), atol=1e-9
    )


def test_each_start_matches_sklearn_from_the_same_start() -> None:
    """The start decides the local optimum, so the centres used are part of the result."""
    sk = pytest.importorskip("sklearn.cluster")
    x = overlapping(seed=3)
    for rows in ([0, 1, 2, 3], [0, 30, 50, 80], [5, 6, 7, 8]):
        got = kmeans_cluster(x, 4, standardize="none", initial_centers=x[rows].tolist())
        km = sk.KMeans(n_clusters=4, init=x[rows], n_init=1, algorithm="lloyd", tol=0).fit(x)
        assert same_partition(got["labels"], (km.labels_ + 1).tolist())


# -- squared Euclidean and cosine ------------------------------------------------


@pytest.mark.parametrize("metric", ["sqeuclidean", "cosine"])
@pytest.mark.parametrize("method", ["single", "complete", "average"])
def test_new_distances_match_scipy(metric: str, method: str) -> None:
    rng = np.random.default_rng(5)
    x = rng.normal(0, 1, (25, 4)) + 3.0
    h = hierarchical_cluster(x, method=method, metric=metric, standardize="none", k=3)
    d = pdist(x, metric)
    z = linkage(d, method=method)
    np.testing.assert_allclose(h["linkage"], z, rtol=1e-12)
    np.testing.assert_allclose(h["cophenetic_correlation"], cophenet(z, d)[0], rtol=1e-12)
    assert h["metric"] == metric


def test_cosine_hand_case_and_sqeuclidean_heights_are_squares() -> None:
    x = [[1.0, 0.0], [2.0, 0.0], [0.0, 3.0], [0.0, 1.0]]
    h = hierarchical_cluster(x, method="single", metric="cosine", standardize="none", k=2)
    assert h["counts"] == [2, 2]
    np.testing.assert_allclose(sorted(row[2] for row in h["linkage"]), [0.0, 0.0, 1.0], atol=1e-12)
    s = hierarchical_cluster(x, method="single", metric="sqeuclidean", standardize="none", k=2)
    e = hierarchical_cluster(x, method="single", metric="euclidean", standardize="none", k=2)
    np.testing.assert_allclose(
        [row[2] for row in s["linkage"]], [row[2] ** 2 for row in e["linkage"]], atol=1e-12
    )


@pytest.mark.parametrize("metric", ["sqeuclidean", "cosine"])
def test_ward_stays_euclidean_only(metric: str) -> None:
    x = overlapping()
    with pytest.raises(ValueError, match="Ward linkage is defined only for Euclidean"):
        hierarchical_cluster(x, method="ward", metric=metric, k=2)
    assert hierarchical_cluster(x, method="ward", metric="euclidean", k=2)["k"] == 2


def test_cosine_refuses_a_zero_row() -> None:
    with pytest.raises(ValueError, match="all zeros"):
        hierarchical_cluster(
            [[0.0, 0.0], [1.0, 2.0], [2.0, 1.0]], metric="cosine", standardize="none", k=2
        )


def test_hierarchical_reports_centroids_and_within_ss() -> None:
    x = overlapping()
    h = hierarchical_cluster(x, method="ward", standardize="zscore", k=3)
    lab = np.asarray(h["labels"])
    z = (x - x.mean(axis=0)) / x.std(axis=0, ddof=1)
    for c in (1, 2, 3):
        np.testing.assert_allclose(h["centroids"][c - 1], x[lab == c].mean(axis=0), rtol=1e-12)
        w = ((z[lab == c] - z[lab == c].mean(axis=0)) ** 2).sum()
        np.testing.assert_allclose(h["wcss_by_cluster"][c - 1], w, rtol=1e-10)
    np.testing.assert_allclose(h["total_wcss"], sum(h["wcss_by_cluster"]), rtol=1e-12)


# -- variable clustering -----------------------------------------------------------


def known_correlation_columns() -> np.ndarray:
    """Four columns with exact correlations r(a,b) = 0.9, r(c,d) = -0.56, all others 0."""
    rng = np.random.default_rng(0)
    m = rng.normal(size=(40, 5))
    m -= m.mean(axis=0)  # centred columns span a centred space, so the QR basis is centred too
    q, _ = np.linalg.qr(m)
    u = q * np.sqrt(39)  # centred, unit sample variance, mutually orthogonal
    a = u[:, 0]
    b = 0.9 * u[:, 0] + np.sqrt(1 - 0.81) * u[:, 1]
    c = u[:, 2]
    d = -0.56 * u[:, 2] + np.sqrt(1 - 0.56**2) * u[:, 3]
    return np.column_stack([a, b, c, d])


def test_the_built_correlation_matrix_is_the_one_intended() -> None:
    r = np.corrcoef(known_correlation_columns(), rowvar=False)
    np.testing.assert_allclose(r[0, 1], 0.9, atol=1e-10)
    np.testing.assert_allclose(r[2, 3], -0.56, atol=1e-10)
    np.testing.assert_allclose([r[0, 2], r[0, 3], r[1, 2], r[1, 3]], 0.0, atol=1e-10)


@pytest.mark.parametrize("method", ["single", "complete", "average"])
@pytest.mark.parametrize("distance", ["abs", "signed"])
def test_variable_clustering_matches_scipy_on_the_correlation_matrix(
    method: str, distance: str
) -> None:
    x = known_correlation_columns()
    r = np.corrcoef(x, rowvar=False)
    out = variable_cluster(x, method=method, distance=distance, k=2)
    d = 1.0 - (np.abs(r) if distance == "abs" else r)
    np.fill_diagonal(d, 0.0)
    cond = squareform(d, checks=False)
    z = linkage(cond, method=method)
    np.testing.assert_allclose(out["linkage"], z, rtol=1e-9, atol=1e-12)
    np.testing.assert_allclose(out["correlation"], r, atol=1e-12)
    np.testing.assert_allclose(out["cophenetic_correlation"], cophenet(z, cond)[0], rtol=1e-9)
    # signed: c and d (r = -0.56) are far apart, so the 2-cluster cut differs from "abs"
    assert same_partition(out["labels"], fcluster(z, 2, "maxclust").tolist())
    if distance == "abs":
        assert same_partition(out["labels"], [1, 1, 2, 2])
    assert out["distance"] == distance and out["n"] == 40 and out["p"] == 4
    assert out["dendrogram"]["n_leaves"] == 4


def test_abs_versus_signed_on_an_anticorrelated_pair() -> None:
    x = known_correlation_columns()
    x = np.column_stack([x[:, 0], -2.0 * x[:, 0] + 1.0, x[:, 2], x[:, 3]])  # r(1, 2) = -1
    ab = variable_cluster(x, method="single", distance="abs", cut_distance=0.5)
    sg = variable_cluster(x, method="single", distance="signed", cut_distance=0.5)
    np.testing.assert_allclose(min(row[2] for row in ab["linkage"]), 0.0, atol=1e-9)
    # signed: the anticorrelated pair is 2 apart, so it never joins below the orthogonal 1
    np.testing.assert_allclose(min(row[2] for row in sg["linkage"]), 1.0, atol=1e-9)
    assert ab["labels"][0] == ab["labels"][1]
    assert sg["k"] == 4 and ab["k"] == 2  # abs also joins c,d (|r| = 0.56 < 0.5 apart)


def test_variable_cut_by_distance_uses_the_known_heights() -> None:
    x = known_correlation_columns()  # a-b join at 1 - 0.9 = 0.1, c-d at 1 - 0.56 = 0.44
    two = variable_cluster(x, method="average", distance="abs", cut_distance=0.5)
    assert two["k"] == 2 and two["counts"] == [2, 2]
    three = variable_cluster(x, method="average", distance="abs", cut_distance=0.2)
    assert three["k"] == 3
    np.testing.assert_allclose(sorted(r[2] for r in two["linkage"])[:2], [0.1, 0.44], atol=1e-9)


GOOD = [[1, 2, 3], [2, 3, 5], [3, 5, 4], [4, 4, 8]]


@pytest.mark.parametrize(
    ("x", "kw", "match"),
    [
        (GOOD, {"method": "ward", "k": 2}, "Ward linkage"),
        ([[1, 2], [2, 3], [3, 5], [4, 4]], {"k": 2}, "at least 3 columns"),
        ([[1, 2, 3], [2, 3, 5]], {"k": 2}, "at least 3 rows"),
        ([[1, 2, 7], [2, 3, 7], [3, 5, 7], [4, 4, 7]], {"k": 2}, "constant"),
        ([[1, 2, 3], [2, 3, 5], [3, 5, 4], [4, 4, float("nan")]], {"k": 2}, "NaN"),
        (GOOD, {}, "exactly one"),
        (GOOD, {"k": 9}, "k must be"),
        (GOOD, {"k": 2, "distance": "x"}, "distance must"),
    ],
)
def test_variable_refusals(x: object, kw: dict[str, object], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        variable_cluster(x, **kw)  # type: ignore[arg-type]
