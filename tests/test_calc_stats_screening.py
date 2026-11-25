"""Response screening (G26) against scipy / statsmodels oracles."""

from __future__ import annotations

import numpy as np
import pytest
from scipy import stats as sps

from quantized.calc.stats_anova2 import adjust_pvalues
from quantized.calc.stats_screening import MAX_PAIRS, response_screening

rng = np.random.default_rng(7)
N = 40
XC = rng.normal(size=N)
GRP2 = ["a", "b"] * (N // 2)
GRP3 = ["u", "v", "w", "w"] * (N // 4)
Y1 = (0.8 * XC + rng.normal(size=N)).tolist()
Y2 = rng.normal(size=N)
Y2[GRP2.index("b") :: 2] += 1.0
Y2 = Y2.tolist()


def _screen(**kw):  # type: ignore[no-untyped-def]
    return response_screening(
        [Y1, Y2],
        [XC.tolist(), GRP2, GRP3],
        y_names=["Y1", "Y2"],
        x_names=["xc", "g2", "g3"],
        x_kinds=["continuous", "nominal", "nominal"],
        **kw,
    )


def _row(res, y, x):  # type: ignore[no-untyped-def]
    return next(r for r in res["results"] if r["y"] == y and r["x"] == x)


def test_regression_matches_linregress() -> None:
    r = _row(_screen(), "Y1", "xc")
    fit = sps.linregress(XC, Y1)
    assert r["p"] == pytest.approx(fit.pvalue, rel=1e-12)
    assert r["estimate"] == pytest.approx(fit.slope)
    assert r["effect_size"] == pytest.approx(fit.rvalue)
    ci = fit.slope + np.array([-1, 1]) * sps.t.ppf(0.975, N - 2) * fit.stderr
    assert [r["ci_low"], r["ci_high"]] == pytest.approx(ci.tolist())
    assert r["n"] == N


def test_two_level_matches_ttest_ind() -> None:
    r = _row(_screen(), "Y2", "g2")
    a = np.array(Y2)[::2]
    b = np.array(Y2)[1::2]
    t = sps.ttest_ind(b, a, equal_var=True)
    assert r["p"] == pytest.approx(t.pvalue, rel=1e-12)
    assert r["statistic"] == pytest.approx(t.statistic)
    ci = t.confidence_interval(0.95)
    assert [r["ci_low"], r["ci_high"]] == pytest.approx([ci.low, ci.high])


def test_three_level_matches_f_oneway() -> None:
    r = _row(_screen(), "Y1", "g3")
    y = np.array(Y1)
    g = np.array(GRP3)
    f = sps.f_oneway(*[y[g == k] for k in ("u", "v", "w")])
    assert r["p"] == pytest.approx(f.pvalue, rel=1e-12)
    assert r["estimate"] is None and r["n_levels"] == 3


@pytest.mark.parametrize("method", ["bh", "by"])
def test_fdr_matches_scipy_and_statsmodels(method: str) -> None:
    res = _screen(method=method)
    p = [r["p"] for r in res["results"]]
    adj = [r["p_adjusted"] for r in res["results"]]
    assert adj == pytest.approx(sps.false_discovery_control(p, method=method))
    sm = pytest.importorskip("statsmodels.stats.multitest")
    code = "fdr_bh" if method == "bh" else "fdr_by"
    assert adj == pytest.approx(sm.multipletests(p, method=code)[1])
    for r in res["results"]:
        assert r["logworth"] == pytest.approx(-np.log10(r["p"]))
        assert r["adj_logworth"] == pytest.approx(-np.log10(r["p_adjusted"]))


def test_adjust_pvalues_by_oracle() -> None:
    p = [0.001, 0.02, 0.03, 0.2, 0.5]
    assert adjust_pvalues(p, method="by")["adjusted"] == pytest.approx(
        sps.false_discovery_control(p, method="by")
    )


def test_pairwise_missing_and_degenerate_reported() -> None:
    y = [1.0, 2.0, None, 4.0, 5.0, 7.0]
    const = [3.0] * 6
    xs = [
        [1.0, None, 3.0, 4.0, 5.0, 6.5],
        [2.0, 2.0, 2.0, 2.0, 2.0, 2.0],
        ["a", "a", "a", "b", None, "b"],
    ]
    res = response_screening(
        [y, const],
        xs,
        y_names=["y", "c"],
        x_names=["x", "k", "g"],
        x_kinds=["continuous", "continuous", "nominal"],
    )
    assert _row(res, "y", "x")["n"] == 4
    assert "constant" in _row(res, "y", "k")["reason"]
    assert "constant" in _row(res, "c", "x")["reason"]
    assert _row(res, "y", "g")["n"] == 4
    assert res["n_pairs"] == 6 and res["n_degenerate"] == 4 and res["n_tested"] == 2
    deg = _row(res, "y", "k")
    assert deg["p"] is None and deg["p_adjusted"] is None and deg["significant"] is False
    # adjustment covers only the testable pairs
    ps = [r["p"] for r in res["results"] if r["p"] is not None]
    adj = [r["p_adjusted"] for r in res["results"] if r["p"] is not None]
    assert adj == pytest.approx(sps.false_discovery_control(ps))


def test_too_few_rows_and_single_level_reasons() -> None:
    res = response_screening(
        [[1.0, 2.0]],
        [[1.0, 2.0], ["a", "a"]],
        y_names=["y"],
        x_names=["x", "g"],
        x_kinds=["continuous", "nominal"],
    )
    assert "at least 3" in _row(res, "y", "x")["reason"]
    assert "level" in _row(res, "y", "g")["reason"]


def test_perfect_fit_and_separation_are_degenerate() -> None:
    res = response_screening(
        [[1.0, 2.0, 3.0, 4.0], [1.0, 1.0, 2.0, 2.0]],
        [[1.0, 2.0, 3.0, 4.0], ["a", "a", "b", "b"]],
        y_names=["l", "s"],
        x_names=["x", "g"],
        x_kinds=["continuous", "nominal"],
    )
    assert "perfect" in _row(res, "l", "x")["reason"]
    assert "perfect separation" in _row(res, "s", "g")["reason"]


@pytest.mark.parametrize(
    "kw",
    [{"alpha": 0.0}, {"method": "nope"}, {"x_kinds": ["weird", "nominal", "nominal"]}],
)
def test_bad_input_refused(kw: dict) -> None:  # type: ignore[type-arg]
    base = {
        "y_names": ["Y1", "Y2"],
        "x_names": ["a", "b", "c"],
        "x_kinds": ["continuous", "nominal", "nominal"],
    }
    with pytest.raises(ValueError):
        response_screening([Y1, Y2], [XC.tolist(), GRP2, GRP3], **{**base, **kw})  # type: ignore[arg-type]


def test_ragged_text_and_limit_refused() -> None:
    with pytest.raises(ValueError, match="same number"):
        response_screening(
            [[1.0, 2.0, 3.0]], [[1.0, 2.0]], y_names=["y"], x_names=["x"], x_kinds=["continuous"]
        )
    with pytest.raises(ValueError, match="holds text"):
        response_screening(
            [[1.0, 2.0, 3.0]],
            [["a", "b", "c"]],
            y_names=["y"],
            x_names=["x"],
            x_kinds=["continuous"],
        )
    with pytest.raises(ValueError, match="exceeds"):
        response_screening(
            [[1.0]] * 101,
            [[1.0]] * (MAX_PAIRS // 100),
            y_names=["y"] * 101,
            x_names=["x"] * (MAX_PAIRS // 100),
            x_kinds=["continuous"] * (MAX_PAIRS // 100),
        )


def test_route_roundtrip(client) -> None:  # type: ignore[no-untyped-def]
    body = {
        "y": [{"name": "Y1", "values": Y1}],
        "x": [
            {"name": "xc", "kind": "continuous", "values": XC.tolist()},
            {"name": "g3", "kind": "nominal", "values": GRP3},
        ],
        "method": "by",
    }
    resp = client.post("/api/stats/response-screening", json=body)
    assert resp.status_code == 200, resp.text
    assert resp.json()["n_tested"] == 2
    bad = client.post("/api/stats/response-screening", json={**body, "alpha": 2})
    assert bad.status_code == 422
