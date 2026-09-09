"""NCNR reductus .refl parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.io import import_auto
from quantized.io.ncnr import import_ncnr_dat, import_ncnr_pnr, import_ncnr_refl, is_ncnr_refl


@pytest.mark.golden
def test_ncnr_refl_matches_matlab(
    fixtures_dir: Path,
    load_golden: Callable[[str], dict[str, Any]],
) -> None:
    ref = load_golden("ncnr_j395_default.json")
    ds = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    assert list(ds.labels) == list(ref["labels"])
    assert list(ds.units) == list(ref["units"])
    assert_allclose(ds.time, np.asarray(ref["time"], dtype=float), rtol=1e-9, atol=1e-12)
    ref_values = np.asarray(ref["values"], dtype=float).reshape(ds.values.shape)
    assert_allclose(ds.values, ref_values, rtol=1e-9, atol=1e-12)


def test_ncnr_refl_structure(fixtures_dir: Path) -> None:
    ds = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    # time = Qz; values = Intensity / uncertainty / resolution
    assert ds.labels == ("Intensity", "uncertainty", "resolution")
    assert ds.metadata["x_column_name"] == "Qz"
    assert ds.n_channels == 3
    assert ds.n_points == 325


def test_registry_routes_refl(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "ncnr_j395.refl")
    assert ds.metadata["parser_name"] == "import_ncnr_refl"


# ── .refl dual-format disambiguation (reductus vs refl1d-exported) ────────────
# The reductus "template_data" header line alone runs to ~30 KB, with the
# "columns" key only on a later line — the sniffer must scan line-by-line.
_REFL1D_STYLE_REFL = (
    "# intensity: 1.04776102038159\n"
    "# background: 0.0\n"
    "# Q (1/A) dQ R dR theory fresnel\n"
    "0.01 0.001 0.50 0.01 0.50 0.60\n"
    "0.02 0.001 0.30 0.01 0.31 0.40\n"
    "0.03 0.001 0.10 0.01 0.11 0.20\n"
)


def test_is_ncnr_refl_true_for_reductus(fixtures_dir: Path) -> None:
    assert is_ncnr_refl(fixtures_dir / "ncnr_j395.refl") is True


def test_is_ncnr_refl_false_for_refl1d_style(tmp_path: Path) -> None:
    f = tmp_path / "model.refl"
    f.write_text(_REFL1D_STYLE_REFL, encoding="latin-1")
    assert is_ncnr_refl(f) is False


def test_registry_routes_refl1d_style_refl(tmp_path: Path) -> None:
    """A refl1d-exported .refl (Q/R column header, no JSON "columns") must route to
    the refl1d parser, not crash in import_ncnr_refl ("no columns header")."""
    f = tmp_path / "model.refl"
    f.write_text(_REFL1D_STYLE_REFL, encoding="latin-1")
    ds = import_auto(f)
    assert ds.metadata["parser_name"] == "import_refl1d_dat"
    assert ds.metadata["x_column_name"] == "Q"
    assert ds.labels == ("dQ", "R", "dR", "theory", "fresnel")


# ── Polarized .pnr ────────────────────────────────────────────────────────
@pytest.mark.golden
def test_ncnr_pnr_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_ncnr_pnr(fixtures_dir / "ncnr_s11_nsf.pnr")
    assert_golden(ds, "ncnr_s11_nsf_default.json")


def test_ncnr_pnr_cleans_polarization_labels(fixtures_dir: Path) -> None:
    ds = import_ncnr_pnr(fixtures_dir / "ncnr_s11_nsf.pnr")
    assert ds.metadata["variant"] == "NSF"
    assert "Rpp" in ds.labels  # R++ -> Rpp
    assert "Rmm" in ds.labels  # R-- -> Rmm
    assert not any("+" in label for label in ds.labels)


def test_registry_routes_pnr(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "ncnr_s11_nsf.pnr")
    assert ds.metadata["parser_name"] == "import_ncnr_pnr"


# ── Cross-section .datA ───────────────────────────────────────────────────
@pytest.mark.golden
def test_ncnr_dat_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_ncnr_dat(fixtures_dir / "ncnr_s3.datA")
    assert_golden(ds, "ncnr_s3_datA_default.json")


def test_ncnr_dat_polarization_from_extension(fixtures_dir: Path) -> None:
    ds = import_ncnr_dat(fixtures_dir / "ncnr_s3.datA")
    assert ds.metadata["polarization"] == "++"
    assert ds.metadata["x_column_name"] == "Q"


def test_registry_routes_datA(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "ncnr_s3.datA")
    assert ds.metadata["parser_name"] == "import_ncnr_dat"


def test_ncnr_metadata_beyond_first_five_lines(tmp_path: Path) -> None:
    """intensity/background sitting past line 5 must still be captured (the scan
    was capped at lines[:5])."""
    f = tmp_path / "late_meta.datA"
    f.write_text(
        "# c1\n# c2\n# c3\n# c4\n# c5\n"
        "# intensity: 1.2345\n"  # index 5 — beyond the old lines[:5] window
        "# background: 0.001\n"
        "# Q (1/A) R dR\n"
        "0.01 0.5 0.01\n0.02 0.6 0.01\n0.03 0.7 0.01\n",
        encoding="latin-1",
    )
    ds = import_ncnr_dat(f)
    assert ds.metadata["intensity"] == pytest.approx(1.2345)
    assert ds.metadata["background"] == pytest.approx(0.001)
    assert ds.n_points == 3


def test_ncnr_dat_default_plot_hints(tmp_path: Path) -> None:
    """A full cross section emits plot hints: default to R + fit (theory) with
    dR as R's error bars; dQ and fresnel stay off the plot by default."""
    f = tmp_path / "hints.datA"
    f.write_text(
        "# Q (1/A) dQ R dR theory fresnel\n"
        "0.01 0.001 0.5 0.01 0.51 1.0\n"
        "0.02 0.001 0.6 0.01 0.61 1.0\n"
        "0.03 0.001 0.7 0.01 0.71 1.0\n",
        encoding="latin-1",
    )
    ds = import_ncnr_dat(f)
    assert list(ds.labels) == ["dQ", "R", "dR", "theory", "fresnel"]
    # R (value-col 1) + theory (3) plotted by default; dQ (0), dR (2), fresnel (4) off.
    assert ds.metadata["default_value_channels"] == [1, 3]
    # dR (2) is R's (1) error bars.
    assert ds.metadata["error_channels"] == {1: 2}


