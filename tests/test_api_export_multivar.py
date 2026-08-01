"""Integration tests for /api/export/{correlation-heatmap,splom,pca,pca-scree}
-figure (TestClient). Rendering math is golden in test_calc_figure_multivar;
here we prove the transport: downloadable file responses, filename
sanitization, and 422-on-ValueError (JMP_GAP_PLAN #10 residual)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_correlation_heatmap_download() -> None:
    resp = client.post(
        "/api/export/correlation-heatmap-figure",
        json={"labels": ["a", "b"], "r": [[1.0, 0.5], [0.5, 1.0]], "filename": "corr"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.headers["content-disposition"] == 'attachment; filename="corr.pdf"'
    assert resp.content[:4] == b"%PDF"


def test_correlation_heatmap_bad_shape_is_422_not_500() -> None:
    resp = client.post(
        "/api/export/correlation-heatmap-figure",
        json={"labels": ["a", "b", "c"], "r": [[1.0, 0.5], [0.5, 1.0]]},
    )
    assert resp.status_code == 422


def test_splom_download_svg() -> None:
    resp = client.post(
        "/api/export/splom-figure",
        json={
            "labels": ["a", "b", "c"],
            "columns": [[1.0, 2.0, 3.0, 4.0], [4.0, 3.0, 2.0, 1.0], [1.0, 1.0, 2.0, 2.0]],
            "fmt": "svg",
            "filename": "splom",
        },
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/svg+xml"
    assert resp.content[:5] == b"<?xml"


def test_splom_too_few_variables_is_422_not_500() -> None:
    resp = client.post("/api/export/splom-figure", json={"labels": ["a"], "columns": [[1.0, 2.0]]})
    assert resp.status_code == 422


def test_pca_scores_download() -> None:
    resp = client.post(
        "/api/export/pca-figure",
        json={"mode": "scores", "points": [[1.0, 0.2], [2.0, -0.1], [3.0, 0.4]], "fmt": "png"},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:4] == b"\x89PNG"


def test_pca_biplot_download() -> None:
    resp = client.post(
        "/api/export/pca-figure",
        json={
            "mode": "biplot",
            "points": [[1.0, 0.5], [-1.0, -0.5]],
            "vectors": [{"x": 0.8, "y": 0.2, "label": "a"}],
            "fmt": "pdf",
        },
    )
    assert resp.status_code == 200
    assert resp.content[:4] == b"%PDF"


def test_pca_figure_empty_is_422_not_500() -> None:
    resp = client.post("/api/export/pca-figure", json={"mode": "scores"})
    assert resp.status_code == 422


def test_pca_scree_download() -> None:
    resp = client.post(
        "/api/export/pca-scree-figure",
        json={"explained": [70.0, 20.0, 10.0], "cumulative": [70.0, 90.0, 100.0]},
    )
    assert resp.status_code == 200
    assert resp.content[:4] == b"%PDF"


def test_pca_scree_length_mismatch_is_422_not_500() -> None:
    resp = client.post(
        "/api/export/pca-scree-figure",
        json={"explained": [70.0, 30.0], "cumulative": [70.0]},
    )
    assert resp.status_code == 422


def test_filename_is_sanitized() -> None:
    resp = client.post(
        "/api/export/correlation-heatmap-figure",
        json={
            "labels": ["a", "b"],
            "r": [[1.0, 0.5], [0.5, 1.0]],
            "filename": '../../evil"\r\nX: y',
        },
    )
    assert resp.status_code == 200
    cd = resp.headers["content-disposition"]
    assert "\r" not in cd and "\n" not in cd and '"y' not in cd
    assert cd.endswith('.pdf"')
