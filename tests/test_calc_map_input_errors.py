"""``map_from_datastruct`` names a data problem instead of a numpy error.

Origin-replacement live check: an Origin book whose chosen x/y/z columns
never hold finite values on the same row answered the Map tab with HTTP 422
"zero-size array to reduction operation minimum which has no identity".
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.map import map_from_datastruct
from quantized.datastruct import DataStruct


def test_no_overlapping_finite_rows_is_a_clear_error() -> None:
    nan = float("nan")
    ds = DataStruct(
        time=np.array([0.0, 1.0, 2.0]),
        values=np.array([[1.0, nan, nan], [nan, 2.0, nan], [nan, nan, 3.0]]),
        labels=("A", "B", "C"),
        units=("", "", ""),
        metadata={},
    )
    with pytest.raises(ValueError, match="no row has finite 'A', 'B' and 'C' values together"):
        map_from_datastruct(ds, 0, 1, 2)
