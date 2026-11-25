"""Blocking of a 2^k / 2^(k-p) factorial (GAP_AUDIT_9 J16 leftover).

Pure Python/numpy. A design is split into ``2**b`` blocks by CONFOUNDING ``b``
independent effects (the block generators, words over the factor letters) with
the blocks: run ``r`` goes to the block whose bit ``i`` is 1 when the product
of the coded columns of generator ``i`` is +1 at that run (Box, Hunter and
Hunter, *Statistics for Experimenters*, 2nd ed., ch. 5/6; NIST e-Handbook
5.3.3.3.3, "Blocking of full factorial designs"). Every product of the
generators is confounded with blocks too (the "generalised interaction"); in a
fraction, so is everything aliased with those effects. All of it is computed
here from the generator words, never read from a table.

Default generators ("standard"): the set that maximises the LOWEST order of any
confounded effect (so the sacrificed effects are the highest-order ones), ties
broken by the fewest confounded effects of that lowest order, then the
smallest masks. The search is exhaustive over the ``b``-subgroups it can reach
(provisional, owner to confirm: capped at ``_SEARCH_CAP`` candidate sets per
target order). The user may pick the generators instead.

Fail closed: a generator that is a main effect or is aliased with one (a block
would be confounded with a factor), is the identity or lies in the defining
relation (constant within the fraction), or is dependent on the others.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np

from quantized.calc import doe_alias as al
from quantized.calc.doe import CENTER, Design
from quantized.calc.doe_tables import LETTERS

MAX_BLOCK_BITS = 4  # at most 16 blocks (provisional, owner to confirm)
_SEARCH_CAP = 20000


def parse_word(text: str, k: int) -> int:
    """``"ABC"`` -> bitmask; every letter must be a distinct factor of the design."""
    word = text.strip().upper().replace("*", "").replace(" ", "")
    if not word:
        raise ValueError("a block generator must name at least one factor (e.g. ABC)")
    mask = 0
    for ch in word:
        if ch not in LETTERS[:k]:
            raise ValueError(
                f"block generator {text!r}: {ch!r} is not a factor of this design "
                f"(letters {LETTERS[:k]})"
            )
        bit = 1 << LETTERS.index(ch)
        if mask & bit:
            raise ValueError(f"block generator {text!r} repeats factor {ch}")
        mask |= bit
    return mask


def relation_masks(design: Design) -> list[int]:
    """The defining-relation words of the design as masks (empty for a full factorial)."""
    if design.relation in ("", "I"):
        return []
    return [parse_word(w, design.k) for w in design.relation.removeprefix("I =").split("=")]


def _coset(mask: int, group: list[int]) -> set[int]:
    return {mask ^ g for g in group}


def _class_order(mask: int, group: list[int]) -> int | None:
    """Lowest order in the alias class of ``mask``; ``None`` when the class holds
    the identity (the effect is constant in the fraction)."""
    members = _coset(mask, group)
    if 0 in members:
        return None
    return min(m.bit_count() for m in members)


def _span(words: list[int]) -> list[int]:
    group = [0]
    for w in words:
        group += [g ^ w for g in group]
    return group[1:]


def block_group_orders(words: list[int], relation: list[int]) -> list[int]:
    """Class orders of every non-empty product of ``words``; raises on a bad set."""
    rel_group = [0, *relation]
    if any(w == 0 for w in words):
        raise ValueError("a block generator cannot be empty")
    if len(set(_span(words))) != 2 ** len(words) - 1 or 0 in _span(words):
        raise ValueError("block generators must be independent of one another")
    out = []
    for m in _span(words):
        order = _class_order(m, rel_group)
        if order is None:
            raise ValueError(
                "block generators must be independent and not lie in the defining relation "
                "(a generator or product of generators is constant across the runs)"
            )
        out.append(order)
    return out


def _best_at_target(order_of: dict[int, int | None], target: int, bits: int) -> list[int] | None:
    """Best ``bits`` independent words whose whole group has class order >= target
    (fewest confounded effects of order ``target``, then smallest masks)."""
    allowed = [m for m, o in order_of.items() if o is not None and o >= target]
    best: tuple[tuple[int, tuple[int, ...]], list[int]] | None = None
    seen = 0

    def dfs(start: int, chosen: list[int], group: list[int]) -> None:
        nonlocal best, seen
        if seen >= _SEARCH_CAP:
            return
        if len(chosen) == bits:
            seen += 1
            key = (sum(1 for g in group if order_of[g] == target), tuple(sorted(chosen)))
            if best is None or key < best[0]:
                best = (key, list(chosen))
            return
        for idx in range(start, len(allowed)):
            w = allowed[idx]
            if w in group:
                continue
            new = [g ^ w for g in group]
            if all((order_of[x] or 0) >= target for x in [w, *new]):
                dfs(idx + 1, [*chosen, w], [*group, w, *new])

    dfs(0, [], [])
    return None if best is None else best[1]


def _standard_words(k: int, bits: int, relation: list[int]) -> list[int]:
    rel_group = [0, *relation]
    order_of = {m: _class_order(m, rel_group) for m in range(1, 2**k)}
    for target in range(k, 1, -1):
        found = _best_at_target(order_of, target, bits)
        if found is not None:
            return found
    raise ValueError(
        f"no way to split this design into {2**bits} blocks without confounding a main effect"
    )


def apply_blocking(design: Design, bits: int, generators: list[str] | None = None) -> Design:
    """The design split into ``2**bits`` blocks (fields ``block``, ``block_generators``,
    ``confounded``); the model terms exclude every effect confounded with blocks."""
    if design.kind not in ("full_factorial", "fractional_factorial"):
        raise ValueError("blocking is offered for 2-level full and fractional factorials")
    if not isinstance(bits, int) or isinstance(bits, bool) or not 1 <= bits <= MAX_BLOCK_BITS:
        raise ValueError(
            f"the number of blocks must be 2, 4, 8 or 16 (log2 from 1 to {MAX_BLOCK_BITS})"
        )
    k = design.k
    runs_in_fraction = 2 ** (k - len(design.generators))
    if 2**bits > runs_in_fraction // 2:
        raise ValueError(
            f"{2**bits} blocks leave fewer than 2 runs per block in a {runs_in_fraction}-run design"
        )
    relation = relation_masks(design)
    if generators:
        if len(generators) != bits:
            raise ValueError(f"{2**bits} blocks need {bits} generators (got {len(generators)})")
        words = [parse_word(g, k) for g in generators]
    else:
        words = _standard_words(k, bits, relation)
    orders = block_group_orders(words, relation)
    if min(orders) < 2:
        raise ValueError(
            "a block generator is confounded with a main effect; choose higher-order effects"
        )
    rel_group = [0, *relation]
    conf_masks = {m ^ g for m in _span(words) for g in rel_group}
    # block label per run from the product of the generators' coded columns
    coded = design.coded
    labels = np.zeros(coded.shape[0], dtype=int)
    for i, w in enumerate(words):
        cols = [j for j in range(k) if w >> j & 1]
        prod = np.prod(coded[:, cols], axis=1)
        labels |= (prod > 0).astype(int) << i
    centre_rows = [r for r, t in enumerate(design.point_type) if t == CENTER]
    for n, r in enumerate(centre_rows):  # centre points spread evenly over the blocks
        labels[r] = n % 2**bits
    terms = tuple(t for t in design.terms if sum(1 << j for j in t) not in conf_masks)
    classes = []
    for m in sorted(_span(words), key=lambda x: (x.bit_count(), x)):
        members = sorted(_coset(m, rel_group), key=lambda x: (x.bit_count(), x))
        classes.append(" = ".join(al.effect_label(x, k) for x in members))
    return replace(
        design,
        terms=terms,
        block=tuple(int(x) + 1 for x in labels),
        block_generators=tuple("".join(LETTERS[j] for j in range(k) if w >> j & 1) for w in words),
        confounded=tuple(classes),
    )
