"""Fortran double-precision exponents (``1.0D+00``, ``-2.5d-3``, ``3.D4``).

Fortran's ``D`` edit descriptor writes the exponent marker as ``D``/``d``.
Python's ``float()`` and numpy reject it, so such a column used to import as
TEXT (a categorical channel). numpy's ``loadtxt`` users and most scientific
readers handle it with a D->E substitution; :func:`parse_float` does the same,
but ONLY for a token that matches the whole float grammar with the ``D`` in
the exponent position -- never "D", "Dec", "ID", "3D", a hex string or a
header cell.

Deliberately narrower than Fortran's own reader: a mantissa with no decimal
point needs an explicitly SIGNED exponent (``1D+02`` yes, ``1D2`` no). Fortran
output always writes a decimal point, while a bare ``1D2``/``12D4`` is just as
likely a sample/well ID or a hex string, and reading those as numbers would
flip a text column to numeric. Pure layer: strings in, floats out.
"""

from __future__ import annotations

import re

__all__ = ["is_fortran_float", "parse_float"]

#: Decimal-point mantissa with any exponent, or an integer mantissa with a
#: signed exponent. Surrounding whitespace is tolerated, as ``float()`` does.
_FORTRAN_RE = re.compile(r"\s*[+-]?(?:(?:\d+\.\d*|\.\d+)[dD][+-]?|\d+[dD][+-])\d+\s*")


def is_fortran_float(token: str) -> bool:
    """True when ``token`` is a number written with a ``D``/``d`` exponent."""
    return _FORTRAN_RE.fullmatch(token) is not None


def parse_float(token: str) -> float:
    """``float(token)``, also accepting a Fortran ``D``/``d`` exponent.

    Raises ``ValueError`` exactly where ``float()`` would for every other
    input. The D check runs only after ``float()`` fails, so clean numeric
    data pays nothing for it.
    """
    try:
        return float(token)
    except ValueError:
        if _FORTRAN_RE.fullmatch(token) is None:
            raise
        return float(token.replace("D", "E").replace("d", "e"))
