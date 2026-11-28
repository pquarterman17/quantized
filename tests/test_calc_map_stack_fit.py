"""Per-pixel fit through a map stack (``calc/map_stack_fit``).

The oracle is ``scipy.optimize.curve_fit`` run pixel by pixel on the same
synthetic stack (known per-pixel parameters plus noise): the recovered maps, and
their standard errors, must equal it. Failed pixels, a masked region, the grid
rule and cancellation are pinned too.
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy.optimize import curve_fit as scipy_curve_fit

from quantized.calc.map_ops import MapGrid
from quantized.calc.map_stack_fit import (
    StackFitCancelled,
    check_stack,
    fit_map_stack,
    result_maps,
)

MODEL = "Exponential Decay"  # A * exp(-x / tau) + C
NY, NX, LAYERS = 5, 6, 9
X = np.linspace(0.0, 6.0, LAYERS)


def _grid(z: np.ndarray, **kw: object) -> MapGrid:
    args: dict[str, object] = {
        "x": np.arange(z.shape[1], dtype=float), "y": np.arange(z.shape[0], dtype=float),
        "z": z, "x_label": "x", "x_unit": "mm", "y_label": "y", "y_unit": "mm",
        "z_unit": "cts", "metadata": {},
    }
    args.update(kw)
    return MapGrid(**args)  # type: ignore[arg-type]


def _truth() -> np.ndarray:
    rng = np.random.default_rng(3)
    a = 1.0 + 2.0 * rng.random((NY, NX))
    tau = 1.2 + 1.3 * rng.random((NY, NX))
    c = 0.5 * rng.random((NY, NX))
    return np.stack([a, tau, c])


def _stack(truth: np.ndarray, noise: float = 0.01) -> list[MapGrid]:
    rng = np.random.default_rng(11)
    layers = []
    for xv in X:
        z = truth[0] * np.exp(-xv / truth[1]) + truth[2] + rng.normal(0, noise, (NY, NX))
        layers.append(_grid(z))
    return layers


def _expd(x: np.ndarray, a: float, tau: float, c: float) -> np.ndarray:
    return np.asarray(a * np.exp(-x / tau) + c, dtype=float)


def test_recovered_maps_equal_per_pixel_scipy_curve_fit() -> None:
    truth = _truth()
    grids = _stack(truth)
    res = fit_map_stack(grids, X, MODEL)
    assert res.summary["n_failed"] == 0 and res.summary["n_fitted"] == NY * NX
    z = np.stack([g.z for g in grids])
    for j in range(NY):
        for i in range(NX):
            popt, pcov = scipy_curve_fit(_expd, X, z[:, j, i], p0=truth[:, j, i])
            np.testing.assert_allclose(res.params[:, j, i], popt, rtol=1e-4, atol=1e-6)
            np.testing.assert_allclose(
                res.errors[:, j, i], np.sqrt(np.diag(pcov)), rtol=1e-3, atol=1e-6
            )
            resid = z[:, j, i] - _expd(X, *popt)
            chi = float(np.sum(resid**2) / (LAYERS - 3))
            np.testing.assert_allclose(res.chisq_red[j, i], chi, rtol=1e-3)
    assert np.all(res.converged == 1.0)
    # and the fit actually recovers the truth to within the noise
    np.testing.assert_allclose(res.params[0], truth[0], atol=0.15)


def test_output_maps_are_named_per_parameter_with_provenance() -> None:
    grids = _stack(_truth())
    res = fit_map_stack(grids, X, MODEL)
    outs = result_maps(res, [f"T{k}" for k in range(LAYERS)], X, "T")
    names = [n for n, _k, _d in outs]
    assert names == ["A", "A (std. error)", "τ", "τ (std. error)", "C", "C (std. error)",
                     "reduced chi-sq", "converged"]
    ds = outs[0][2]
    assert ds.metadata["is2D"] is True and ds.metadata["map_shape"] == [NY, NX]
    assert ds.metadata["map_op"]["op"] == "stack_fit"
    assert ds.metadata["map_op"]["layers"][0] == "T0"
    np.testing.assert_allclose(ds.values[:, 2].reshape(NY, NX), res.params[0])


def test_held_parameter_is_not_fitted_and_gets_no_maps() -> None:
    truth = _truth()
    truth[2] = 0.25
    grids = _stack(truth)
    res = fit_map_stack(grids, X, MODEL, p0=[None, None, 0.25], fixed=[False, False, True])
    assert [res.param_names[k] for k in res.free] == ["A", "τ"]
    assert res.params.shape[0] == 2
    z = np.stack([g.z for g in grids])
    popt, _ = scipy_curve_fit(lambda x, a, t: _expd(x, a, t, 0.25), X, z[:, 2, 3],
                              p0=truth[:2, 2, 3])
    np.testing.assert_allclose(res.params[:, 2, 3], popt, rtol=1e-4)


def test_bounds_are_honoured() -> None:
    grids = _stack(_truth())
    res = fit_map_stack(grids, X, MODEL, lower=[None, None, 0.0], upper=[None, 1.5, None])
    ok = np.isfinite(res.params[1])
    assert np.nanmax(res.params[1][ok]) <= 1.5 + 1e-9


def test_failed_pixels_are_nan_in_every_output_and_counted() -> None:
    grids = _stack(_truth())
    # pixel (1, 2): only two finite layers (a 3-parameter model cannot fit that);
    # pixel (3, 4): no finite layer at all (a masked region, not a failure).
    for k, g in enumerate(grids):
        if k >= 2:
            g.z[1, 2] = np.nan
        g.z[3, 4] = np.nan
    res = fit_map_stack(grids, X, MODEL)
    assert res.summary["n_failed"] == 1 and res.summary["n_no_data"] == 1
    assert res.summary["n_fitted"] == NY * NX - 2
    assert res.summary["failures"][0]["first_pixel"] == {"row": 1, "col": 2}
    for arr in (*res.params, *res.errors, res.chisq_red, res.converged):
        assert np.isnan(arr[1, 2]) and np.isnan(arr[3, 4])
        assert np.isfinite(arr[0, 0])


def test_a_pixel_that_does_not_converge_is_a_failure_unless_kept() -> None:
    rng = np.random.default_rng(5)
    grids = _stack(_truth())
    for g in grids:
        g.z[2, 2] = rng.normal(0, 5.0)  # white noise: no decay to find
    dropped = fit_map_stack(grids, X, MODEL)
    kept = fit_map_stack(grids, X, MODEL, keep_unconverged=True)
    assert kept.summary["n_failed"] <= dropped.summary["n_failed"]
    if dropped.summary["n_failed"]:
        assert np.isnan(dropped.params[0, 2, 2]) and np.isnan(dropped.converged[2, 2])
    if kept.summary["n_unconverged_kept"]:
        assert 0.0 in kept.converged[np.isfinite(kept.converged)]
    # neighbours are untouched by the bad pixel
    np.testing.assert_allclose(dropped.params[:, 0, 0], kept.params[:, 0, 0])


def test_stack_must_share_one_grid_and_have_varying_values() -> None:
    g = _stack(_truth())
    with pytest.raises(ValueError, match="different grid"):
        check_stack([*g[:-1], _grid(g[-1].z, x=g[-1].x + 0.5)], X)
    with pytest.raises(ValueError, match="different axes or value unit"):
        check_stack([*g[:-1], _grid(g[-1].z, z_unit="V")], X)
    with pytest.raises(ValueError, match="at least 3"):
        check_stack(g[:2], X[:2])
    with pytest.raises(ValueError, match="differ"):
        check_stack(g, np.ones(LAYERS))
    with pytest.raises(ValueError, match="need"):
        check_stack(g, X[:-1])
    with pytest.raises(ValueError, match="finite"):
        check_stack(g, np.r_[X[:-1], np.nan])


def test_held_parameter_needs_a_start_and_unknown_model_is_refused() -> None:
    g = _stack(_truth())
    with pytest.raises(ValueError, match="needs a start"):
        fit_map_stack(g, X, MODEL, fixed=[False, False, True])
    with pytest.raises(ValueError, match="unknown model"):
        fit_map_stack(g, X, "NoSuchModel")
    with pytest.raises(ValueError, match="every parameter is held"):
        fit_map_stack(g, X, MODEL, p0=[1, 1, 0], fixed=[True, True, True])


def test_abort_raises_and_returns_nothing() -> None:
    g = _stack(_truth())
    calls = {"n": 0}

    def abort() -> bool:
        calls["n"] += 1
        return calls["n"] > 7

    with pytest.raises(StackFitCancelled):
        fit_map_stack(g, X, MODEL, abort_check=abort)
    assert calls["n"] == 8  # stopped at once, not after the run


def test_progress_reports_each_row() -> None:
    g = _stack(_truth())
    seen: list[tuple[float, str]] = []
    fit_map_stack(g, X, MODEL, progress=lambda f, m: seen.append((f, m)))
    assert len(seen) == NY and seen[-1][0] == pytest.approx(1.0)