def test_ncnr_dat_hints_absent_when_columns_missing(tmp_path: Path) -> None:
    """A minimal 3-column file (Q dQ R) has no theory/fresnel — the default set
    is just R, and there's no dR so no error pairing is emitted."""
    f = tmp_path / "min.datA"
    f.write_text(
        "# Q (1/A) dQ R\n0.01 0.001 0.5\n0.02 0.001 0.6\n0.03 0.001 0.7\n",
        encoding="latin-1",
    )
    ds = import_ncnr_dat(f)
    assert list(ds.labels) == ["dQ", "R"]
    assert ds.metadata["default_value_channels"] == [1]  # R only
    assert "error_channels" not in ds.metadata  # no dR column

# ── BUG-001: reductus uncertainty/resolution roles ───────────────────────────
# The measured intensity, its uncertainty and the Q resolution arrive as three
# ordinary numeric columns; nothing in the file marks the latter two as
# uncertainties, so they used to import as independent Y series and be drawn
# as their own curves. The generic label guesser does not rescue it either.
# These pin the parser-declared roles AND the fail-safe: recognition is gated
# on name AND unit, and anything unrecognised emits nothing rather than
# guessing.

from quantized.io.ncnr import _refl_role_metadata  # noqa: E402


def test_refl_declares_uncertainty_and_resolution_roles(fixtures_dir: Path) -> None:
    ds = import_ncnr_refl(fixtures_dir / "ncnr_j395.refl")
    # Only the measurement is a curve.
    assert ds.metadata["default_value_channels"] == [0]
    # Rich contract: symmetric Y error on the intensity, symmetric X error on
    # the Q axis (`target: -1` -- the x axis is not a channel).
    assert ds.metadata["error_roles"] == [
        {"channel": 1, "target": 0, "axis": "y", "side": "both"},
        {"channel": 2, "target": -1, "axis": "x", "side": "both"},
    ]
    # Legacy Y-only projection, for the surfaces that still read it.
    assert ds.metadata["error_channels"] == {0: 1}
    # Every imported column is still present and untouched.
    assert ds.labels == ("Intensity", "uncertainty", "resolution")
    assert ds.values.shape == (325, 3)


