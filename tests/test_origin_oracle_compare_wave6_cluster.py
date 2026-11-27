"""Origin's kmeans and hierarchical clustering, frozen in wave 6.

quantized has no clustering module yet, so these tests pin what a quantized
implementation must reproduce, using numpy / scipy as the reference and
Origin's frozen report as the truth. The conventions are also written into
each fixture's ``truth.json`` (``conventions``). Skips without the corpus.
Measured on OriginPro 2026b (10.35).
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import pdist, squareform

from _origin_oracle_fixture import OracleFixture, load_fixture
from _origin_oracle_sheets import named, numeric, sheet_columns, trimmed

pytestmark = pytest.mark.realdata


def _x(fx: OracleFixture, n_vars: int) -> np.ndarray:
    c = fx.input_columns()
    return np.column_stack([c[f"v{i}"] for i in range(1, n_vars + 1)])


def _standardise(x: np.ndarray, how: str) -> np.ndarray:
    if how == "snd":
        return (x - x.mean(0)) / x.std(0, ddof=1)
    if how == "range":
        return (x - x.min(0)) / (x.max(0) - x.min(0))
    return x


def _lloyd(x: np.ndarray, centres: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    c = centres.copy()
    lab = np.zeros(len(x), dtype=int)
    for _ in range(1000):
        lab = ((x[:, None, :] - c[None]) ** 2).sum(2).argmin(1)
        nxt = np.array([x[lab == j].mean(0) for j in range(len(c))])
        if np.array_equal(nxt, c):
            break
        c = nxt
    return lab, c


def _km(fx: OracleFixture, step: int, k: int) -> dict[str, np.ndarray]:
    rep = sheet_columns(fx, f"Cluster{step}")
    mem = sheet_columns(fx, f"Cluster Membership{step}")
    # columns 9-12 initial centres, 13-16 final centres (rows = clusters)
    init = np.array([numeric(rep[9 + j][1], k) for j in range(4)]).T
    fin = np.array([numeric(rep[13 + j][1], k) for j in range(4)]).T
    return {
        "init": init,
        "final": fin,
        "labels": numeric(mem[0][1]).astype(int) - 1,
        "dist": numeric(mem[1][1]) if len(mem) > 1 else np.array([]),
        "wss": numeric(named(rep, "Within Cluster Sum of Square"), k),
    }


@pytest.mark.parametrize("step,how", [(1, "none"), (2, "snd"), (3, "range")])
def test_kmeans_is_lloyd_in_the_standardised_space(step: int, how: str) -> None:
    """From Origin's own initial centres, plain Lloyd iteration reproduces its
    labels and final centres exactly; centres, distances and WSS live in the
    standardised space (z scores use ddof=1, range is min-max)."""
    fx = load_fixture("kmeans_default_init")
    z = _standardise(_x(fx, 4), how)
    r = _km(fx, step, 3)
    labels, centres = _lloyd(z, r["init"])
    np.testing.assert_array_equal(labels, r["labels"])
    np.testing.assert_allclose(centres, r["final"], rtol=1e-12, atol=1e-12)
    dist = np.sqrt(((z - r["final"][r["labels"]]) ** 2).sum(1))
    np.testing.assert_allclose(dist, r["dist"], rtol=1e-12, atol=1e-12)
    wss = [((z[r["labels"] == j] - r["final"][j]) ** 2).sum() for j in range(3)]
    np.testing.assert_allclose(wss, r["wss"], rtol=1e-12)


@pytest.mark.parametrize(
    "case,step,k",
    [
        ("kmeans_default_init", 1, 3),
        ("kmeans_default_init", 2, 3),
        ("kmeans_default_init", 3, 3),
        ("kmeans_init_rule", 1, 2),
        ("kmeans_init_rule", 2, 4),
        ("kmeans_init_rule", 3, 5),
    ],
)
def test_kmeans_initial_centres_are_data_rows(case: str, step: int, k: int) -> None:
    """Origin's default initial centres are exact observations (of the
    standardised data) and the run is deterministic. The selection rule is
    NOT pinned (see conventions); match Origin with explicit centres."""
    fx = load_fixture(case)
    how = ["none", "snd", "range"][step - 1] if case == "kmeans_default_init" else "none"
    z = _standardise(_x(fx, 4), how)
    init = _km(fx, step, k)["init"]
    rows = [int(np.abs(z - r).max(1).argmin()) for r in init]
    assert len(set(rows)) == k
    for row, r in zip(rows, init, strict=True):
        np.testing.assert_allclose(z[row], r, rtol=0, atol=1e-12)


def test_kmeans_specified_centres_reproduce_exactly() -> None:
    """With ``specify:=1`` the initial centres are the ones given, and numpy
    Lloyd from them reproduces every iteration setting (2, 10, 100)."""
    fx = load_fixture("kmeans_specified_init")
    c = fx.input_columns()
    x = _x(fx, 4)
    init = np.column_stack([c[f"c{i}"][:3] for i in range(1, 5)])
    labels, centres = _lloyd(x, init)
    for step in (1, 2, 3):
        r = _km(fx, step, 3)
        np.testing.assert_allclose(r["init"], init, rtol=0, atol=0)
        np.testing.assert_array_equal(r["labels"], labels)
        np.testing.assert_allclose(r["final"], centres, rtol=1e-12, atol=1e-12)


# --- hierarchical ----------------------------------------------------------


def _lance_williams(d: np.ndarray, method: str) -> np.ndarray:
    """Origin's ward / centroid / median: the Lance-Williams recurrence applied
    to UNSQUARED distances, height = the updated distance (no sqrt)."""
    n = len(d)
    dm = d.astype(float).copy()
    np.fill_diagonal(dm, np.inf)
    size = dict.fromkeys(range(n), 1)
    active = list(range(n))
    heights = []
    while len(active) > 1:
        h, i, j = min((dm[a, b], a, b) for a in active for b in active if a < b)
        heights.append(h)
        ni, nj = size[i], size[j]
        for k in active:
            if k in (i, j):
                continue
            nk = size[k]
            if method == "ward":
                new = ((ni + nk) * dm[i, k] + (nj + nk) * dm[j, k] - nk * h) / (ni + nj + nk)
            elif method == "centroid":
                new = (ni * dm[i, k] + nj * dm[j, k]) / (ni + nj) - ni * nj * h / (ni + nj) ** 2
            else:
                new = (dm[i, k] + dm[j, k]) / 2 - h / 4
            dm[i, k] = dm[k, i] = new
        size[i] = ni + nj
        active.remove(j)
        dm[j, :] = np.inf
        dm[:, j] = np.inf
    return np.array(heights)


def _heights(fx: OracleFixture, step: int) -> np.ndarray:
    return trimmed(named(sheet_columns(fx, f"Cluster{step}"), "Distance"))


def _labels(fx: OracleFixture, step: int) -> np.ndarray:
    return numeric(sheet_columns(fx, f"Cluster Membership{step}")[0][1]).astype(int)


@pytest.mark.parametrize("step,method", [(1, "single"), (2, "complete"), (3, "average")])
def test_hcluster_single_complete_average_equal_scipy(step: int, method: str) -> None:
    fx = load_fixture("hcluster_linkage")
    z = linkage(_x(fx, 3), method)
    np.testing.assert_allclose(_heights(fx, step), z[:, 2], rtol=1e-12)
    ours = fcluster(z, 3, "maxclust")
    assert len(set(zip(_labels(fx, step), ours, strict=True))) == 3  # same partition


@pytest.mark.parametrize("step,method", [(4, "centroid"), (5, "median"), (6, "ward")])
def test_hcluster_ward_centroid_median_use_unsquared_lance_williams(
    step: int, method: str
) -> None:
    """Not scipy: Origin updates unsquared Euclidean distances. The recurrence
    reproduces the merge heights to rounding; scipy's differ by far more."""
    fx = load_fixture("hcluster_linkage")
    x = _x(fx, 3)
    np.testing.assert_allclose(
        _heights(fx, step),
        _lance_williams(squareform(pdist(x)), method),
        rtol=1e-12,
        atol=1e-12,
    )
    assert np.abs(_heights(fx, step) - linkage(x, method)[:, 2]).max() > 1.0


