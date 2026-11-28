"""An exported script reproduces columns added through Set Column Values (plan item 33).

``frontend/src/components/Stage/worksheet/SetColumnValuesDialog.pipelineExport.test.tsx``
adds the columns through the real dialog, then pins the app's worksheet (cells and
units) and the exported script in ``tests/fixtures/wire/pipeline_derived_round_trip.json``.
The script runs here, headless, on the same CSV; its cells and units must be the app's.
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "pipeline_derived_round_trip.json"


def test_the_exported_script_gives_the_apps_cells_and_units(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert "NOT REPRODUCED" not in fx["script"]
    (tmp_path / "z.csv").write_text(fx["csv"], encoding="utf-8")
    script = tmp_path / "pipeline.py"
    script.write_text(fx["script"], encoding="utf-8")
    spec = importlib.util.spec_from_file_location("exported_pipeline", script)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    saved: dict[str, Any] = {}
    monkeypatch.setattr(mod.qz, "save_table", lambda data, *a, **k: saved.setdefault("data", data))
    monkeypatch.chdir(tmp_path)
    assert mod.main(["z.csv"]) == 0
    data = saved["data"]
    app = fx["app"]
    assert list(data.labels) == app["labels"]
    # The script's source columns come from a CSV with no units; each ADDED column has the app's.
    added = len(app["added"])
    assert list(data.units)[-added:] == app["units"][-added:]
    rows = app["values"]
    want = np.asarray([[math.nan if v == "NaN" else v for v in r] for r in rows], float)
    np.testing.assert_allclose(data.time, app["time"], rtol=1e-12)
    np.testing.assert_allclose(data.values, want, rtol=1e-12, atol=1e-12, equal_nan=True)
    assert np.isfinite(want).all()


def test_the_app_columns_match_numpy() -> None:
    """The fixture's app cells are right, not just equal to the script's (independent numpy)."""
    fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
    app = fx["app"]
    x = np.asarray(app["time"], float)
    vals = np.asarray(app["values"], float)
    col = {n: vals[:, i] for i, n in enumerate(app["labels"])}
    a, b = col["R"], col["X"]
    z = (a + 1j * b) * np.exp(1j * x / 1e4)
    expect = {
        "dbl": 2 * a,
        "rate": a / x,
        "reA": a,
        "imA": np.zeros_like(a),
        "cjB": b,
        "absB": np.abs(b),
        "argB": np.where(b < 0, np.pi, 0.0),
        "mag": np.hypot(a, b),
        "bad": a + x,
        "Z (re)": z.real,
        "Z (im)": z.imag,
    }
    assert (b < 0).any() and (b > 0).any()
    for name, want in expect.items():
        np.testing.assert_allclose(col[name], want, rtol=1e-12, atol=1e-12, err_msg=name)
