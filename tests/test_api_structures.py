"""CIF import: the registry's structure dispatch and ``/api/structures/*``.

A CIF is a crystal structure (cell + atom sites), not a time/value series, so
it never becomes a DataStruct: the registry names it a STRUCTURE file, the
DataStruct import path refuses it with a pointer, and the structure routes
return the parsed cell for the XRD tools' lattice presets.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.io.registry import (
    import_auto,
    import_structure,
    is_structure_file,
    register_parser,
    unregister_plugin_parsers,
)

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "SrTiO3.cif"


def test_registry_knows_cif_is_a_structure() -> None:
    assert is_structure_file(Path("x.CIF"))
    assert not is_structure_file(Path("x.csv"))
    s = import_structure(FIXTURE)
    assert s["cellParams"]["a"] == pytest.approx(3.905)


def test_datastruct_import_refuses_cif_with_a_pointer() -> None:
    with pytest.raises(ValueError, match="crystal structure"):
        import_auto(FIXTURE)


def test_plugins_cannot_shadow_cif() -> None:
    try:
        with pytest.raises(ValueError, match="already claimed"):
            register_parser([".cif"], lambda p: import_auto(p))
    finally:
        unregister_plugin_parsers()


def _check_srtio3(body: dict[str, object]) -> None:
    assert body["name"] == "SrTiO3"
    assert body["formula"] == "Sr Ti O3"
    assert body["space_group"] == "Pm-3m"
    assert body["source_name"] == "SrTiO3.cif"
    cell = body["cell"]
    assert isinstance(cell, dict)
    assert cell["a"] == pytest.approx(3.905) and cell["gamma"] == pytest.approx(90.0)
    sites = body["atom_sites"]
    assert isinstance(sites, list) and [s["symbol"] for s in sites] == ["Sr", "Ti", "O"]


def test_upload_cif_returns_the_structure() -> None:
    resp = client.post(
        "/api/structures/upload",
        files={"file": ("SrTiO3.cif", FIXTURE.read_bytes(), "chemical/x-cif")},
    )
    assert resp.status_code == 200, resp.text
    _check_srtio3(resp.json())


def test_import_cif_path_returns_the_structure(tmp_path: Path) -> None:
    dest = tmp_path / "SrTiO3.cif"
    dest.write_bytes(FIXTURE.read_bytes())
    resp = client.post("/api/structures/import", json={"path": str(dest)})
    assert resp.status_code == 200, resp.text
    _check_srtio3(resp.json())


def test_missing_cell_values_are_null_not_nan() -> None:
    text = "data_partial\n_cell_length_a 4.0\n_cell_angle_alpha 90\n"
    resp = client.post(
        "/api/structures/upload", files={"file": ("partial.cif", text.encode(), "text/plain")},
    )
    assert resp.status_code == 200, resp.text
    cell = resp.json()["cell"]
    assert cell["a"] == pytest.approx(4.0) and cell["b"] is None


def test_upload_rejects_a_non_cif_extension() -> None:
    resp = client.post(
        "/api/structures/upload", files={"file": ("data.csv", b"a,b\n1,2\n", "text/csv")},
    )
    assert resp.status_code == 422


def test_upload_rejects_a_cif_with_no_data_block() -> None:
    resp = client.post(
        "/api/structures/upload", files={"file": ("empty.cif", b"# nothing here\n", "text/plain")},
    )
    assert resp.status_code == 422


def test_import_path_outside_roots_is_refused() -> None:
    resp = client.post("/api/structures/import", json={"path": "/etc/passwd.cif"})
    assert resp.status_code in (403, 404)


def test_datastruct_upload_of_a_cif_is_a_clear_422() -> None:
    resp = client.post(
        "/api/parsers/upload",
        files={"file": ("SrTiO3.cif", FIXTURE.read_bytes(), "chemical/x-cif")},
    )
    assert resp.status_code == 422
    assert "crystal structure" in resp.json()["detail"]