def test_hcluster_labels_number_clusters_by_first_appearance() -> None:
    fx = load_fixture("hcluster_linkage")
    for step in range(1, 7):
        first = list(dict.fromkeys(_labels(fx, step).tolist()))
        assert first == sorted(first)


def _matrix(fx: OracleFixture, step: int, n: int) -> np.ndarray:
    rep = sheet_columns(fx, f"Cluster{step}")
    names = {str(i) for i in range(1, n + 1)}
    return np.column_stack([numeric(v, n) for name, v in rep if name in names])


@pytest.mark.parametrize(
    "step,metric",
    [
        (1, "euclidean"),
        (2, "sqeuclidean"),
        (3, "cityblock"),
        (4, "cosine"),
        (5, "correlation"),
    ],
)
def test_hcluster_distances_equal_scipy_pdist(step: int, metric: str) -> None:
    fx = load_fixture("hcluster_distance")
    x = _x(fx, 3)
    np.testing.assert_allclose(
        _matrix(fx, step, len(x)), squareform(pdist(x, metric)), rtol=1e-12, atol=1e-12
    )
    np.testing.assert_allclose(
        _heights(fx, step), linkage(pdist(x, metric), "average")[:, 2], rtol=1e-10
    )


def test_hcluster_jaccard_on_continuous_data_is_all_ones() -> None:
    fx = load_fixture("hcluster_distance")
    n = len(_x(fx, 3))
    np.testing.assert_array_equal(_matrix(fx, 6, n), 1.0 - np.eye(n))


