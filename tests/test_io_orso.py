"""ORSO ``.ort`` reduced reflectometry (standards 0.1 and 1.0).

The committed fixture ``orso_polarized_synth.ort`` is synthetic, modelled on the
format (two spin states, 1.0 header). Inline files cover the 0.1 header layout,
``1/nm`` units, extra columns and the rejections. The realdata tests read the
local MIT-licensed orsopy examples and skip in CI.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.io import import_auto
from quantized.io._orso_yaml import load_header
from quantized.io.orso import import_orso
from quantized.io.registry import is_recognised_data_name, resolve_parser

FIXTURE = Path(__file__).parent / "fixtures" / "orso_polarized_synth.ort"
MAGIC_01 = "# # ORSO reflectivity data file | 0.1 standard | YAML encoding | https://www.reflectometry.org/\n"
MAGIC_10 = MAGIC_01.replace("0.1 standard", "1.0 standard")


def _write(tmp_path: Path, text: str, name: str = "f.ort") -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


# ── the two-spin-state 1.0 fixture ───────────────────────────────────────────


def test_data_sets_become_separate_channels() -> None:
    ds = import_orso(FIXTURE)
    assert ds.labels == ("R pp", "sR pp", "R mm", "sR mm", "sQz")
    assert ds.units == ("", "", "", "", "Å⁻¹")
    np.testing.assert_allclose(ds.time, [0.01, 0.02, 0.03, 0.015, 0.025])
    # Each state's channels hold its own rows only; NaN elsewhere.
    np.testing.assert_allclose(ds.values[:3, 0], [0.9, 0.1, 0.01])
    assert np.isnan(ds.values[3:, 0]).all()
    np.testing.assert_allclose(ds.values[3:, 2], [0.8, 0.05])
    assert np.isnan(ds.values[:3, 2]).all()
    # sQz is shared: every row carries its own block's resolution.
    np.testing.assert_allclose(ds.values[:, 4], [1e-4, 2e-4, 3e-4, 1.5e-4, 2.5e-4])


def test_error_roles_follow_the_error_of_declarations() -> None:
    meta = import_orso(FIXTURE).metadata
    assert meta["default_value_channels"] == [0, 2]
    assert meta["error_channels"] == {0: 1, 2: 3}
    assert {"channel": 1, "target": 0, "axis": "y", "side": "both"} in meta["error_roles"]
    assert {"channel": 3, "target": 2, "axis": "y", "side": "both"} in meta["error_roles"]
    assert {"channel": 4, "target": -1, "axis": "x", "side": "both"} in meta["error_roles"]


def test_header_metadata() -> None:
    meta = import_orso(FIXTURE).metadata
    assert meta["parser_name"] == "import_orso"
    assert meta["orso_version"] == "1.0"
    assert meta["x_column_name"] == "Qz"
    assert meta["x_column_unit"] == "Å⁻¹"
    assert meta["name"] == meta["sample_name"] == "FeSi-synth"
    assert meta["instrument"] == "TestRefl"
    assert meta["facility"] == "Nowhere"
    assert meta["probe"] == "neutron"
    assert meta["title"] == "Synthetic polarized reflectivity"
    assert meta["start_date"] == "2024-01-02T03:04:05"
    assert meta["polarization"] == ["pp", "mm"]
    assert meta["data_sets"] == ["up", "down"]
    assert meta["block_rows"] == [[0, 3], [3, 5]]
    assert meta["data_files"] == [{"file": "synth_0001.nxs", "timestamp": "2024-01-02T03:04:05"}]
    assert meta["reduction_software"] == "synth-reduce 1.0"
    assert meta["reduction_timestamp"] == "2024-01-02T04:00:00"
    # The full first-block header survives for the Inspector.
    wl = meta["orso_header"]["data_source"]["measurement"]["instrument_settings"]["wavelength"]
    assert wl["comment"] == "a long comment that wraps onto a second line"


def test_import_auto_routes_and_tags_reflectometry() -> None:
    assert resolve_parser(FIXTURE) is import_orso
    assert is_recognised_data_name("x.ORT")
    ds = import_auto(FIXTURE)
    assert ds.metadata["technique"] == "reflectometry"
    assert ds.metadata["parser_name"] == "import_orso"


# ── 0.1 standard, units, extra columns ───────────────────────────────────────

_HEADER_01 = (
    MAGIC_01
    + "# data_source:\n"
    + "#     experiment:\n"
    + "#         instrument: Amor\n"
    + "#     sample:\n"
    + "#         name: Ni1000\n"
    + "#         description: |\n"
    + "#             amb: air\n"
    + "#             sub: Si\n"
    + "#     measurement:\n"
    + "#         instrument_settings:\n"
    + "#             wavelength:\n"
    + "#                  resolution:\n"
    + "#                      value: 0.022 # Delta lambda / lambda\n"
    + "#             polarization: po\n"
    + "#         data_files:\n"
    + "#             - file      : a.hdf\n"
    + "#               timestamp : 2020-02-03T14:27:45+01:00\n"
    + "# reduction:\n"
    + "#     comment:\n"
    + "#         corrections performed by normalisation\n"
    + "#         to a reference sample\n"
    + "# columns:\n"
    + "#     - {name: Qz, unit: 1/angstrom, dimension: WW transfer}\n"
    + "#     - {name: R, dimension: reflectivity}\n"
    + "#     - {error_of: R}\n"
    + "#     - {error_of: Qz, error_type: resolution}\n"
    + "# data_set: spin_up\n"
    + "# #         Qz             RQz              sR              sQ\n"
)


def test_standard_0_1_header(tmp_path: Path) -> None:
    rows = "1.0e-02 3.9e+00 4.3e+00 5.2e-05\n1.1e-02 1.2e+01 8.9e+00 5.3e-05\n"
    ds = import_orso(_write(tmp_path, _HEADER_01 + rows))
    assert ds.labels == ("R", "sR", "sQz")
    assert ds.units == ("", "", "Å⁻¹")
    meta = ds.metadata
    assert meta["orso_version"] == "0.1"
    assert meta["polarization"] == "po"
    assert meta["data_sets"] == ["spin_up"]
    assert meta["data_files"] == [{"file": "a.hdf", "timestamp": "2020-02-03T14:27:45+01:00"}]
    sample = meta["orso_header"]["data_source"]["sample"]
    assert sample["description"] == "amb: air\nsub: Si"
    res = meta["orso_header"]["data_source"]["measurement"]["instrument_settings"]
    assert res["wavelength"]["resolution"]["value"] == 0.022
    comment = meta["orso_header"]["reduction"]["comment"]
    assert comment == "corrections performed by normalisation to a reference sample"
    assert meta["default_value_channels"] == [0]
    assert meta["error_channels"] == {0: 1}


def test_inverse_nanometre_and_extra_columns(tmp_path: Path) -> None:
    text = (
        MAGIC_10
        + "# data_source: {sample: {name: s}}\n"
        + "# columns:\n"
        + "# - {name: Qz, unit: 1/nm}\n"
        + "# - {name: R}\n"
        + "# - {error_of: R, error_type: uncertainty, value_is: sigma}\n"
        + "# - {error_of: Qz, error_type: resolution, value_is: FWHM}\n"
        + "# - {name: alpha_i, unit: deg}\n"
        + "0.1 0.5 0.01 0.001 0.3\n0.2 0.05 0.002 0.002 0.6\n"
    )
    ds = import_orso(_write(tmp_path, text))
    assert ds.labels == ("R", "sR", "sQz", "alpha_i")
    assert ds.units == ("", "", "nm⁻¹", "deg")
    assert ds.metadata["x_column_unit"] == "nm⁻¹"
    # Only R is a default curve; alpha_i stays in the worksheet.
    assert ds.metadata["default_value_channels"] == [0]
    # The FWHM declaration is kept, not silently reinterpreted.
    assert ds.metadata["orso_columns"][3]["value_is"] == "FWHM"


def test_data_set_names_label_blocks_without_polarization(tmp_path: Path) -> None:
    head = MAGIC_10 + "# columns:\n# - {name: Qz, unit: 1/angstrom}\n# - {name: R}\n"
    text = (
        head
        + "# data_set: 300K\n0.01 0.9\n0.02 0.1\n"
        + "# data_set: 10K\n0.01 0.8\n"
    )
    ds = import_orso(_write(tmp_path, text))
    assert ds.labels == ("R 300K", "R 10K")
    assert ds.metadata["default_value_channels"] == [0, 1]


# ── rejections ───────────────────────────────────────────────────────────────


def test_bare_columns_are_not_orso(tmp_path: Path) -> None:
    path = _write(tmp_path, "1.0 2.0 3.0\n2.0 3.0 4.0\n", "bare.ort")
    with pytest.raises(ValueError, match="not an ORSO file"):
        import_orso(path)
    with pytest.raises(ValueError, match="not an ORSO file"):
        import_auto(path)


def test_missing_columns_header(tmp_path: Path) -> None:
    path = _write(tmp_path, MAGIC_10 + "# data_set: 0\n0.01 0.9\n")
    with pytest.raises(ValueError, match="'columns'"):
        import_orso(path)


def test_first_column_must_be_qz(tmp_path: Path) -> None:
    path = _write(tmp_path, MAGIC_10 + "# columns:\n# - {name: Q}\n# - {name: R}\n0.01 0.9\n")
    with pytest.raises(ValueError, match="Qz"):
        import_orso(path)


def test_no_data_rows(tmp_path: Path) -> None:
    path = _write(tmp_path, MAGIC_10 + "# columns:\n# - {name: Qz}\n# - {name: R}\n")
    with pytest.raises(ValueError, match="no numeric data"):
        import_orso(path)


# ── the YAML subset ──────────────────────────────────────────────────────────


def test_yaml_subset_shapes() -> None:
    doc = load_header(
        [
            "a:",
            "- {x: 1, y: 'q, r', z: [1, 2.5, null]}",
            "- k : v",
            "  k2: true",
            "- plain",
            "b: {m: 1,",
            "    n: two}",
            "c: \"quoted # not a comment\"  # a comment",
            "d: b''",
            "e: ''",
            "f: 2020 0304",
            "g: []",
            "h:",
            "  nested:",
            "    deep: -9999.0",
        ]
    )
    assert doc == {
        "a": [{"x": 1, "y": "q, r", "z": [1, 2.5, None]}, {"k": "v", "k2": True}, "plain"],
        "b": {"m": 1, "n": "two"},
        "c": "quoted # not a comment",
        "d": "b''",
        "e": "",
        "f": "2020 0304",
        "g": [],
        "h": {"nested": {"deep": -9999.0}},
    }


# ── the real orsopy examples (local corpus) ──────────────────────────────────


@pytest.mark.realdata
def test_realdata_orsopy_examples(corpus_dir: Path) -> None:
    root = corpus_dir / "orso" / "reflectometry"
    if not root.is_dir():
        pytest.skip("orso corpus not present")

    v10 = import_auto(root / "orsopy_prist5_10K_v1.0.ort")
    assert v10.labels == ("R", "sR", "sQz")
    assert v10.metadata["orso_version"] == "1.0"
    assert v10.metadata["sample_name"] == "prist4"
    assert v10.metadata["instrument"] == "Amor"
    assert v10.metadata["technique"] == "reflectometry"
    assert v10.time[0] == pytest.approx(2.2e-3)
    assert v10.values.shape[0] == len(
        [ln for ln in (root / "orsopy_prist5_10K_v1.0.ort").read_text().splitlines()
         if ln.strip() and not ln.startswith("#")]
    )

    one = import_auto(root / "orsopy_example_v0.1.ort")
    assert one.metadata["orso_version"] == "0.1"
    assert one.labels == ("R", "sR", "sQz")
    assert one.metadata["polarization"] == "po"

    two = import_auto(root / "orsopy_example2_v0.1.ort")
    assert two.labels == ("R po", "sR po", "R mo", "sR mo", "sQz")
    assert two.metadata["data_sets"] == ["spin_up", "spin_down"]

    with pytest.raises(ValueError, match="not an ORSO file"):
        import_auto(root / "orsopy_not_orso.ort")