def test_refl_roles_require_matching_units_not_just_names() -> None:
    """The uncertainty of an intensity carries the intensity's unit and a Q
    resolution carries the axis's unit. Names alone are not evidence -- a
    column whose unit disagrees with what its name claims does not bind -- but
    (per-column recognition) that failure is scoped to JUST that column: the
    other channel's own, independent evidence still binds when it holds up."""
    labels = ["Intensity", "uncertainty", "resolution"]
    assert _refl_role_metadata(labels, ["counts", "counts", "1/Ang"], "1/Ang")

    # uncertainty in a different unit from the value it supposedly describes:
    # only resolution (independent evidence) binds; uncertainty stays plotted.
    meta = _refl_role_metadata(labels, ["counts", "1/Ang", "1/Ang"], "1/Ang")
    assert meta["default_value_channels"] == [0, 1]
    assert meta["error_roles"] == [{"channel": 2, "target": -1, "axis": "x", "side": "both"}]
    assert "error_channels" not in meta

    # resolution not in the x axis's unit: only uncertainty binds. The declined
    # "resolution" column is NOT plotted -- we did not identify it, so we do not
    # get to assert it is data (review round; see `_refl_role_metadata`).
    meta = _refl_role_metadata(labels, ["counts", "counts", "counts"], "1/Ang")
    assert meta["default_value_channels"] == [0]
    assert meta["error_roles"] == [{"channel": 1, "target": 0, "axis": "y", "side": "both"}]
    assert meta["error_channels"] == {0: 1}

    # A unit that DISAGREES with its predecessor is still not an uncertainty:
    # here "" vs "counts" disagree, so only resolution binds and there is no
    # measurement to name, so both unbound channels are offered.
    meta = _refl_role_metadata(labels, ["counts", "", "1/Ang"], "1/Ang")
    assert meta["default_value_channels"] == [0, 1]
    assert meta["error_roles"] == [{"channel": 2, "target": -1, "axis": "x", "side": "both"}]
    assert "error_channels" not in meta

    # But two BLANK units AGREE, and that must bind. Reflectivity is
    # dimensionless, so an ordinary reductus R/dR file looks exactly like this;
    # refusing to bind here was a real bug (review round) that reproduced the
    # original BUG-001 symptom -- dR drawn as its own curve.
    meta = _refl_role_metadata(labels, ["", "", "1/Ang"], "1/Ang")
    assert meta["default_value_channels"] == [0]
    assert meta["error_roles"] == [
        {"channel": 1, "target": 0, "axis": "y", "side": "both"},
        {"channel": 2, "target": -1, "axis": "x", "side": "both"},
    ]
    assert meta["error_channels"] == {0: 1}

    # Blank EVERYWHERE, x unit included: the uncertainty still binds on its own
    # name plus adjacency, but resolution does NOT -- its target is an axis, not
    # a neighbour, so a blank unit leaves it with no evidence at all. That
    # asymmetry is deliberate; see `_measured_channel_for_uncertainty`.
    meta = _refl_role_metadata(labels, ["", "", ""], "")
    assert meta["default_value_channels"] == [0]
    assert meta["error_roles"] == [{"channel": 1, "target": 0, "axis": "y", "side": "both"}]
    assert meta["error_channels"] == {0: 1}


def test_refl_roles_bind_a_dimensionless_r_dr_dq_file_and_plot_only_r() -> None:
    """The exact counter-example the review round produced, pinning BOTH fixes
    at once. Reflectivity is dimensionless, so `R` and `dR` both carry a blank
    unit, and a real reductus file often trails a `Lambda` column.

    Before the fix this returned `default_value_channels: [0, 1, 3]` -- `dR`
    unbound and drawn as its own curve (the original BUG-001 symptom, because a
    blank unit was treated as no evidence) AND `Lambda` pinned as a curve
    (because a non-empty hint short-circuits the density heuristic). Now `dR`
    and `dQ` bind, and only `R` is plotted."""
    meta = _refl_role_metadata(
        ["R", "dR", "dQ", "Lambda"],
        ["", "", "1/Ang", "Ang"],
        "1/Ang",
    )
    assert meta["default_value_channels"] == [0]
    assert meta["error_roles"] == [
        {"channel": 1, "target": 0, "axis": "y", "side": "both"},
        {"channel": 2, "target": -1, "axis": "x", "side": "both"},
    ]
    assert meta["error_channels"] == {0: 1}


@pytest.mark.parametrize(
    "labels",
    [
        ["Intensity", "resolution", "uncertainty"],  # swapped -> breaks BOTH pairings
        ["Intensity", "B", "C"],                     # no recognisable token at all
    ],
)
def test_refl_roles_fail_safe_on_unrecognised_layouts(labels: list[str]) -> None:
    """A layout where NOTHING is identifiable emits no roles at all. Swapping
    uncertainty/resolution breaks both pairings at once: resolution's column no
    longer carries the x unit, and uncertainty's immediate predecessor is
    itself an error-role column -- so this is still fully unrecognised, not
    merely "different order"."""
    units = ["counts"] * len(labels)
    units[-1] = "1/Ang"
    assert _refl_role_metadata(labels, units, "1/Ang") == {}


def test_refl_roles_accept_the_dr_dq_spelling() -> None:
    """Reductus also writes the triple as R/dR/dQ. Same semantics, so the same
    roles -- recognition is by token plus unit, not one file's display names."""
    meta = _refl_role_metadata(["R", "dR", "dQ"], ["counts", "counts", "1/Ang"], "1/Ang")
    assert meta["default_value_channels"] == [0]
    assert meta["error_channels"] == {0: 1}


