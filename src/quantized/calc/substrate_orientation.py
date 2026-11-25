r"""Miller indices and surface net of a substrate-table orientation label.

THIN_FILM_STACK_PLANNING_PLAN G1 (row "orientation as Miller indices"). A
Python extension; the MATLAB-verbatim rows of ``calc.substrates`` are not
edited. The label stored in the table (``"(100)"``, ``"(0001)"``,
``"(11-20)"``) is parsed into integer indices, and the plane's in-plane lattice
(``surface_net``) is computed from them, so the net is derived, not implied.

``surface_net`` needs the Bravais centering, which the MATLAB substrate table
lacks. It is read from the substrate's material record
(``calc.substrates.substrate_record``), which takes it from the phase table
entry with the **same formula**, accepted only when that phase's ``a`` agrees
with the substrate's ``a`` within 1 % (so a different polymorph is never
borrowed). When no phase matches, the indices are
still returned and the net is ``None`` with a reason: a centering is never
guessed (Si(111) would otherwise read as a primitive-cell net).

Unparseable labels raise ``ValueError``; the amorphous row has no plane and
returns ``hkl = None``.
"""

from __future__ import annotations

import re
from typing import Any

from quantized.calc.substrates import get_substrate, substrate_record
from quantized.calc.surface_net import surface_net

__all__ = ["parse_orientation", "substrate_orientation"]

def parse_orientation(label: str) -> list[int]:
    """Integer Miller indices of an orientation label.

    3 indices ``(h k l)`` or 4 indices ``(h k i l)`` (``i = -(h+k)``, checked).
    Single-digit indices may be run together (``"(11-20)"``); use spaces or
    commas for anything else.

    >>> parse_orientation("(11-20)")
    [1, 1, -2, 0]
    >>> parse_orientation("(1 -1 0)")
    [1, -1, 0]
    """
    text = label.strip()
    m = re.fullmatch(r"[(\[]\s*([-\d\s,]+?)\s*[)\]]", text)
    if m is None:
        raise ValueError(f'orientation "{label}" is not a Miller-index label like (100) or (11-20)')
    body = m.group(1)
    if re.search(r"[\s,]", body):
        parts = [p for p in re.split(r"[\s,]+", body) if p]
    else:
        parts = re.findall(r"-?\d", body)
        if "".join(parts) != body:
            raise ValueError(f'orientation "{label}" has an unreadable index')
    try:
        idx = [int(p) for p in parts]
    except ValueError as exc:
        raise ValueError(f'orientation "{label}" has an unreadable index') from exc
    if len(idx) not in (3, 4):
        raise ValueError(f'orientation "{label}" needs 3 (hkl) or 4 (hkil) indices')
    if len(idx) == 4 and idx[2] != -(idx[0] + idx[1]):
        raise ValueError(f'orientation "{label}": i must equal -(h+k)')
    if all(x == 0 for x in idx):
        raise ValueError(f'orientation "{label}" has all-zero indices')
    return idx


def substrate_orientation(name: str) -> dict[str, Any]:
    """Indices and surface net of a named substrate (case-insensitive).

    Returns ``name``, ``orientation`` (the table label), ``hkl`` (3 indices) and
    ``hkil`` (4 indices, hexagonal cells only), ``centering`` (``None`` if no
    phase supplies it), ``net`` (``surface_net`` result or ``None``) and
    ``net_note`` (reason when ``net`` is ``None``).

    >>> r = substrate_orientation("Si(111)")
    >>> r["hkl"], round(r["net"]["gamma"], 6)
    ([1, 1, 1], 120.0)
    """
    sub = get_substrate(name)
    out: dict[str, Any] = {
        "name": sub["name"],
        "orientation": sub["orientation"],
        "hkl": None,
        "hkil": None,
        "centering": None,
        "net": None,
        "net_note": None,
    }
    if sub["latticeType"] == "amorphous":
        out["net_note"] = "Amorphous: there is no crystal plane, so no surface net."
        return out
    idx = parse_orientation(sub["orientation"])
    hexagonal = sub["latticeType"] == "hexagonal"
    if len(idx) == 4:
        if not hexagonal:
            raise ValueError(
                f'orientation "{sub["orientation"]}" is 4-index but the cell is not hexagonal'
            )
        hkl = [idx[0], idx[1], idx[3]]
    else:
        hkl = idx
    out["hkl"] = hkl
    if hexagonal:
        out["hkil"] = [hkl[0], hkl[1], -(hkl[0] + hkl[1]), hkl[2]]
    cen = substrate_record(sub["name"]).centering
    out["centering"] = cen
    if cen is None:
        out["net_note"] = (
            "No phase with this formula and lattice parameter supplies a Bravais centering, "
            "so the surface net is not computed."
        )
        return out
    out["net"] = surface_net(
        sub["a"],
        hkl,
        b=sub["b"],
        c=sub["c"],
        alpha=sub["alpha"],
        beta=sub["beta"],
        gamma=sub["gamma"],
        centering=cen,
    )
    return out
