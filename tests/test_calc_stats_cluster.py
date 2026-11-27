"""k-means and hierarchical clustering (ORIGIN_FEATURE_GAP_PLAN item 11, J13).

Oracles: scikit-learn ``KMeans`` / ``silhouette_score`` (dev group only) on
well-separated blobs, scipy's own ``linkage`` / ``fcluster`` / ``cophenet``,
and hand-checkable cases. Labels are compared up to a permutation.
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy.cluster.hierarchy import cophenet, fcluster, linkage
from scipy.spatial.distance import pdist

from quantized.calc.stats_cluster_common import check_matrix, standardize_columns
from quantized.calc.stats_cluster_hier import hierarchical_cluster
from quantized.calc.stats_cluster_kmeans import kmeans_cluster, silhouette


def blobs(seed: int = 1, per: int = 20) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return np.vstack(
        [
            rng.normal((0, 0), 0.3, (per, 2)),
            rng.normal((5, 5), 0.3, (per, 2)),
            rng.normal((0, 6), 0.3, (per, 2)),
        ]
    )


def same_partition(a: list[int], b: list[int]) -> bool:
    pairs = {(int(p), int(q)) for p, q in zip(a, b, strict=True)}
    return len(pairs) == len(set(a)) == len(set(b))


# -- k-means ------------------------------------------------------------------


def test_kmeans_recovers_blobs_and_matches_sklearn() -> None:
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    x = blobs()
    r = kmeans_cluster(x, 3, standardize="none", seed=3)
    truth = [0] * 20 + [1] * 20 + [2] * 20
    assert same_partition(r["labels"], truth)
    assert r["counts"] == [20, 20, 20] and r["converged"]
    sk = KMeans(3, n_init=10, random_state=0).fit(x)
    np.testing.assert_allclose(r["total_wcss"], sk.inertia_, rtol=1e-9)
    np.testing.assert_allclose(
        sorted(map(tuple, r["centroids"])), sorted(map(tuple, sk.cluster_centers_)), rtol=1e-9
    )
    np.testing.assert_allclose(r["silhouette"], silhouette_score(x, sk.labels_), rtol=1e-9)
    np.testing.assert_allclose(r["total_wcss"] + r["between_ss"], r["total_ss"], rtol=1e-12)
    np.testing.assert_allclose(sum(r["wcss_by_cluster"]), r["total_wcss"], rtol=1e-12)


def test_kmeans_is_deterministic_for_a_seed_and_labels_ordered_by_centroid() -> None:
    x = blobs(5)
    a, b = kmeans_cluster(x, 3, seed=7), kmeans_cluster(x, 3, seed=7)
    assert a["labels"] == b["labels"]
    np.testing.assert_array_equal(a["centroids"], b["centroids"])
    firsts = [c[0] for c in a["centroids"]]
    assert firsts == sorted(firsts)  # cluster 1 has the smallest first-column centroid


def test_kmeans_centroids_are_in_original_units_under_scaling() -> None:
    x = blobs() * np.array([1.0, 1000.0])
    r = kmeans_cluster(x, 3, standardize="zscore", seed=1)
    for c, cen in enumerate(r["centroids"], start=1):
        np.testing.assert_allclose(cen, x[np.array(r["labels"]) == c].mean(axis=0), rtol=1e-12)
    assert r["wcss_original"] > r["total_wcss"]  # original units are far larger here


@pytest.mark.parametrize("init", ["kmeans++", "random"])
@pytest.mark.parametrize("std", ["none", "zscore", "range"])
def test_kmeans_options_run(init: str, std: str) -> None:
    r = kmeans_cluster(blobs(), 3, standardize=std, init=init, n_init=3)
    assert sum(r["counts"]) == 60 and min(r["counts"]) > 0


def test_kmeans_hand_case() -> None:
    x = [[0.0], [1.0], [10.0], [11.0]]
    r = kmeans_cluster(x, 2, standardize="none")
    assert r["labels"] == [1, 1, 2, 2]
    np.testing.assert_allclose(r["centroids"], [[0.5], [10.5]])
    np.testing.assert_allclose(r["wcss_by_cluster"], [0.5, 0.5])


def test_kmeans_empty_cluster_is_refilled() -> None:
    x = [[0.0], [0.0], [0.0], [5.0], [9.0]]
    for seed in range(8):
        r = kmeans_cluster(x, 3, standardize="none", init="random", seed=seed, n_init=1)
        assert min(r["counts"]) >= 1


def test_silhouette_singleton_scores_zero() -> None:
    z = np.array([[0.0], [0.1], [9.0]])
    s = silhouette(z, np.array([0, 0, 1]), 2)
    assert s[2] == 0.0 and s[0] > 0.9


def test_kmeans_silhouette_skipped_above_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    import quantized.calc.stats_cluster_kmeans as km

    monkeypatch.setattr(km, "SILHOUETTE_MAX_ROWS", 10)
    r = kmeans_cluster(blobs(), 3)
    assert r["silhouette"] is None and "not computed" in r["silhouette_note"]


@pytest.mark.parametrize(
    ("x", "k", "match"),
    [
        ([[1.0, 2.0], [3.0, float("nan")], [4.0, 5.0]], 2, "NaN"),
        ([[1.0], [float("inf")], [4.0]], 2, "NaN or infinite"),
        ([["a"], ["b"], ["c"]], 2, "numeric"),
        ([[1.0], [2.0]], 3, "at least 3 rows"),
        ([[1.0], [1.0], [1.0], [2.0]], 3, "distinct"),
        ([[1.0, 5.0], [2.0, 5.0], [3.0, 5.0]], 2, "constant"),
        ([1.0, 2.0, 3.0], 2, "matrix"),
        ([[1.0], [2.0], [3.0]], 1, "k must be"),
    ],
)
def test_kmeans_refusals(x: object, k: int, match: str) -> None:
    with pytest.raises(ValueError, match=match):
        kmeans_cluster(x, k)


def test_kmeans_bad_options() -> None:
    x = blobs()
    for kw in (
        {"standardize": "bogus"},
        {"init": "bogus"},
        {"max_iter": 0},
        {"n_init": 0},
        {"seed": -1},
    ):
        with pytest.raises(ValueError):
            kmeans_cluster(x, 3, **kw)  # type: ignore[arg-type]


def test_common_scaling() -> None:
    x = np.array([[1.0, 10.0], [2.0, 20.0], [3.0, 60.0]])
    z, _, _ = standardize_columns(x, "zscore")
    np.testing.assert_allclose(z.mean(axis=0), 0, atol=1e-12)
    np.testing.assert_allclose(z.std(axis=0, ddof=1), 1, rtol=1e-12)
    r, _, _ = standardize_columns(x, "range")
    np.testing.assert_allclose([r.min(), r.max()], [0, 1])
    with pytest.raises(ValueError, match="2 rows"):
        standardize_columns(np.array([[1.0]]), "zscore")
    assert check_matrix([[1, 2]], min_rows=1).shape == (1, 2)


# -- hierarchical -------------------------------------------------------------


@pytest.mark.parametrize("method", ["single", "complete", "average", "ward"])
def test_hierarchical_matches_scipy(method: str) -> None:
    x = blobs(2)
    h = hierarchical_cluster(x, method=method, standardize="none", k=3)
    d = pdist(x)
    z = linkage(d, method=method)
    np.testing.assert_allclose(h["linkage"], z, rtol=1e-12)
    np.testing.assert_allclose(h["cophenetic_correlation"], cophenet(z, d)[0], rtol=1e-12)
    assert same_partition(h["labels"], fcluster(z, 3, "maxclust").tolist())
    assert h["counts"] == [20, 20, 20]


@pytest.mark.parametrize("metric", ["euclidean", "cityblock", "correlation"])
def test_hierarchical_metrics(metric: str) -> None:
    x = blobs(3)
    h = hierarchical_cluster(x, method="average", metric=metric, standardize="none", k=2)
    np.testing.assert_allclose(h["linkage"], linkage(pdist(x, metric), "average"), rtol=1e-12)


def test_ward_refuses_non_euclidean_with_reason() -> None:
    for metric in ("cityblock", "correlation"):
        with pytest.raises(ValueError, match="Ward linkage is defined only for Euclidean"):
            hierarchical_cluster(blobs(), method="ward", metric=metric, k=2)


def test_cut_by_distance_and_labels_follow_leaf_order() -> None:
    x = np.array([[0.0], [0.1], [5.0], [5.2], [9.0]])
    h = hierarchical_cluster(x, method="single", standardize="none", cut_distance=1.0)
    assert (
        same_partition(h["labels"], [0, 0, 1, 1, 2])
        and h["cut_by"] == "distance"
        and h["cut_distance"] == 1.0
    )
    firsts: list[int] = []
    for c in h["dendrogram"]["leaf_cluster"]:
        if c not in firsts:
            firsts.append(c)
    assert firsts == [1, 2, 3]  # numbered left to right along the dendrogram
    assert h["k"] == 3


def test_cut_by_k_cut_height_separates_the_merges() -> None:
    x = np.array([[0.0], [0.1], [5.0], [5.2], [9.0]])
    h = hierarchical_cluster(x, method="average", standardize="none", k=3)
    z = np.asarray(h["linkage"])
    assert z[1, 2] < h["cut_distance"] < z[2, 2]
    for k in (1, 5):
        assert hierarchical_cluster(x, method="average", standardize="none", k=k)["k"] == k


def test_tied_heights_refuse_k_cut() -> None:
    x = np.array([[0.0], [1.0], [2.0], [3.0]])
    with pytest.raises(ValueError, match="tied merge heights"):
        hierarchical_cluster(x, method="single", standardize="none", k=3)
    assert hierarchical_cluster(x, method="single", standardize="none", cut_distance=1.0)["k"] == 1


def test_dendrogram_geometry_is_consistent() -> None:
    h = hierarchical_cluster(blobs(), method="ward", k=3)
    g = h["dendrogram"]
    assert g["n_leaves"] == 60 and len(g["segments"]) == 59
    assert sorted(g["leaf_order"]) == list(range(60))
    heights = [max(s["y"]) for s in g["segments"]]
    assert max(heights) == g["max_height"] == h["linkage"][-1][2]
    below = [s for s in g["segments"] if max(s["y"]) <= g["cut"]]
    assert {s["cluster"] for s in below} == {1, 2, 3}
    assert all(s["cluster"] == 0 for s in g["segments"] if max(s["y"]) > g["cut"])
    assert len(below) == 57  # 60 leaves - 3 clusters merges stay below the cut


@pytest.mark.parametrize(
    ("x", "kw", "match"),
    [
        ([[1.0, 2.0], [3.0, float("nan")], [4.0, 5.0]], {"k": 2}, "NaN"),
        ([[1.0], [2.0]], {"k": 2}, "at least 3 rows"),
        ([[1.0], [2.0], [4.0]], {"method": "bogus", "k": 2}, "method"),
        ([[1.0], [2.0], [4.0]], {"metric": "bogus", "k": 2}, "metric"),
        ([[1.0], [2.0], [4.0]], {}, "exactly one"),
        ([[1.0], [2.0], [4.0]], {"k": 2, "cut_distance": 1.0}, "exactly one"),
        ([[1.0], [2.0], [4.0]], {"k": 9}, "k must be"),
        ([[1.0], [2.0], [4.0]], {"cut_distance": -1.0}, "cut_distance"),
        ([[1.0], [2.0], [4.0]], {"metric": "correlation", "k": 2}, "2 columns"),
        (
            [[1.0, 1.0], [2.0, 3.0], [4.0, 9.0]],
            {"metric": "correlation", "k": 2},
            "no defined correlation",
        ),
        ([["a"], ["b"], ["c"]], {"k": 2}, "numeric"),
    ],
)
def test_hierarchical_refusals(x: object, kw: dict[str, object], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        hierarchical_cluster(x, **kw)  # type: ignore[arg-type]


def test_given_initial_centres_are_one_deterministic_run_in_original_units() -> None:
    x = [[0.0, 0.0], [1.0, 0.0], [10.0, 10.0], [11.0, 10.0]]
    r = kmeans_cluster(x, 2, standardize="zscore", initial_centers=[[0.0, 0.0], [11.0, 10.0]])
    assert r["init"] == "given" and r["n_init"] == 1 and r["labels"] == [1, 1, 2, 2]
    np.testing.assert_allclose(r["centroids"], [[0.5, 0.0], [10.5, 10.0]])
    # a start that puts both centres on one side still ends at the same optimum (Lloyd)
    again = kmeans_cluster(x, 2, standardize="zscore", initial_centers=[[0.0, 0.0], [1.0, 0.0]])
    assert again["labels"] == [1, 1, 2, 2]


@pytest.mark.parametrize(
    "centers",
    [
        [[0.0, 0.0]],
        [[0.0, 0.0], [0.0, 0.0]],
        [[0.0, "a"], [1.0, 1.0]],
        [[0.0, float("nan")], [1.0, 1.0]],
    ],
)
def test_bad_initial_centres_are_refused(centers: object) -> None:
    x = [[0.0, 0.0], [1.0, 0.0], [10.0, 10.0], [11.0, 10.0]]
    with pytest.raises(ValueError, match="initial centres"):
        kmeans_cluster(x, 2, standardize="none", initial_centers=centers)
