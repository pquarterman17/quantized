"""Tests for io/origin_com.py (plan item 25: COM "Send to Origin") + the
/api/export/origin-com route.

Mock-based ONLY — this repo's own test suite never dispatches real Origin
COM (architecture guard #10). A fake ``win32com.client`` module is injected
via ``sys.modules`` so ``send_to_origin``'s LabTalk/``PutWorksheet`` call
sequence can be asserted deterministically, cross-platform, without pywin32
installed and without a running Origin.
"""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.io import origin_com

client = TestClient(app)


class _FakeApp:
    """Records every LabTalk Execute + PutWorksheet call, standing in for a
    real Origin.ApplicationSI COM object with zero COM behind it."""

    def __init__(self, fail_new_book: str | None = None) -> None:
        self.executed: list[str] = []
        self.worksheets: list[tuple[str, list[list[float]], int, int]] = []
        self._fail_new_book = fail_new_book

    def Execute(self, cmd: str) -> bool:
        self.executed.append(cmd)
        if self._fail_new_book and cmd == f"newbook name:={self._fail_new_book} option:=lsname;":
            return False
        return True

    def PutWorksheet(self, ref: str, rows: list[list[float]], x: int, y: int) -> bool:
        self.worksheets.append((ref, rows, x, y))
        return True


def _install_fake_win32com(monkeypatch: pytest.MonkeyPatch, app_obj: _FakeApp) -> list[str]:
    """Inject a fake win32com.client module into sys.modules so ``import
    win32com.client`` resolves without pywin32 installed. Returns the list of
    ProgIDs dispatched (should end up exactly ``["Origin.ApplicationSI"]``)."""
    dispatched: list[str] = []

    class _FakeGencache:
        @staticmethod
        def EnsureDispatch(progid: str) -> _FakeApp:
            dispatched.append(progid)
            return app_obj

    fake_client = types.ModuleType("win32com.client")
    fake_client.gencache = _FakeGencache  # type: ignore[attr-defined]
    fake_win32com = types.ModuleType("win32com")
    fake_win32com.client = fake_client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "win32com", fake_win32com)
    monkeypatch.setitem(sys.modules, "win32com.client", fake_client)
    return dispatched


def _make_available(monkeypatch: pytest.MonkeyPatch, app_obj: _FakeApp) -> list[str]:
    """Force com_available() True (Windows + flag) with a fake win32com."""
    monkeypatch.setattr(origin_com.sys, "platform", "win32")
    monkeypatch.setenv(origin_com._FLAG_ENV, "1")
    return _install_fake_win32com(monkeypatch, app_obj)


def _ds(
    time: list[float],
    values: list[list[float]],
    labels: tuple[str, ...] = ("Moment",),
    units: tuple[str, ...] = ("emu",),
    metadata: dict[str, Any] | None = None,
) -> DataStruct:
    return DataStruct.create(
        time=time, values=values, labels=labels, units=units, metadata=metadata or {}
    )


# ── com_available() ─────────────────────────────────────────────────────────


def test_com_available_false_off_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(origin_com.sys, "platform", "linux")
    monkeypatch.setenv(origin_com._FLAG_ENV, "1")
    assert origin_com.com_available() is False


def test_com_available_false_without_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(origin_com.sys, "platform", "win32")
    monkeypatch.delenv(origin_com._FLAG_ENV, raising=False)
    assert origin_com.com_available() is False


def test_com_available_false_when_pywin32_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(origin_com.sys, "platform", "win32")
    monkeypatch.setenv(origin_com._FLAG_ENV, "1")
    # Force ImportError regardless of whether pywin32 happens to be installed
    # on this machine: a None entry in sys.modules makes the import fail.
    monkeypatch.setitem(sys.modules, "win32com", None)
    assert origin_com.com_available() is False


def test_com_available_true_when_all_conditions_met(monkeypatch: pytest.MonkeyPatch) -> None:
    _make_available(monkeypatch, _FakeApp())
    assert origin_com.com_available() is True


# ── send_to_origin() ─────────────────────────────────────────────────────────


def test_send_to_origin_rejects_empty_datasets() -> None:
    with pytest.raises(ValueError, match="at least one dataset"):
        origin_com.send_to_origin([])


def test_send_to_origin_raises_when_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(origin_com.sys, "platform", "linux")
    with pytest.raises(RuntimeError, match=r"\.ogs"):
        origin_com.send_to_origin([_ds([1.0], [[2.0]])])