# ── BUG-001 checklist item: omitted/reordered/extra columns (per-column,
# never-all-or-nothing recognition) ──────────────────────────────────────────
# Real reductus variants do not all carry the same three columns. Each case
# below pins the EXACT bindings and default channels -- not just "truthy" --
# so an index regression (a binding silently shifted to the wrong channel)
# would fail these even if `_refl_role_metadata` still returned *something*.


def test_refl_roles_bind_uncertainty_when_resolution_is_omitted() -> None:
    meta = _refl_role_metadata(["Intensity", "uncertainty"], ["counts", "counts"], "1/Ang")
    assert meta["default_value_channels"] == [0]
    assert meta["error_roles"] == [{"channel": 1, "target": 0, "axis": "y", "side": "both"}]
    assert meta["error_channels"] == {0: 1}


def test_refl_roles_bind_resolution_when_uncertainty_is_omitted() -> None:
    meta = _refl_role_metadata(["Intensity", "resolution"], ["counts", "1/Ang"], "1/Ang")
    assert meta["default_value_channels"] == [0]
    assert meta["error_roles"] == [{"channel": 1, "target": -1, "axis": "x", "side": "both"}]
    # No Y binding at all -- the legacy key is omitted, not an empty dict.
    assert "error_channels" not in meta


def test_refl_roles_bind_the_triple_around_a_trailing_extra_column() -> None:
    """A monitor-count column appended after the canonical triple must not
    suppress the triple's own bindings, and must NOT itself become a default
    curve: the measured intensity is what the file measures, and the monitor is
    a column the parser never claimed to understand. It stays in the worksheet
    and stays toggleable. (Review round: it used to be listed here, which
    short-circuited the NaN-density heuristic and pinned it as a curve --
    a confident decision dressed up as a conservative one.)"""
    meta = _refl_role_metadata(
        ["Intensity", "uncertainty", "resolution", "monitor"],
        ["counts", "counts", "1/Ang", "counts"],
        "1/Ang",
    )
    assert meta["default_value_channels"] == [0]  # NOT the monitor at 3
    assert meta["error_roles"] == [
        {"channel": 1, "target": 0, "axis": "y", "side": "both"},
        {"channel": 2, "target": -1, "axis": "x", "side": "both"},
    ]
    assert meta["error_channels"] == {0: 1}


def test_refl_roles_bind_the_triple_around_a_leading_extra_column_without_shifting() -> None:
    """The same triple, shifted one column right by a leading extra column.
    The bindings must point at channels 2/3 (where uncertainty/resolution
    ACTUALLY are), never at the fixed 1/2 the canonical layout would use --
    that would be exactly the "shifted index" failure mode this exists to
    rule out."""
    meta = _refl_role_metadata(
        ["monitor", "Intensity", "uncertainty", "resolution"],
        ["counts", "counts", "counts", "1/Ang"],
        "1/Ang",
    )
    assert meta["default_value_channels"] == [1]  # NOT the leading monitor at 0
    assert meta["error_roles"] == [
        {"channel": 2, "target": 1, "axis": "y", "side": "both"},
        {"channel": 3, "target": -1, "axis": "x", "side": "both"},
    ]
    assert meta["error_channels"] == {1: 2}


def test_refl_roles_bind_resolution_even_when_uncertainty_columns_are_unrecognisable() -> None:
    """Two columns both spelled "uncertainty" are not a usable pairing for
    EITHER of them (the first has no predecessor to bind to; the second's
    immediate predecessor is itself an error-role column) -- so both stay
    unbound and plotted as ordinary data. Resolution's evidence is
    independent of its neighbours, so it still binds on its own merits: a
    weird/ambiguous column elsewhere in the file must not suppress a binding
    that IS unambiguous."""
    meta = _refl_role_metadata(
        ["uncertainty", "uncertainty", "resolution"], ["counts", "counts", "1/Ang"], "1/Ang"
    )
    assert meta["default_value_channels"] == [0, 1]
    assert meta["error_roles"] == [{"channel": 2, "target": -1, "axis": "x", "side": "both"}]
    assert "error_channels" not in meta


def test_refl_roles_leave_an_unknown_token_column_plotted_but_still_bind_resolution() -> None:
    """"counts" is not a recognised uncertainty token, so that column is left
    as ordinary plotted data -- but resolution alongside it still binds."""
    meta = _refl_role_metadata(
        ["Intensity", "counts", "resolution"], ["counts", "counts", "1/Ang"], "1/Ang"
    )
    assert meta["default_value_channels"] == [0, 1]
    assert meta["error_roles"] == [{"channel": 2, "target": -1, "axis": "x", "side": "both"}]
    assert "error_channels" not in meta
