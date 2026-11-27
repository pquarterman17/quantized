"""k-means and hierarchical clustering against OriginPro's own answers (wave-6 fixtures).

``kmeans`` (cases ``kmeans_*``) and ``hcluster`` (cases ``hcluster_*``) from
``../test-data/origin/analysis_oracle``; skipped without the corpus. Numbers are
measured on OriginPro 2026b (10.35). Labels are compared up to a permutation of
the cluster numbers; centroids, sums of squares and linkage heights with a
tolerance. Conventions found by measuring (none are a defect on either side):

* k-means: Origin starts from rows it picks itself (sheet columns J-M, in the
  scaled space for ``std:=snd`` / ``range``) or from user-specified centres.
  quantized's random starts can land in a different local optimum, so these
  tests start Lloyd from Origin's own starting centres (``initial_centers``).
  Origin's ``snd`` is the z-score with the sample (n - 1) deviation, ``range``
  is (x - min) / (max - min); its within sums of squares are in the scaled space.
* hcluster: ``near`` = single, ``furth`` = complete, ``group`` = average linkage;
  heights agree to rounding for Euclidean, city-block and correlation distance.
  Ward differs: Origin applies the Lance-Williams Ward update to UNSQUARED
  distances, so its heights match SciPy's true Ward only up to the first merge
  of two non-singleton clusters (the partition is the same here). quantized
  keeps SciPy's Ward; the Origin recurrence is pinned below by a small
  reference loop so the difference is measured, not assumed.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np
import pytest
from scipy.cluster.hierarchy import linkage
from scipy.spatial.distance import pdist, squareform

from _origin_oracle_fixture import OracleFixture, load_fixture
from quantized.calc.stats_cluster_common import standardize_columns
from quantized.calc.stats_cluster_hier import hierarchical_cluster
from quantized.calc.stats_cluster_kmeans import kmeans_cluster

pytestmark = pytest.mark.realdata

STD = {"none": "none", "snd": "zscore", "range": "range"}


def _one(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):  # header text, blank cells
        return float("nan")


def _num(values: list[Any]) -> np.ndarray:
    return np.array([_one(v) for v in values], dtype=float)


def _sheet(fx: OracleFixture, index: int) -> dict[str, np.ndarray]:
    sheet = fx.oracle["books"][0]["sheets"][index]
    return {c["short"]: _num(c["values"]) for c in sheet["columns"]}


def _long(fx: OracleFixture, index: int, name: str) -> np.ndarray:
    sheet = fx.oracle["books"][0]["sheets"][index]
    return _num(next(c for c in sheet["columns"] if c["long"] == name)["values"])


def _input(fx: OracleFixture, n_cols: int) -> np.ndarray:
    cols = list(fx.input_columns().values())[:n_cols]
    x = np.column_stack(cols)
    return x[~np.isnan(x).any(axis=1)]


def _same_partition(a: np.ndarray, b: np.ndarray) -> bool:
    pairs = {(int(p), int(q)) for p, q in zip(a, b, strict=True)}
    return len(pairs) == len(set(a.tolist())) == len(set(b.tolist()))


# -- k-means --------------------------------------------------------------------


def _scaling(mode: str, x: np.ndarray, s: dict[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    if mode == "snd":
        return s["F"], s["G"]  # Origin's own mean and standard deviation columns
    if mode == "range":
        return x.min(axis=0), x.max(axis=0) - x.min(axis=0)
    return np.zeros(x.shape[1]), np.ones(x.shape[1])


def _run_kmeans(case: str, i: int) -> None:
    fx = load_fixture(case)
    cmd = fx.oracle["labtalk"][i]
    mode = re.search(r"std:=(\w+)", cmd).group(1)  # type: ignore[union-attr]
    s = _sheet(fx, 2 * i)
    mem = _sheet(fx, 2 * i + 1)["A"].astype(int)
    k = int(np.sum(~np.isnan(s["R"])))
    x = _input(fx, 4)
    shift, scale = _scaling(mode, x, s)
    init = np.column_stack([s[c][:k] for c in "JKLM"]) * scale + shift
    r = kmeans_cluster(x, k, standardize=STD[mode], initial_centers=init)

    labels = np.array(r["labels"])
    assert _same_partition(labels, mem), "different partition"
    assert sorted(r["counts"]) == sorted(s["R"][:k].astype(int).tolist())
    np.testing.assert_allclose(r["total_wcss"], np.nansum(s["S"]), rtol=1e-8)
    centres = np.column_stack([s[c][:k] for c in "NOPQ"]) * scale + shift
    for j in range(1, k + 1):
        mine = np.array(r["centroids"])[labels[mem == j][0] - 1]
        np.testing.assert_allclose(mine, centres[j - 1], rtol=1e-8, atol=1e-8)


@pytest.mark.parametrize("i", [0, 1, 2], ids=["none", "snd", "range"])
def test_kmeans_default_start_k3(i: int) -> None:
    _run_kmeans("kmeans_default_init", i)


@pytest.mark.parametrize("i", [0, 1], ids=["k2", "k4"])
def test_kmeans_default_start_k2_k4(i: int) -> None:
    _run_kmeans("kmeans_init_rule", i)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "unresolved (cause not established): Origin's final 5-cluster partition (within SS "
        "about 42,580) is not the Lloyd fixed point of its own starting centres (quantized "
        "reaches about 42,691); k = 2, 3 and 4 from the same kind of start match exactly"
    ),
)
def test_kmeans_default_start_k5() -> None:
    _run_kmeans("kmeans_init_rule", 2)


@pytest.mark.parametrize("i", [0, 1, 2], ids=["iter2", "iter10", "iter100"])
def test_kmeans_specified_start(i: int) -> None:
    fx = load_fixture("kmeans_specified_init")
    cols = list(fx.input_columns().values())
    start = np.column_stack(cols[4:8])
    start = start[~np.isnan(start).any(axis=1)]
    s = _sheet(fx, 2 * i)
    # Origin's own starting-centre block must be the centres the harness specified.
    np.testing.assert_allclose(np.column_stack([s[c][:3] for c in "JKLM"]), start, rtol=1e-12)
    _run_kmeans("kmeans_specified_init", i)


# -- hierarchical ---------------------------------------------------------------


def _check_hcluster(fx: OracleFixture, i: int, x: np.ndarray, **kw: Any) -> np.ndarray:
    h = hierarchical_cluster(x, **kw)
    origin = _long(fx, 2 * i, "Distance")
    origin = origin[~np.isnan(origin)]
    mine = np.array(h["linkage"])[:, 2]
    np.testing.assert_allclose(mine, origin, rtol=1e-9)
    return origin


def _membership(fx: OracleFixture, i: int) -> np.ndarray:
    return _sheet(fx, 2 * i + 1)["A"].astype(int)


@pytest.mark.parametrize(
    ("i", "method"),
    [(0, "single"), (1, "complete"), (2, "average")],
    ids=["near", "furth", "group"],
)
def test_hcluster_linkage_heights_and_partition(i: int, method: str) -> None:
    fx = load_fixture("hcluster_linkage")
    x = _input(fx, 3)
    _check_hcluster(fx, i, x, method=method, standardize="none", k=3)
    h = hierarchical_cluster(x, method=method, standardize="none", k=3)
    assert _same_partition(np.array(h["labels"]), _membership(fx, i))


@pytest.mark.parametrize(("i", "metric"), [(0, "euclidean"), (2, "cityblock"), (4, "correlation")])
def test_hcluster_distance_metrics(i: int, metric: str) -> None:
    fx = load_fixture("hcluster_distance")
    x = _input(fx, 3)
    _check_hcluster(fx, i, x, method="average", metric=metric, standardize="none", k=3)
    h = hierarchical_cluster(x, method="average", metric=metric, standardize="none", k=3)
    assert _same_partition(np.array(h["labels"]), _membership(fx, i))


def test_hcluster_variables_correlation_distance() -> None:
    fx = load_fixture("hcluster_variables")
    # obj:=1 clusters the columns. The fixture holds FOUR variables (v1..v4); reading
    # only the first three gave a 3-variable tree (2 merges) against Origin's 4 (3 merges).
    x = _input(fx, 4).T
    assert x.shape[0] == 4
    origin = _check_hcluster(
        fx, 0, x, method="average", metric="correlation", standardize="none", k=2
    )
    # Independent of quantized: Origin's distance is 1 - r, so SciPy on corrcoef agrees.
    ref = linkage(squareform(1.0 - np.corrcoef(x), checks=False), "average")[:, 2]
    np.testing.assert_allclose(origin, ref, rtol=1e-9)
    h = hierarchical_cluster(x, method="average", metric="correlation", standardize="none", k=2)
    cluster = _sheet(fx, 1)["B"].astype(int)
    assert _same_partition(np.array(h["labels"]), cluster)


def _ward_unsquared(z: np.ndarray) -> np.ndarray:
    """Lance-Williams Ward update on UNSQUARED Euclidean distances (Origin's convention)."""
    dist = {(i, j): float(d) for (i, j), d in np.ndenumerate(squareform(pdist(z))) if i < j}
    size = {i: 1 for i in range(len(z))}
    heights: list[float] = []
    new = len(z)
    while len(size) > 1:
        (i, j), h = min(dist.items(), key=lambda kv: kv[1])
        heights.append(h)
        for k in set(size) - {i, j}:
            dik, djk = dist[(min(i, k), max(i, k))], dist[(min(j, k), max(j, k))]
            ni, nj, nk = size[i], size[j], size[k]
            dist[(k, new)] = ((ni + nk) * dik + (nj + nk) * djk - nk * h) / (ni + nj + nk)
        dist = {key: v for key, v in dist.items() if i not in key and j not in key or new in key}
        size[new] = size.pop(i) + size.pop(j)
        new += 1
    return np.array(heights)


WARD_CASES = [
    ("hcluster_linkage", 5, "none"),
    ("hcluster_dendrogram", 0, "none"),
    ("hcluster_standardise", 0, "none"),
    ("hcluster_standardise", 1, "snd"),
    ("hcluster_standardise", 2, "range"),
]


@pytest.mark.parametrize(("case", "i", "mode"), WARD_CASES)
def test_hcluster_ward_convention_and_partition(case: str, i: int, mode: str) -> None:
    fx = load_fixture(case)
    x = _input(fx, 3)
    origin = _long(fx, 2 * i, "Distance")
    origin = origin[~np.isnan(origin)]
    z, _, _ = standardize_columns(x, STD[mode])
    # Origin's heights ARE the unsquared-distance recurrence ...
    np.testing.assert_allclose(_ward_unsquared(z), origin, rtol=1e-9)
    # ... which equals SciPy's true Ward only up to the first non-singleton merge,
    h = hierarchical_cluster(x, method="ward", standardize=STD[mode], k=3)
    mine = np.array(h["linkage"])[:, 2]
    np.testing.assert_allclose(mine, np.asarray(linkage(pdist(z), "ward"))[:, 2], rtol=1e-12)
    first = int(np.argmax(np.array(h["linkage"])[:, 3] > 2))
    np.testing.assert_allclose(mine[:first], origin[:first], rtol=1e-9)
    assert not np.allclose(mine, origin, rtol=1e-6)
    # and both give the same 3-cluster partition on this data.
    assert _same_partition(np.array(h["labels"]), _membership(fx, i))