def test_send_to_origin_labtalk_call_sequence(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeApp()
    dispatched = _make_available(monkeypatch, fake)

    ds = _ds(
        time=[1.0, 2.0, 3.0],
        values=[[10.0, 100.0], [20.0, 200.0], [30.0, 300.0]],
        labels=("Moment", 'Signal "raw"'),
        units=("emu", ""),
        metadata={"x_column_name": "Field", "x_column_unit": "Oe"},
    )
    result = origin_com.send_to_origin([ds], book_names=["Loop A"])

    assert dispatched == ["Origin.ApplicationSI"]
    assert result == {"books": ["Loop_A"], "rows": [3]}

    # One newbook, then one range/label command per column (X + 2 Y).
    assert fake.executed[0] == "newbook name:=Loop_A option:=lsname;"
    assert len(fake.executed) == 4

    x_cmd = fake.executed[1]
    assert "range __c1 = [Loop_A]1!col(1);" in x_cmd
    assert '__c1.lname$ = "Field";' in x_cmd
    assert '__c1.unit$ = "Oe";' in x_cmd

    col2_cmd = fake.executed[2]
    assert "range __c2 = [Loop_A]1!col(2);" in col2_cmd
    assert '__c2.lname$ = "Moment";' in col2_cmd
    assert '__c2.unit$ = "emu";' in col2_cmd

    # Quote escaping: a raw double-quote in the label must survive escaped.
    col3_cmd = fake.executed[3]
    assert "range __c3 = [Loop_A]1!col(3);" in col3_cmd
    assert '__c3.lname$ = "Signal \\"raw\\"";' in col3_cmd
    assert "__c3.unit$" not in col3_cmd  # empty unit -> no assignment emitted

    # Exactly one PutWorksheet call: time column first, then value columns,
    # row-major, referencing sheet 1 of the new book.
    assert len(fake.worksheets) == 1
    ref, rows, x, y = fake.worksheets[0]
    assert ref == "[Loop_A]1"
    assert rows == [[1.0, 10.0, 100.0], [2.0, 20.0, 200.0], [3.0, 30.0, 300.0]]
    assert (x, y) == (0, 0)


def test_send_to_origin_multi_book_dedup_and_row_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeApp()
    _make_available(monkeypatch, fake)

    ds_a = _ds(time=[1.0, 2.0], values=[[1.0], [2.0]])
    ds_b = _ds(time=[1.0, 2.0, 3.0], values=[[1.0], [2.0], [3.0]])
    result = origin_com.send_to_origin([ds_a, ds_b], book_names=["Loop A", "Loop A"])

    assert result["books"] == ["Loop_A", "Loop_A2"]
    assert result["rows"] == [2, 3]
    newbooks = [c for c in fake.executed if c.startswith("newbook")]
    assert newbooks == [
        "newbook name:=Loop_A option:=lsname;",
        "newbook name:=Loop_A2 option:=lsname;",
    ]
    assert len(fake.worksheets) == 2


def test_send_to_origin_book_name_falls_back_to_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeApp()
    _make_available(monkeypatch, fake)

    ds = _ds(time=[1.0], values=[[1.0]], metadata={"origin_book": "MokeLoop"})
    result = origin_com.send_to_origin([ds])
    assert result["books"] == ["MokeLoop"]


def test_send_to_origin_newbook_failure_raises_runtime_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _FakeApp(fail_new_book="Book1")
    _make_available(monkeypatch, fake)

    with pytest.raises(RuntimeError, match="rejected 'newbook'"):
        origin_com.send_to_origin([_ds([1.0], [[1.0]])])


# ── /api/export/origin-com route ────────────────────────────────────────────


def _xrd_dataset() -> dict[str, Any]:
    return {
        "time": [1.0, 2.0],
        "values": [[10.0], [20.0]],
        "labels": ["Moment"],
        "units": ["emu"],
        "metadata": {},
    }


def test_origin_com_status_false_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(origin_com._FLAG_ENV, raising=False)
    resp = client.get("/api/export/origin-com/status")
    assert resp.status_code == 200
    assert resp.json() == {"available": False}


def test_origin_com_status_true_when_monkeypatched(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("quantized.routes.export.com_available", lambda: True)
    resp = client.get("/api/export/origin-com/status")
    assert resp.status_code == 200
    assert resp.json() == {"available": True}


def test_export_origin_com_rejects_empty_datasets() -> None:
    resp = client.post("/api/export/origin-com", json={"datasets": []})
    assert resp.status_code == 422


def test_export_origin_com_409_when_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("quantized.routes.export.com_available", lambda: False)
    resp = client.post(
        "/api/export/origin-com",
        json={"datasets": [{"dataset": _xrd_dataset(), "name": "LoopA"}]},
    )
    assert resp.status_code == 409
    assert "origin-project" in resp.json()["detail"]


def test_export_origin_com_200_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: dict[str, Any] = {}

    def _fake_send_to_origin(datasets: Any, *, book_names: Any = None) -> dict[str, Any]:
        calls["datasets"] = datasets
        calls["book_names"] = book_names
        return {"books": ["LoopA"], "rows": [2]}

    monkeypatch.setattr("quantized.routes.export.com_available", lambda: True)
    monkeypatch.setattr("quantized.routes.export.send_to_origin", _fake_send_to_origin)

    resp = client.post(
        "/api/export/origin-com",
        json={"datasets": [{"dataset": _xrd_dataset(), "name": "LoopA"}]},
    )
    assert resp.status_code == 200
    assert resp.json() == {"books": ["LoopA"], "rows": [2]}
    assert calls["book_names"] == ["LoopA"]
    assert len(calls["datasets"]) == 1
    assert isinstance(calls["datasets"][0], DataStruct)


def test_export_origin_com_maps_runtime_error_to_409(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fail(datasets: Any, *, book_names: Any = None) -> dict[str, Any]:
        raise RuntimeError("Origin rejected 'newbook' for workbook 'X'.")

    monkeypatch.setattr("quantized.routes.export.com_available", lambda: True)
    monkeypatch.setattr("quantized.routes.export.send_to_origin", _fail)

    resp = client.post(
        "/api/export/origin-com",
        json={"datasets": [{"dataset": _xrd_dataset(), "name": "X"}]},
    )
    assert resp.status_code == 409
    assert "newbook" in resp.json()["detail"]
