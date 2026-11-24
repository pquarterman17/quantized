"""Alias (confounding) structure and resolution of a 2^(k-p) design.

Pure Python. An effect is a bitmask over the k factors (bit ``j`` set = factor
``j`` is in the effect). A fraction is defined by ``p`` generator WORDS; the
defining relation is ``I`` = every word and every product of words (symbolic
product = XOR of the masks). The resolution is the length of the shortest
word (Box, Hunter and Hunter, *Statistics for Experimenters*, 2nd ed., ch.
6; NIST e-Handbook 5.3.3.4.2): an effect's alias set is ``effect * word``
for every word of the defining relation.
"""

from __future__ import annotations

from itertools import combinations

from quantized.calc.doe_tables import LETTERS


def effect_label(mask: int, k: int) -> str:
    """``0b101`` -> ``"AC"`` (factor letters, lowest factor first)."""
    return "".join(LETTERS[j] for j in range(k) if mask >> j & 1)


def generator_words(base: int, generators: tuple[tuple[int, ...], ...]) -> list[int]:
    """The ``p`` words of ``I``: generated factor ``base+j`` times its base product.

    ``generators[j]`` holds 1-based base-factor numbers (NIST notation).
    """
    words = []
    for j, gen in enumerate(generators):
        mask = 1 << (base + j)
        for f in gen:
            if not 1 <= f <= base:
                raise ValueError(f"generator factor {f} is not a base factor (1..{base})")
            mask |= 1 << (f - 1)
        words.append(mask)
    return words


def defining_relation(words: list[int]) -> list[int]:
    """Every distinct non-identity word of the group the generator words span."""
    group = {0}
    for w in words:
        group |= {g ^ w for g in group}
    group.discard(0)
    return sorted(group, key=lambda m: (bin(m).count("1"), m))


def resolution(relation: list[int]) -> int | None:
    """Length of the shortest word; ``None`` for a full factorial (no words)."""
    return min((bin(m).count("1") for m in relation), default=None)


def alias_classes(relation: list[int], k: int, max_order: int = 2) -> list[list[str]]:
    """Alias sets restricted to effects of order <= ``max_order``.

    One list per distinct alias class that holds at least one effect of order
    <= ``max_order``; members are sorted by (order, label); classes are sorted
    by their first member. A class of one is a clear (unaliased) effect.
    """
    group = [0, *relation]
    seen: set[frozenset[int]] = set()
    out: list[list[str]] = []
    for order in range(1, min(max_order, k) + 1):
        for combo in combinations(range(k), order):
            mask = sum(1 << j for j in combo)
            members = frozenset(mask ^ g for g in group)
            if members in seen:
                continue
            seen.add(members)
            shown = sorted(
                (m for m in members if 0 < bin(m).count("1") <= max_order),
                key=lambda m: (bin(m).count("1"), effect_label(m, k)),
            )
            out.append([effect_label(m, k) for m in shown])
    return out


def relation_text(relation: list[int], k: int) -> str:
    """``I = ABCE = BCDF = ADEF`` (``I`` alone for a full factorial)."""
    return "I = " + " = ".join(effect_label(m, k) for m in relation) if relation else "I"


def estimable_terms(relation: list[int], k: int) -> list[int]:
    """Main effects plus one representative of every alias class of two-factor
    interactions that is not aliased with a main effect: the largest main-effects
    + 2FI model a fraction can fit without a rank-deficient column. For a
    resolution V (or better) fraction or a full factorial this is every main
    effect and every two-factor interaction."""
    group = [0, *relation]
    taken: set[frozenset[int]] = set()
    out: list[int] = []
    for order in (1, 2):
        for combo in combinations(range(k), order):
            mask = sum(1 << j for j in combo)
            members = frozenset(mask ^ g for g in group)
            if members in taken:
                continue
            taken.add(members)
            out.append(mask)
    return out
