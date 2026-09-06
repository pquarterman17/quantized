"""P1.7 "Pack Project" — collision-safe bundle-destination naming.

Split out of :mod:`quantized.portable.manifest` to keep that module under
the repo's 500-line god-module ceiling; this is a pure extension of
:mod:`quantized.portable.layout`'s naming rules, not a new layer -- same
purity constraints (no filesystem access, no fastapi/pydantic/starlette
imports) apply.

## The keeper-reservation ordering (review finding #1)

Every group of sources that sanitize to the same destination basename
(:func:`quantized.portable.layout.path_key` of the sanitized name) gets one
"keeper" -- its first member, by the caller's own ordering -- who is
entitled to the plain name; every other member is renamed with a visible
``" (2)"``, ``" (3)"``, ... suffix (the L0.34 "visible collision suffixes;
never overwrite silently" idiom).

The naive way to compute this -- give the keeper its plain name
unconditionally, then hand out suffixes for the rest, one group at a time
-- has a silent-overwrite hazard: a LATER group's plain name can be
IDENTICAL to a suffix an EARLIER group already generated (four sources
``/a/b.csv``, ``/z/b.csv``, ``/m/b (2).csv``, ``/n/b (2).csv``: the first
group hands out ``b (2).csv`` to its second member before the second
group's keeper -- whose OWN sanitized name literally IS ``b (2).csv`` --
has had any chance to reserve it, so both rows end up with the same
``bundle_path``). :func:`plan_bundle_names` fixes this with two full
passes: EVERY group's keeper reserves its name FIRST, across ALL groups,
before ANY suffix is generated for ANY group; only then does the second
pass hand out suffixes, so a suffix search always sees every other group's
plain name as already taken. A keeper's own reservation goes through the
identical "first free name" search as a suffix does (starting from its own
sanitized name rather than from ``" (2)"``), so the two cases share one
code path instead of one being a special, unchecked case of the other.
"""

from __future__ import annotations

from .layout import path_key, sanitize_component, split_ext

__all__ = ["plan_bundle_names"]


def plan_bundle_names(base_names: list[str]) -> tuple[dict[int, str], dict[int, int]]:
    """Assign a collision-safe final bundle basename to each index of
    ``base_names`` (already-:func:`sanitize_component`-d basenames, in the
    caller's own deterministic order).

    Returns ``(final_name, collision_group_of)``: ``final_name`` maps every
    index to its assigned name (guaranteed pairwise-unique by
    :func:`quantized.portable.layout.path_key`); ``collision_group_of`` maps
    only the indices that belong to a group of two or more (a 1-based id,
    shared by every member of that group -- absent for a name with no
    collision at all).
    """
    key_groups: dict[str, list[int]] = {}
    for idx, name in enumerate(base_names):
        key_groups.setdefault(path_key(name), []).append(idx)

    collision_group_of: dict[int, int] = {}
    next_group_id = 0
    for idxs in key_groups.values():
        if len(idxs) > 1:
            next_group_id += 1
            for idx in idxs:
                collision_group_of[idx] = next_group_id

    used_keys: set[str] = set()
    final_name: dict[int, str] = {}

    # Pass 1: every group's keeper reserves its plain name FIRST, across
    # ALL groups -- see module docstring for why this must happen before
    # ANY suffix (pass 2) is generated.
    for idxs in key_groups.values():
        keeper = idxs[0]
        name = _first_free_name(base_names[keeper], used_keys)
        final_name[keeper] = name
        used_keys.add(path_key(name))

    # Pass 2: every other member of a collision group gets the first
    # available " (2)", " (3)", ... suffix -- never the plain name, which
    # pass 1 already reserved for its group's keeper.
    for idxs in key_groups.values():
        for idx in idxs[1:]:
            name = _first_free_name(base_names[idx], used_keys)
            final_name[idx] = name
            used_keys.add(path_key(name))

    return final_name, collision_group_of


def _first_free_name(base_name: str, used_keys: set[str]) -> str:
    """First available portable name starting from ``base_name`` itself,
    then ``"<stem> (2)<ext>"``, ``"<stem> (3)<ext>"``, ... -- re-sanitized
    each time (a generated suffix can itself collide with a reserved
    keyword or run over the byte budget, however unlikely)."""
    if path_key(base_name) not in used_keys:
        return base_name
    stem, ext = split_ext(base_name)
    n = 2
    while True:
        candidate, _reason = sanitize_component(f"{stem} ({n}){ext}")
        if path_key(candidate) not in used_keys:
            return candidate
        n += 1
