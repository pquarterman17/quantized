"""Non-finite input rejection + the zero-width-sector trap (RSM_CUTS_PLAN item 21).

These cases came from adversarially probing the merged cut surface by hand, not
from a failing feature -- every one of them previously "worked" in the sense of
raising *something*, just something that blamed the wrong thing:

    box_cut(x_max=inf)   -> "cannot convert float NaN to integer"  (numpy internal)
    box_cut(angle=inf)   -> "math domain error"                    (math internal)
    box_cut(x_min=nan)   -> "box selects no data"                  (blames the DATA)
    sector_profile(q_min=nan) -> NaN interpolated into the message text

The last two are the dangerous ones: they send the reader looking for a data
problem that does not exist. Each assertion below pins the parameter NAME into
the message, which is the whole point of the fix.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.boxcut import box_cut, box_stats
from quantized.calc.sectorcut import chi_profile, sector_profile
from quantized.datastruct import DataStruct

NAN = float("nan")
INF = float("inf")


def _q_map(n: int = 8, m: int = 10) -> DataStruct:
    """Minimal 2-D map carrying Qx/Qz, enough for every entry point here."""
    tt, om = np.meshgrid(np.linspace(60.0, 70.0, m), np.linspace(28.0, 34.0, n))
    qx = np.linspace(-0.05, 0.05, m)[None, :] * np.ones((n, 1))
    qz = np.linspace(4.5, 4.9, n)[:, None] * np.ones((1, m))
    inten = np.ones((n, m), dtype=float)
    return DataStruct.create(
        np.arange(n * m, dtype=float),
        np.column_stack(
            [tt.ravel(), om.ravel(), inten.ravel(), qx.ravel(), qz.ravel()]
        ),
        labels=["2Theta", "Omega", "Intensity", "Qx", "Qz"],
        units=["deg", "deg", "cps", "Ang^-1", "Ang^-1"],
        metadata={"is2D": True, "map_shape": [n, m], "axis1_name": "Omega"},
    )


@pytest.mark.parametrize(
    ("kwargs", "offender"),
    [
        ({"x_min": NAN}, "x_min"),
        ({"x_max": INF}, "x_max"),
        ({"y_min": -INF}, "y_min"),
        ({"y_max": NAN}, "y_max"),
        ({"angle": INF}, "angle"),
        ({"angle": NAN}, "angle"),
    ],
)
def test_box_cut_names_the_non_finite_parameter(
    kwargs: dict[str, float], offender: str
) -> None:
    base = {"x_min": -0.02, "x_max": 0.02, "y_min": 4.6, "y_max": 4.8, "space": "q"}
    with pytest.raises(ValueError, match=r"non-finite parameter") as exc:
        box_cut(_q_map(), **{**base, **kwargs})  # type: ignore[arg-type]
    assert offender in str(exc.value), f"message must name {offender!r}: {exc.value}"


def test_box_stats_rejects_non_finite_too() -> None:
    """box_stats is a separate entry point -- it must not be the one that leaks."""
    with pytest.raises(ValueError, match=r"non-finite parameter.*angle"):
        box_stats(
            _q_map(), x_min=-0.02, x_max=0.02, y_min=4.6, y_max=4.8, space="q", angle=NAN
        )


@pytest.mark.parametrize(
    ("kwargs", "offender"),
    [
        ({"q_min": NAN}, "q_min"),
        ({"q_max": INF}, "q_max"),
        ({"phi_min": NAN}, "phi_min"),
        ({"phi_max": -INF}, "phi_max"),
    ],
)
def test_polar_profiles_name_the_non_finite_parameter(
    kwargs: dict[str, float], offender: str
) -> None:
    base = {"q_min": 4.5, "q_max": 4.9, "n_bins": 8}
    for fn in (sector_profile, chi_profile):
        with pytest.raises(ValueError, match=r"non-finite parameter") as exc:
            fn(_q_map(), **{**base, **kwargs})  # type: ignore[arg-type]
        assert offender in str(exc.value)


def test_zero_width_sector_says_it_integrated_the_full_circle() -> None:
    """phi_min == phi_max makes the rebase span 360 -- MATLAB's branch does the
    same, so calc keeps the behaviour. What it must NOT do is stay silent: the
    ROI panel offers centre +/- half-width as its primary control, so half-width
    0 is one keystroke from "integrate everything" while looking like "integrate
    nothing". The label is the tell."""
    ds = _q_map()
    narrow = sector_profile(ds, q_min=4.5, q_max=4.9, n_bins=8, phi_min=45.0, phi_max=45.0)
    full = sector_profile(ds, q_min=4.5, q_max=4.9, n_bins=8)

    assert "FULL CIRCLE" in narrow.metadata["cut_label"]
    assert "45" in narrow.metadata["cut_label"]
    # ...and it really is the full circle, not merely labelled one.
    np.testing.assert_allclose(narrow.values[:, 0], full.values[:, 0])
    # A genuine full circle must NOT gain the warning text.
    assert "FULL CIRCLE" not in full.metadata["cut_label"]


def test_finite_inputs_still_pass_through_untouched() -> None:
    """The guard must not have narrowed the accepted domain: a legitimate
    wrapping sector (phi_min > phi_max) and a rotated box both still work."""
    ds = _q_map()
    # This map's points sit near phi ~ 90 deg (small Qx, Qz ~ 4.5-4.9), so the
    # wrapping sector has to be one that actually spans 90: phi_min=80 with
    # phi_max=-170 rebases to a 110 deg span covering [80, 190]. (A 170 -> -170
    # sector is also legal and wrapping, but selects nothing HERE -- which is
    # correct behaviour, not a bug, and would test the empty-selection path
    # rather than the wrap path.)
    wrapped = sector_profile(ds, q_min=4.5, q_max=4.9, n_bins=8, phi_min=80.0, phi_max=-170.0)
    assert wrapped.time.size == 8
    assert np.nansum(wrapped.values[:, 1]) > 0, "wrapping sector should select points"
    rotated = box_cut(
        ds, x_min=-0.04, x_max=0.04, y_min=4.55, y_max=4.85, space="q", angle=30.0
    )
    assert rotated.time.size > 0
    assert math.isfinite(float(np.nansum(rotated.values[:, 0])))
