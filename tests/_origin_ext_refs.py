"""All scalar reference transcriptions, by family."""

from __future__ import annotations

from _origin_ext_refs_exp import REFS as _EXP
from _origin_ext_refs_growth import REFS as _GRO
from _origin_ext_refs_peak import REFS as _PK
from _origin_ext_refs_rational import REFS as _RAT
from _origin_ext_refs_exp import Ref

REFS: dict[str, Ref] = {**_EXP, **_GRO, **_RAT, **_PK}
