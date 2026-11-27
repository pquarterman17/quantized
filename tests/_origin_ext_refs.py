"""All scalar reference transcriptions, by family."""

from __future__ import annotations

from _origin_ext_refs_exp import REFS as _EXP
from _origin_ext_refs_exp import Ref

REFS: dict[str, Ref] = {**_EXP}