@pytest.mark.parametrize("step,how", [(1, "none"), (2, "snd"), (3, "range")])
def test_hcluster_standardises_before_the_distance(step: int, how: str) -> None:
    fx = load_fixture("hcluster_standardise")
    z = _standardise(_x(fx, 3), how)
    np.testing.assert_allclose(
        _heights(fx, step),
        _lance_williams(squareform(pdist(z)), "ward"),
        rtol=1e-12,
        atol=1e-12,
    )
    lab = _labels(fx, step)
    rep = sheet_columns(fx, f"Cluster{step}")
    cen = np.array([numeric(v, 3) for name, v in rep if name in ("v1", "v2", "v3")][-3:]).T
    expect = np.array([z[lab == j].mean(0) for j in (1, 2, 3)])
    np.testing.assert_allclose(cen, expect, rtol=1e-12, atol=1e-12)


@pytest.mark.parametrize("step,absolute", [(1, False), (2, True)])
def test_hcluster_variables_use_correlation_distance(step: int, absolute: bool) -> None:
    fx = load_fixture("hcluster_variables")
    r = np.corrcoef(_x(fx, 4).T)
    expect = 1.0 - (np.abs(r) if absolute else r)
    rep = sheet_columns(fx, f"Cluster{step}")
    m = np.column_stack([numeric(v, 4) for _, v in rep[14:18]])
    np.testing.assert_allclose(m, expect, rtol=1e-12, atol=1e-12)
    np.testing.assert_allclose(
        _heights(fx, step), linkage(squareform(m, checks=False), "average")[:, 2], rtol=1e-12
    )


def test_hcluster_variables_corr_and_abs_give_different_trees() -> None:
    """The fixture exists to tell 1 - r from 1 - |r|: v3 is anti-correlated
    with v1, so only the absolute form joins them."""
    fx = load_fixture("hcluster_variables")
    corr = numeric(sheet_columns(fx, "Cluster Membership1")[1][1], 4)
    absolute = numeric(sheet_columns(fx, "Cluster Membership2")[1][1], 4)
    assert corr[0] == corr[1] != corr[2]
    assert absolute[0] == absolute[1] == absolute[2] != absolute[3]
