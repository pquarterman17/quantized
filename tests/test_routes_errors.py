"""Unit tests for the shared routes/_errors.py calc-adapter helper."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi import HTTPException

from quantized.routes._errors import CALC_ERRORS, call_calc


def test_calc_errors_includes_linalg_error() -> None:
    """numpy.linalg.LinAlgError must be listed explicitly in CALC_ERRORS.

    It happens to subclass ValueError in the numpy version this repo
    currently pins (verified: `numpy.linalg.LinAlgError.__mro__` includes
    ValueError), so every route that already catches ValueError incidentally
    catches it too -- but that is an implementation detail of one numpy
    release, not a contract. Listing it here makes the coverage correct by
    construction, and this test is the guard against it quietly being
    dropped from the tuple.
    """
    assert np.linalg.LinAlgError in CALC_ERRORS


def test_call_calc_converts_linalg_error_to_422() -> None:
    """A calc function raising a raw LinAlgError (a singular-matrix failure,
    e.g. scipy's gaussian_kde on degenerate data) must come back as an HTTP
    422 with an ASCII detail through call_calc, not propagate as a 500."""

    def _raises_linalg_error() -> dict[str, object]:
        raise np.linalg.LinAlgError("singular matrix: resolution failed at diagonal 0")

    with pytest.raises(HTTPException) as exc_info:
        call_calc(_raises_linalg_error)
    assert exc_info.value.status_code == 422
    detail = exc_info.value.detail
    assert isinstance(detail, str)
    assert all(ord(c) < 128 for c in detail)
