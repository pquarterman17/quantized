"""Fit inputs by dataset handle (P4 phase 3, plans/LARGE_PAYLOAD_PLAN.md;
routes/_datasetrows.py).

Contracts:

* PARITY: a ``/fit`` (and ``/peaks/fit``) by ``dataset_handle`` + channels +
  rows returns the byte-identical body of the same fit with the ``x``/``y``
  the client would have posted, one case per client selection rule: the full
  analysis view, the gap drop (NaN rows), manual exclusions, an analysis
  selection (row ids + X range), per-series X (R2 read against T2), and
  ``-0`` (which ``JSON.stringify`` writes as ``0``). The rules are applied
  here the way the client applies them (``frontend/src/lib/fitselection.ts``,
  ``lib/api/finitePairs.ts``, ``lib/fitCurve.fitRowsOf``); the frontend's
  ``useCurveFit.bySource.test.ts`` and ``peakInputs.rows.test.ts`` pin that
  the rows it sends gather to its own x/y.
* SIZE: the request is a few hundred bytes whatever the row count.
* FALLBACK: an unknown handle is 409; the full ``dataset`` once is cached and
  answered with ``X-Dataset-Handle``, which then resolves.
* GUARDS: 422 for x/y mixed with a selection, a gap row, a bad channel, or
  rows that are not ascending, disjoint and in range.
* OPT-IN: the array request is unchanged and sends no handle header.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.routes import _datasetcache, _fitresults
from quantized.routes._datasetrows import expand_runs

client = TestClient(app)

N = 30_000


def _dataset(n: int = N) -> dict[str, Any]:
    """time + [T1, R1, T2, R2] with gaps, an Inf-free JSON form (null = NaN)
    and a few ``-0`` x values."""
    rng = np.random.default_rng(11)
    t1 = np.linspace(-5.0, 95.0, n)
    t2 = np.linspace(-10.0, 90.0, n)
    r1 = 1000 * np.exp(-(((t1 - 45) / 4) ** 2)) + 2 * t1 + 5 + rng.normal(0, 5, n)
    r2 = 600 * np.exp(-(((t2 - 30) / 3) ** 2)) + 10 + rng.normal(0, 3, n)
    t1[n // 2] = -0.0
    t2[n // 3] = -0.0
    cols: list[list[float | None]] = [list(c) for c in (t1, r1, t2, r2)]
    for c, rows in ((1, range(100, 160)), (0, (7, 9000, 9001)), (3, range(5000, 5300, 7))):
        for r in rows:
            cols[c][r] = None
    values = [[cols[c][r] for c in range(4)] for r in range(n)]
    return {
        "time": list(range(n)),
        "values": values,
        "labels": ["T1", "R1", "T2", "R2"],
        "units": ["", "", "", ""],
        "metadata": {},
    }


DATA = _dataset()


def _col(c: int) -> list[float]:
    if c == -1:
        return [float(v) for v in DATA["time"]]
    return [math.nan if row[c] is None else row[c] for row in DATA["values"]]


def _handle() -> str:
    r = client.post("/api/fitting/fit", json=_by_rows({"model": "Linear"}, 0, 1, [0, 1, 2], dataset=True))
    assert r.status_code == 200, r.text
    return r.headers["X-Dataset-Handle"]


def _runs(rows: list[int]) -> list[list[int]]:
    out: list[list[int]] = []
    for r in rows:
        if out and out[-1][0] + out[-1][1] == r:
            out[-1][1] += 1
        else:
            out.append([r, 1])
    return out


def _by_rows(
    body: dict[str, Any], xc: int, yc: int, rows: list[int], *,
    dataset: bool = False, handle: str | None = None,
) -> dict[str, Any]:
    src: dict[str, Any] = {"dataset": DATA} if dataset else {"dataset_handle": handle}
    return {**body, **src, "x_channel": xc, "y_channel": yc, "rows": _runs(rows)}


def _client_selection(
    xc: int, yc: int, *, dropped: frozenset[int] = frozenset(),
    row_ids: set[int] | None = None, x_range: tuple[float, float] | None = None,
) -> tuple[list[float], list[float], list[int]]:
    """The client's rules: the analysis view (``dropped`` = exclusions and
    filter), the selection (row ids, X range), then the gap drop. Returns the
    x/y it posts (``-0`` as ``JSON.stringify`` writes it) and their rows."""
    xs, ys = _col(xc), _col(yc)
    analysis = [r for r in range(N) if r not in dropped]
    if row_ids is not None or x_range is not None:
        lo, hi = x_range or (-math.inf, math.inf)
        analysis = [
            r for r in analysis
            if (row_ids is None or r in row_ids)
            and (x_range is None or (math.isfinite(xs[r]) and lo <= xs[r] <= hi))
        ]
    rows = [r for r in analysis if math.isfinite(xs[r]) and math.isfinite(ys[r])]
    return [xs[r] + 0.0 for r in rows], [ys[r] + 0.0 for r in rows], rows


RULES: dict[str, tuple[int, int, dict[str, Any]]] = {
    "analysis view": (0, 1, {}),
    "time as X": (-1, 1, {}),
    "gap drop": (0, 3, {}),
    "exclusions": (0, 1, {"dropped": frozenset(range(2000, 2600)) | {12, 13, 29_999}}),
    "selection": (0, 1, {"row_ids": set(range(1000, 20_000, 3)), "x_range": (10.0, 70.0)}),
    "per-series X": (2, 3, {}),
}
FITS: list[dict[str, Any]] = [
    {"model": "Gaussian"},
    {"model": "Gaussian", "return_residuals": False, "display_points": 512},
]


def _strip_id(body: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in body.items() if k != "resultId"}


@pytest.mark.parametrize("fit", FITS, ids=["full", "display"])
@pytest.mark.parametrize("rule", RULES)
def test_fit_by_handle_is_identical_per_rule(rule: str, fit: dict[str, Any]) -> None:
    xc, yc, kw = RULES[rule]
    x, y, rows = _client_selection(xc, yc, **kw)
    handle = _handle()
    by_arrays = client.post("/api/fitting/fit", json={**fit, "x": x, "y": y})
    by_handle = client.post("/api/fitting/fit", json=_by_rows(fit, xc, yc, rows, handle=handle))
    assert by_arrays.status_code == by_handle.status_code == 200, by_handle.text
    if fit.get("return_residuals") is False:
        assert _strip_id(by_handle.json()) == _strip_id(by_arrays.json())
        assert by_handle.json()["resultId"]
    else:
        assert by_handle.content == by_arrays.content  # bit-identical parameters and all
    assert "X-Dataset-Handle" not in by_arrays.headers


def test_negative_zero_is_sent_as_the_array_path_sends_it() -> None:
    xs = _col(0)
    assert math.copysign(1.0, xs[N // 2]) < 0  # the dataset holds -0
    _, _, rows = _client_selection(0, 1)
    by_handle = client.post("/api/fitting/fit", json=_by_rows(
        {"model": "Linear", "return_residuals": False, "display_points": 16}, 0, 1, rows,
        handle=_handle()))
    # The stored x is the gathered x: +0 at the -0 row, as JSON would carry it.
    stored = _fitresults.resolve_fit_or_409(by_handle.json()["resultId"], full_curve=True)
    assert stored.x is not None
    k = rows.index(N // 2)
    assert math.copysign(1.0, float(stored.x[k])) > 0


def test_weighted_fit_by_handle_is_identical() -> None:
    x, y, rows = _client_selection(0, 1)
    dy = [3.0 + (i % 5) * 0.25 for i in range(len(rows))]
    body = {"model": "Gaussian", "dy": dy}
    a = client.post("/api/fitting/fit", json={**body, "x": x, "y": y})
    b = client.post("/api/fitting/fit", json=_by_rows(body, 0, 1, rows, handle=_handle()))
    assert a.status_code == b.status_code == 200
    assert a.content == b.content


@pytest.mark.parametrize("rule", ["analysis view", "per-series X", "gap drop"])
def test_peak_fit_by_handle_is_identical(rule: str) -> None:
    xc, yc, kw = RULES[rule]
    x, y, rows = _client_selection(xc, yc, **kw)
    center = 45.0 if yc == 1 else 30.0
    body = {"x_lo": center - 12, "x_hi": center + 12, "seed_center": center, "seed_fwhm": 6.0,
            "model": "Gaussian"}
    a = client.post("/api/peaks/fit", json={**body, "x": x, "y": y})
    b = client.post("/api/peaks/fit", json=_by_rows(body, xc, yc, rows, handle=_handle()))
    assert a.status_code == b.status_code == 200, b.text
    assert a.content == b.content


def test_request_size_is_independent_of_rows() -> None:
    x, y, rows = _client_selection(0, 3)
    arrays = len(json.dumps({"model": "Gaussian", "x": x, "y": y}))
    by_rows = len(json.dumps(_by_rows({"model": "Gaussian"}, 0, 3, rows, handle="h" * 32)))
    assert arrays > 900_000
    assert by_rows < 2_000  # 3 gap runs + the R2 every-7th gaps: ~45 runs


def test_unknown_handle_is_409_and_a_posted_dataset_earns_one() -> None:
    _, _, rows = _client_selection(0, 1)
    miss = client.post("/api/fitting/fit", json=_by_rows({"model": "Linear"}, 0, 1, rows,
                                                         handle="0" * 32))
    assert miss.status_code == 409
    assert miss.json()["detail"] == "unknown_dataset_handle"
    _datasetcache.clear_cache()
    first = client.post("/api/fitting/fit", json=_by_rows({"model": "Linear"}, 0, 1, rows,
                                                          dataset=True))
    assert first.status_code == 200
    handle = first.headers["X-Dataset-Handle"]
    again = client.post("/api/fitting/fit", json=_by_rows({"model": "Linear"}, 0, 1, rows,
                                                          handle=handle))
    assert again.status_code == 200
    assert again.content == first.content
    peak_miss = client.post("/api/peaks/fit", json=_by_rows(
        {"x_lo": 0, "x_hi": 1, "seed_center": 0.5}, 0, 1, rows, handle="1" * 32))
    assert peak_miss.status_code == 409


@pytest.mark.parametrize(
    ("patch", "needle"),
    [
        ({"x": [1.0, 2.0], "y": [1.0, 2.0]}, "not both"),
        ({"rows": [[99, 3]]}, "gap"),  # row 100 is a NaN in R1
        ({"y_channel": 4}, "channel 4"),
        ({"rows": [[10, 5], [12, 5]]}, "ascending"),
        ({"rows": [[N - 2, 5]]}, "ascending"),
        ({"rows": [[5, 0]]}, "ascending"),
        ({"x_channel": None}, "x_channel"),
    ],
)
def test_bad_selection_is_422(patch: dict[str, Any], needle: str) -> None:
    body = {**_by_rows({"model": "Linear"}, 0, 1, list(range(200, 400)), handle=_handle()),
            **patch}
    r = client.post("/api/fitting/fit", json=body)
    assert r.status_code == 422, r.text
    assert needle in r.text


def test_peak_fit_refuses_a_find_id_with_a_selection() -> None:
    # Its 409 would be indistinguishable from the handle's.
    body = _by_rows({"x_lo": 0, "x_hi": 1, "seed_center": 0.5, "find_result_id": "f"},
                    0, 1, [0, 1], handle=_handle())
    r = client.post("/api/peaks/fit", json=body)
    assert r.status_code == 422
    assert "find_result_id" in r.text


def test_missing_xy_is_still_422() -> None:
    assert client.post("/api/fitting/fit", json={"model": "Linear", "x": [1.0]}).status_code == 422
    assert client.post("/api/fitting/fit", json={"model": "Linear"}).status_code == 422


def test_expand_runs() -> None:
    assert expand_runs([(0, 3), (5, 2), (9, 1)], 10).tolist() == [0, 1, 2, 5, 6, 9]
    assert expand_runs([], 10).tolist() == []
    with pytest.raises(ValueError):
        expand_runs([(-1, 2)], 10)
