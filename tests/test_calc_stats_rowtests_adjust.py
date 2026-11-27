"""Row-wise t-tests: the optional adjusted-p column, against statsmodels multipletests."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient
from statsmodels.stats.multitest import multipletests

from quantized.app import create_app
from quantized.calc.stats_rowtests import row_t_tests

SM = {"bonferroni": "bonferroni", "holm": "holm", "bh": "fdr_bh"}


def _block(seed: int = 5) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    shift = np.linspace(0, 3, 12)[:, None]
    return rng.normal(0, 1, (12, 4)), rng.normal(0, 1, (12, 4)) + shift


def _col(res: dict, key: str) -> np.ndarray:
    return np.array([np.nan if r[key] is None else r[key] for r in res["rows"]], dtype=float)


@pytest.mark.parametrize("method", ["bonferroni", "holm", "bh"])
def test_adjusted_p_matches_statsmodels_and_keeps_raw(method: str) -> None:
    a, b = _block()
    raw = row_t_tests(a, b)
    res = row_t_tests(a, b, adjust=method)
    # the raw column is never replaced
    np.testing.assert_array_equal(_col(res, "p"), _col(raw, "p"))
    ref = multipletests(_col(raw, "p"), method=SM[method])[1]
    got = _col(res, "p_adjusted")
    np.testing.assert_allclose(got, ref, rtol=1e-12, atol=1e-15)
    assert res["adjust"] == method


def test_no_adjustment_by_default() -> None:
    a, b = _block()
    res = row_t_tests(a, b)
    assert res["adjust"] == "none"
    assert all(r["p_adjusted"] is None for r in res["rows"])


def test_untested_rows_stay_out_of_the_family() -> None:
    a, b = _block()
    a[3, :] = np.nan  # row 3 cannot be tested
    res = row_t_tests(a, b, adjust="holm")
    p = _col(res, "p")
    assert res["rows"][3]["p_adjusted"] is None and res["rows"][3]["status"] != "ok"
    tested = ~np.isnan(p)
    assert res["n_tested"] == 11
    ref = multipletests(p[tested], method="holm")[1]
    np.testing.assert_allclose(_col(res, "p_adjusted")[tested], ref, rtol=1e-12)


def test_one_sided_and_unknown_method() -> None:
    a, b = _block()
    res = row_t_tests(a, b, alternative="greater", adjust="bh")
    p = _col(res, "p")
    ref = multipletests(p, method="fdr_bh")[1]
    np.testing.assert_allclose(_col(res, "p_adjusted"), ref, rtol=1e-12)
    with pytest.raises(ValueError, match="adjust"):
        row_t_tests(a, b, adjust="sidak")


def test_route() -> None:
    a, b = _block()
    client = TestClient(create_app())
    body = {"a": a.tolist(), "b": b.tolist(), "adjust": "holm"}
    r = client.post("/api/stats/row-t-tests", json=body)
    assert r.status_code == 200, r.text
    assert all(row["p_adjusted"] is not None for row in r.json()["rows"])
    assert client.post("/api/stats/row-t-tests", json={**body, "adjust": "nope"}).status_code == 422
    plain = client.post("/api/stats/row-t-tests", json={"a": body["a"], "b": body["b"]})
    assert plain.json()["adjust"] == "none"
