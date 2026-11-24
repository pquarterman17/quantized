"""Synthetic-CIF builders shared by the symmetry/termination tests."""

from __future__ import annotations

import itertools


def oh_ops(centering: tuple[tuple[str, str, str], ...] = (("", "", ""),)) -> list[str]:
    """All 48 signed permutation operators (point group m-3m) x centering."""
    ops = []
    for perm in itertools.permutations("xyz"):
        for signs in itertools.product("+-", repeat=3):
            base = [("-" if s == "-" else "") + p for s, p in zip(signs, perm, strict=True)]
            for shift in centering:
                ops.append(",".join(b + t for b, t in zip(base, shift, strict=True)))
    return ops


F_CENTERING = (("", "", ""), ("", "+1/2", "+1/2"), ("+1/2", "", "+1/2"), ("+1/2", "+1/2", ""))


def cif_text(ops: list[str], sites: list[str], cell: str = "4 4 4 90 90 90") -> str:
    a, b, c, al, be, ga = cell.split()
    head = (
        "data_synthetic\n"
        f"_cell_length_a {a}\n_cell_length_b {b}\n_cell_length_c {c}\n"
        f"_cell_angle_alpha {al}\n_cell_angle_beta {be}\n_cell_angle_gamma {ga}\n"
        "loop_\n_space_group_symop_operation_xyz\n"
    )
    body = "".join(f"'{o}'\n" for o in ops)
    atoms = (
        "loop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n"
        "_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\n"
    )
    return head + body + atoms + "\n".join(sites) + "\n"
