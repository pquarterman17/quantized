r"""Chemical formula → element counts / molar mass (DiraCulator helpers).

Pure parser, **no eval**: a regex token stream + a parenthesis stack handles
nested groups with multipliers, e.g. ``Ca(OH)2``, ``Sr(TiO3)``, ``Al2O3``. Counts
may be fractional (``Fe0.95O``). Molar mass reuses the golden ``element_data``
table. Used by the Crystal calculator (theoretical density from a formula) and is
the natural home for any future formula→property helper (e.g. SLD-from-formula).

Reference: ``formula_mass("H2O") ≈ 18.015 g/mol``; ``"NaCl" ≈ 58.44``.
"""

from __future__ import annotations

import re

from quantized.calc.element_data import by_symbol

__all__ = ["formula_mass", "parse_formula"]

# An element symbol, a (possibly fractional) count, or a parenthesis.
_TOKEN_RE = re.compile(r"([A-Z][a-z]?)|(\d+\.?\d*)|(\()|(\))")


def parse_formula(formula: str) -> dict[str, float]:
    """Parse a chemical formula into a ``{symbol: count}`` map.

    Supports nested groups with multipliers (``Ca(OH)2`` → ``{Ca:1, O:2, H:2}``)
    and fractional counts. Raises ``ValueError`` on stray characters, unbalanced
    parentheses, a leading number, or an empty formula.

    >>> parse_formula("Al2O3")
    {'Al': 2.0, 'O': 3.0}
    """
    text = formula.strip()
    if not text:
        raise ValueError("empty chemical formula")
    # Stack of count maps, one per open group; the bottom is the whole formula.
    stack: list[dict[str, float]] = [{}]
    # What a following number multiplies: ("el", symbol) | ("group", map) | None.
    last: tuple[str, object] | None = None
    pos = 0
    for m in _TOKEN_RE.finditer(text):
        if m.start() != pos:
            raise ValueError(f"unexpected character in formula: {text[pos : m.start()]!r}")
        pos = m.end()
        sym, num, lpar, rpar = m.groups()
        if sym is not None:
            stack[-1][sym] = stack[-1].get(sym, 0.0) + 1.0
            last = ("el", sym)
        elif num is not None:
            n = float(num)
            if last is None:
                raise ValueError("a number must follow an element or group")
            if last[0] == "el":
                # Replace the implicit ×1 already added with ×n.
                stack[-1][str(last[1])] += n - 1.0
            else:
                group = last[1]
                assert isinstance(group, dict)
                for s, cnt in group.items():
                    stack[-1][s] = stack[-1].get(s, 0.0) + cnt * (n - 1.0)
            last = None
        elif lpar is not None:
            stack.append({})
            last = None
        else:  # rpar
            if len(stack) < 2:
                raise ValueError("unbalanced ')' in formula")
            group = stack.pop()
            for s, cnt in group.items():
                stack[-1][s] = stack[-1].get(s, 0.0) + cnt
            last = ("group", group)
    if pos != len(text):
        raise ValueError(f"unexpected trailing characters in formula: {text[pos:]!r}")
    if len(stack) != 1:
        raise ValueError("unbalanced '(' in formula")
    counts = stack[0]
    if not counts:
        raise ValueError("no elements found in formula")
    return counts


def formula_mass(formula: str) -> float:
    """Molar mass (g/mol) of a chemical formula, summed from ``element_data``
    atomic masses. Raises ``ValueError`` for a bad formula or unknown symbol."""
    counts = parse_formula(formula)
    total = 0.0
    for sym, n in counts.items():
        total += float(by_symbol(sym)["mass"]) * n
    return total
