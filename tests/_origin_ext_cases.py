"""All recovery cases for the bulk-ported Origin functions, by family."""

from __future__ import annotations

from _origin_ext_cases_exp import CASES as _EXP
from _origin_ext_cases_exp import Case

CASES: dict[str, Case] = {**_EXP}
