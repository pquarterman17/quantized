"""All recovery cases for the bulk-ported Origin functions, by family."""

from __future__ import annotations

from _origin_ext_cases_exp import CASES as _EXP
from _origin_ext_cases_exp import Case
from _origin_ext_cases_growth import CASES as _GRO
from _origin_ext_cases_peak import CASES as _PK
from _origin_ext_cases_rational import CASES as _RAT

CASES: dict[str, Case] = {**_EXP, **_GRO, **_RAT, **_PK}
