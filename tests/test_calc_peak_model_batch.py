"""calc.peak_model_batch: the batch loop's guarantees (audit P2.4 slice 4).

The fitter itself is verified in test_calc_peak_model_fit; here: truth
recovery across a synthetic multi-dataset set, failure isolation (a bad item
is an error row and the rest still fit), cancel (before an item and inside a
running fit), the total deadline (remaining items are "not_run" rows), and
that progress exceptions propagate."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from quantized.calc.peak_model_batch import BatchCancelled, fit_peak_model_batch

X = np.linspace(20.0, 30.0, 301)


def _gauss(x: np.ndarray, c: float, h: float, w: float) -> np.ndarray:
    return np.asarray(h * np.exp(-4 * np.log(2) * (x - c) ** 2 / w**2), dtype=float)


def _item(item_id: str, center: float, height: float, fwhm: float, *, seed: int = 0,
          start_offset: float = 0.3) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    y = _gauss(X, center, height, fwhm) + 5.0 + 0.2 * rng.normal(size=X.size)
    return {
        "id": item_id, "x": X.tolist(), "y": y.tolist(),
        "shapes": ["gaussian"], "background": "constant",
        "parameters": [
            {"name": "p0.center", "value": center + start_offset, "vary": True},
            {"name": "p0.height", "value": 0.8 * height, "vary": True, "min": 0.0},
            {"name": "p0.fwhm", "value": 1.3 * fwhm, "vary": True, "max": 10.0},
            {"name": "bg.c0", "value": 4.0, "vary": True},
        ],
    }


TRUTH = [("a", 23.0, 100.0, 0.8), ("b", 25.5, 60.0, 1.2), ("c", 27.2, 150.0, 0.5)]


def test_batch_recovers_the_truth_of_every_dataset() -> None:
    out = fit_peak_model_batch([_item(i, c, h, w, seed=k) for k, (i, c, h, w) in enumerate(TRUTH)])
    assert out["n_items"] == 3 and out["n_ok"] == 3 and out["n_failed"] == 0
    assert out["stopped"] is None
    for row, (item_id, c, h, w) in zip(out["rows"], TRUTH, strict=True):
        assert row["id"] == item_id and row["status"] == "ok" and row["error"] is None
        fit = row["fit"]
        assert fit["success"]
        peak = fit["peaks"][0]
        assert peak["center"] == pytest.approx(c, abs=0.01)
        assert peak["height"] == pytest.approx(h, rel=0.02)
        assert peak["fwhm"] == pytest.approx(w, rel=0.02)
        # A real uncertainty, and the truth is inside ~4 sigma of it.
        assert peak["center_stderr"] is not None and peak["center_stderr"] > 0
        assert abs(peak["center"] - c) < 4 * peak["center_stderr"]
        assert fit["metrics"]["objective"] == "ssr" and fit["metrics"]["chi2"] is None
        # The table does not need the curves or correlation: not carried.
        assert "curves" not in fit and "correlation" not in fit


def test_one_bad_dataset_is_an_error_row_and_the_rest_still_fit() -> None:
    bad = _item("bad", 25.0, 50.0, 1.0)
    bad["parameters"] = [*bad["parameters"], {"name": "p7.center", "value": 1.0, "vary": True}]
    short = _item("short", 25.0, 50.0, 1.0)
    short["x"], short["y"] = short["x"][:3], short["y"][:3]
    items = [_item("a", 23.0, 100.0, 0.8), bad, short, _item("c", 27.2, 150.0, 0.5)]
    out = fit_peak_model_batch(items)
    status = {r["id"]: r["status"] for r in out["rows"]}
    assert status == {"a": "ok", "bad": "error", "short": "error", "c": "ok"}
    assert out["n_ok"] == 2 and out["n_failed"] == 2
    errors = {r["id"]: r["error"] for r in out["rows"]}
    assert "p7.center" in errors["bad"]
    assert "cannot constrain" in errors["short"]
    assert all(r["fit"] is None for r in out["rows"] if r["status"] == "error")
    assert out["rows"][3]["fit"]["peaks"][0]["center"] == pytest.approx(27.2, abs=0.01)


def test_the_final_progress_message_counts_only_fitted_items() -> None:
    bad = _item("bad", 25.0, 50.0, 1.0)
    bad["shapes"] = ["sinc"]
    seen: list[str] = []
    fit_peak_model_batch([_item("a", 23.0, 100.0, 0.8), bad],
                         progress=lambda _f, m: seen.append(m))
    assert seen == ["fitting 1/2", "fitting 2/2", "fitted 1/2"]


def test_an_unexpected_exception_is_isolated_too(monkeypatch: pytest.MonkeyPatch) -> None:
    import quantized.calc.peak_model_batch as mod

    real = mod.fit_peak_model
    calls: list[int] = []

    def flaky(*args: Any, **kwargs: Any) -> dict[str, Any]:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom with internal detail /secret/path")
        return real(*args, **kwargs)

    monkeypatch.setattr(mod, "fit_peak_model", flaky)
    out = fit_peak_model_batch([_item("a", 23.0, 100.0, 0.8), _item("b", 25.5, 60.0, 1.2)])
    assert [r["status"] for r in out["rows"]] == ["error", "ok"]
    # Only the exception TYPE reaches the row, never its (uncurated) text.
    assert out["rows"][0]["error"] == "unexpected RuntimeError while fitting"


def test_cancel_between_items_stops_the_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    import quantized.calc.peak_model_batch as mod

    real = mod.fit_peak_model
    done: list[int] = []

    def counted(*args: Any, **kwargs: Any) -> dict[str, Any]:
        out = real(*args, **kwargs)
        done.append(1)
        return out

    monkeypatch.setattr(mod, "fit_peak_model", counted)
    started: list[str] = []
    with pytest.raises(BatchCancelled):
        fit_peak_model_batch(
            [_item(i, c, h, w) for i, c, h, w in TRUTH],
            progress=lambda _f, msg: started.append(msg),
            abort_check=lambda: len(done) >= 1,  # cancelled once item 1 finished
        )
    assert started == ["fitting 1/3"] and len(done) == 1


def test_cancel_inside_a_running_fit_does_not_wait_it_out() -> None:
    calls = {"n": 0}

    def abort() -> bool:
        calls["n"] += 1
        return calls["n"] > 5  # the first item-check and a few evaluations pass

    with pytest.raises(BatchCancelled):
        fit_peak_model_batch([_item("a", 23.0, 100.0, 0.8)], abort_check=abort)
    # It fired mid-fit: far fewer checks than a full fit's evaluations.
    assert calls["n"] == 6


def test_total_deadline_leaves_named_not_run_rows() -> None:
    now = {"t": 0.0}

    def clock() -> float:
        return now["t"]

    def progress(_f: float, _m: str) -> None:
        now["t"] += 4.0  # each item start costs 4 s of the budget

    out = fit_peak_model_batch([_item(i, c, h, w) for i, c, h, w in TRUTH],
                               total_deadline_s=6.0, progress=progress, clock=clock)
    assert [r["status"] for r in out["rows"]] == ["ok", "ok", "not_run"]
    assert out["stopped"] == "deadline" and out["n_not_run"] == 1
    assert out["rows"][2]["error"] == "not fitted: the batch reached its 6 s time limit"
    assert out["rows"][2]["fit"] is None


def test_item_deadline_is_passed_to_each_fit(monkeypatch: pytest.MonkeyPatch) -> None:
    # A fake clock that advances 1 s per read: the solver's deadline trips on
    # its first evaluation. A real 1e-9 s budget is NOT deterministic - on
    # Windows the monotonic clock ticks ~15.6 ms, so t_end can equal "now".
    import types

    import quantized.calc._bounded_lsq as lsq

    ticks = {"t": 0.0}

    def fake_monotonic() -> float:
        ticks["t"] += 1.0
        return ticks["t"]

    monkeypatch.setattr(lsq, "time", types.SimpleNamespace(monotonic=fake_monotonic))
    out = fit_peak_model_batch([_item("a", 23.0, 100.0, 0.8)], item_deadline_s=0.5)
    fit = out["rows"][0]["fit"]
    assert out["rows"][0]["status"] == "ok"  # it RAN; it just did not converge
    assert fit["success"] is False
    assert any("time limit" in w for w in fit["warnings"])


def test_progress_exceptions_propagate() -> None:
    class Stop(Exception):
        pass

    def progress(_f: float, _m: str) -> None:
        raise Stop

    with pytest.raises(Stop):
        fit_peak_model_batch([_item("a", 23.0, 100.0, 0.8)], progress=progress)


@pytest.mark.parametrize("kw", [{"item_deadline_s": 0.0}, {"total_deadline_s": -1.0}])
def test_bad_budgets_are_rejected(kw: dict[str, float]) -> None:
    with pytest.raises(ValueError, match="must be positive"):
        fit_peak_model_batch([_item("a", 23.0, 100.0, 0.8)], **kw)


def test_uncurated_exception_text_never_reaches_a_row() -> None:
    # A KeyError's text is Python's repr of the key, not a curated message.
    no_shapes = _item("no-shapes", 25.0, 50.0, 1.0)
    del no_shapes["shapes"]
    out = fit_peak_model_batch([no_shapes, _item("a", 23.0, 100.0, 0.8)])
    assert [r["status"] for r in out["rows"]] == ["error", "ok"]
    assert out["rows"][0]["error"] == "unexpected KeyError while fitting"


def test_validate_hook_errors_are_isolated_rows() -> None:
    def validate(item: Any) -> Any:
        if item["id"] == "bad":
            raise ValueError("invalid item: parameters.0.value: Input should be a finite number")
        return item

    items = [_item("a", 23.0, 100.0, 0.8), _item("bad", 25.0, 50.0, 1.0),
             _item("c", 27.2, 150.0, 0.5)]
    out = fit_peak_model_batch(items, validate=validate)
    assert [r["status"] for r in out["rows"]] == ["ok", "error", "ok"]
    assert out["rows"][1]["error"].startswith("invalid item: parameters.0.value")


def test_a_fit_cut_short_by_the_total_budget_marks_the_batch_stopped(
        monkeypatch: pytest.MonkeyPatch) -> None:
    import quantized.calc.peak_model_batch as mod

    real = mod.fit_peak_model
    now = {"t": 0.0}

    def slow(*args: Any, **kwargs: Any) -> dict[str, Any]:
        out = real(*args, **kwargs)
        now["t"] += kwargs["deadline_s"]  # it used its whole budget ...
        return {**out, "success": False}  # ... and stopped there, unconverged

    monkeypatch.setattr(mod, "fit_peak_model", slow)
    out = fit_peak_model_batch([_item("a", 23.0, 100.0, 0.8), _item("b", 25.5, 60.0, 1.2)],
                               item_deadline_s=10.0, total_deadline_s=15.0,
                               clock=lambda: now["t"])
    # Item b got 5 s (not 10) and ran out: every item has a row, none is
    # "not_run", yet the batch budget DID cut work short.
    assert [r["status"] for r in out["rows"]] == ["ok", "ok"]
    assert out["n_not_run"] == 0 and out["stopped"] == "deadline"


def test_a_fit_converging_inside_a_shortened_budget_is_not_flagged() -> None:
    out = fit_peak_model_batch([_item("a", 23.0, 100.0, 0.8)], item_deadline_s=10.0,
                               total_deadline_s=5.0, clock=lambda: 0.0)
    assert out["rows"][0]["fit"]["success"] and out["stopped"] is None
