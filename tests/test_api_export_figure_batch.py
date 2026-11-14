"""Transport and archive-safety tests for POST /api/export/figure-batch."""

from __future__ import annotations

import io
import re
import threading
import zipfile

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.routes.export_figure_batch import FigureBatchRequest, _export_figure_batch

client = TestClient(create_app())


def _figure(filename: str = "sample", fmt: str = "svg") -> dict[str, object]:
    return {
        "dataset": {
            "time": [0.0, 1.0],
            "values": [[1.0, 2.0]],
            "labels": ["signal"],
            "units": ["a.u."],
            "metadata": {},
        },
        "y_keys": [0],
        "fmt": fmt,
        "filename": filename,
    }


def test_batch_export_returns_one_zip_with_safe_unique_figure_names(monkeypatch) -> None:
    calls: list[tuple[str, str, int]] = []

    def fake_render(req, *, fmt: str, dpi: int) -> bytes:
        calls.append((req.filename, fmt, dpi))
        return f"{req.filename}:{fmt}".encode()

    monkeypatch.setattr(
        "quantized.routes.export_figure_batch.render_figure_request", fake_render
    )
    response = client.post(
        "/api/export/figure-batch",
        json={
            "filename": "My batch",
            "figures": [
                _figure("scan one"),
                _figure("scan/one"),
                _figure("SCAN_ONE"),
            ],
        },
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"] == 'attachment; filename="My_batch.zip"'
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == ["scan_one.svg", "scan_one_2.svg", "SCAN_ONE_3.svg"]
        assert archive.read("scan_one.svg") == b"scan one:svg"
    assert calls == [("scan one", "svg", 200), ("scan/one", "svg", 200), ("SCAN_ONE", "svg", 200)]


def test_batch_export_rejects_empty_oversized_and_unknown_format() -> None:
    assert client.post("/api/export/figure-batch", json={"figures": []}).status_code == 422
    assert client.post(
        "/api/export/figure-batch",
        json={"figures": [_figure() for _ in range(65)]},
    ).status_code == 422
    response = client.post(
        "/api/export/figure-batch",
        json={"figures": [_figure(fmt="bmp")]},
    )
    assert response.status_code == 422
    assert "fmt must be one of" in response.json()["detail"]


def test_batch_export_validates_every_format_before_rendering(monkeypatch) -> None:
    monkeypatch.setattr(
        "quantized.routes.export_figure_batch.render_figure_request",
        lambda *_args, **_kwargs: pytest.fail("validation must finish before rendering"),
    )
    response = client.post(
        "/api/export/figure-batch",
        json={"figures": [_figure("valid"), _figure("invalid", fmt="bmp")]},
    )
    assert response.status_code == 422
    assert "fmt must be one of" in response.json()["detail"]


def test_batch_export_is_all_or_nothing_when_a_render_fails(monkeypatch) -> None:
    calls = 0

    def fail_second(_req, *, fmt: str, dpi: int) -> bytes:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise ValueError("bad second figure")
        return b"first"

    monkeypatch.setattr(
        "quantized.routes.export_figure_batch.render_figure_request", fail_second
    )
    response = client.post(
        "/api/export/figure-batch",
        json={"figures": [_figure("first"), _figure("second")]},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "bad second figure"


def test_batch_export_stops_before_the_next_render_after_disconnect(monkeypatch) -> None:
    monkeypatch.setattr(
        "quantized.routes.export_figure_batch.render_figure_request",
        lambda *_args, **_kwargs: pytest.fail("render must not start after disconnect"),
    )
    gone = threading.Event()
    gone.set()
    request = FigureBatchRequest.model_validate({"figures": [_figure()]})

    with pytest.raises(HTTPException) as caught:
        _export_figure_batch(request, gone)
    assert caught.value.status_code == 499


def _real(filename: str, fmt: str = "svg") -> dict[str, object]:
    fig = _figure(filename, fmt)
    fig["dataset"] = {**fig["dataset"], "values": [[1.0], [2.0]]}  # type: ignore[dict-item]
    return fig


def test_multipage_batch_is_one_pdf_with_a_page_per_figure() -> None:
    """Gap-audit-2 #10: one PDF, a page per figure in request order, each at
    its own size -- the real renderer, not a fake."""
    small = {**_real("b", fmt="png"), "width_in": 3.0, "height_in": 2.0}
    response = client.post(
        "/api/export/figure-batch",
        json={"filename": "Group meeting", "multipage": True, "figures": [_real("a"), small]},
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == 'attachment; filename="Group_meeting.pdf"'
    body = response.content
    assert body.startswith(b"%PDF")
    assert len(re.findall(rb"/Type /Page\b", body)) == 2
    boxes = re.findall(rb"/MediaBox \[ 0 0 ([\d.]+) ([\d.]+) \]", body)
    assert (b"216", b"144") in boxes  # the 3 x 2 in page keeps its size


def test_multipage_batch_is_all_or_nothing() -> None:
    bad = {**_real("bad"), "y_keys": [7]}
    response = client.post(
        "/api/export/figure-batch",
        json={"multipage": True, "figures": [_real("a"), bad]},
    )
    assert response.status_code == 422
    assert not response.content.startswith(b"%PDF")
