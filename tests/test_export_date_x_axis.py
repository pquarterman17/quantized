"""A timestamp X axis exports as dates, as the screen draws it (audit #7).

A CSV whose first column holds dates imports with ``time_is_datetime`` and
the X values in epoch seconds. With the X tick format left on ``auto`` the
export drew ``1.7723e9``-style numbers; it now draws calendar date + time --
the same rule the canvas applies (``axisFormat.dateAwareXFmt``). An explicit
format still wins. Synthetic data only.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import matplotlib.figure
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.axis_dates import date_aware_x_fmt, x_is_datetime

client = TestClient(app)
_T0 = datetime(2026, 3, 1, 12, 0, tzinfo=UTC).timestamp()


def _axes(monkeypatch: pytest.MonkeyPatch, body: dict[str, Any]) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json=body)
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1].axes[0]


def _body(metadata: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "dataset": {
            "time": [_T0 + 3600.0 * i for i in range(6)],
            "values": [[20.0 + i] for i in range(6)],
            "labels": ["Temp"], "units": ["C"], "metadata": metadata,
        },
        "y_keys": [0], "fmt": "svg",
        **extra,
    }


def _labels(ax: Any) -> list[str]:
    ax.figure.canvas.draw()
    return [t.get_text() for t in ax.get_xticklabels() if t.get_text()]


def test_auto_on_a_date_x_exports_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    labels = _labels(_axes(monkeypatch, _body({"time_is_datetime": True})))
    assert labels and all(lbl.startswith("2026-03-01") for lbl in labels), labels


def test_a_numeric_x_and_an_explicit_format_are_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    plain = _labels(_axes(monkeypatch, _body({})))
    assert not any("2026" in lbl for lbl in plain), plain
    fixed = _body({"time_is_datetime": True}, x_fmt={"mode": "fixed", "digits": 0})
    assert not any("2026-" in lbl for lbl in _labels(_axes(monkeypatch, fixed)))


def test_the_rule() -> None:
    assert date_aware_x_fmt(None, True) == {"digits": 2, "mode": "datetime"}
    assert date_aware_x_fmt({"mode": "auto", "digits": 3, "minor": 1}, True) == {
        "mode": "datetime", "digits": 3, "minor": 1,
    }
    assert date_aware_x_fmt({"mode": "sci", "digits": 2}, True) == {"mode": "sci", "digits": 2}
    assert date_aware_x_fmt(None, False) is None
    assert x_is_datetime({"time_is_datetime": True}, None)
    assert not x_is_datetime({"time_is_datetime": True}, 0)  # a channel as X
