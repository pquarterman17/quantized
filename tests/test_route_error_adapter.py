"""Guard: every route's ``HTTP 422`` calc-adapter goes through the shared
``CALC_ERRORS`` tuple (``quantized.routes._errors``) instead of a hand-rolled
``except (ValueError, ArithmeticError, ...)`` literal.

Split out of ``test_repo_integrity.py`` rather than added there so that file
stays under its own historical size; see that module for the other
structural guards. Context: a 2026-09-03 repo audit found 140 hand-rolled
``except (...): raise HTTPException(422, detail=str(exc)) from exc`` sites
across 35 route modules, each independently listing its own exception tuple
(63 different combinations of ``ValueError``/``ArithmeticError``/``KeyError``/
``IndexError``/``TypeError`` -- and 3 outright missing ``ArithmeticError``, so
an ``OverflowError`` from extreme-but-finite input fell through as an HTTP
500). All were converted to use ``call_calc``/``CALC_ERRORS`` (or a locally
-- named tuple built from it, e.g. ``CALC_ERRORS_IO``, for a route that also
needs to catch something outside that set, such as file I/O). This test
keeps it that way: a literal exception tuple paired with the 422/``str(exc)``
raise is exactly the pattern that used to drift, so any new one is a
regression, not a style choice.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUTES = ROOT / "src" / "quantized" / "routes"

# An `except <expr> as exc:` header, immediately followed (allowing blank/
# comment lines in between, e.g. a `# why this catches too` note) by the
# calc-adapter's raise. `<expr>` is captured whole -- it's either a bare name
# (`CALC_ERRORS`, `CALC_ERRORS_IO`, a local `_FOO_CALC_ERRORS`) or an old-style
# literal tuple (`(ValueError, ArithmeticError, ...)`).
_EXCEPT_422_RE = re.compile(
    r"^([ \t]*)except[ \t]+(.+?)[ \t]+as exc:[ \t]*(?:#.*)?\n"
    r"(?:[ \t]*(?:#.*)?\n)*"  # blank/comment lines are allowed in between
    r"[ \t]*raise HTTPException\(\s*status_code=422,\s*detail=str\(exc\)\s*\)\s*from exc\b",
    re.MULTILINE,
)

# Anything referencing the shared tuple by name is fine, at any splice depth:
# `CALC_ERRORS`, `CALC_ERRORS_IO`, a local `_CALC_ERRORS_ORIGIN`, a starred
# splice built from one of those, etc. -- deliberately a plain substring, not
# a `\bCALC_ERRORS\b` word-boundary match, since `_` is a word character and
# would otherwise fail to match the `_IO`/`_ORIGIN`-suffixed names. A literal
# hand-rolled tuple of exception class names (the pattern this guard exists
# to catch) never contains this substring at all.
_SHARED_TUPLE_MARKER = "CALC_ERRORS"


def test_route_422_adapters_use_shared_calc_errors() -> None:
    violations: list[str] = []
    for path in sorted(ROUTES.glob("*.py")):
        if path.name == "_errors.py":
            continue  # the adapter's own definition, not a call site
        text = path.read_text(encoding="utf-8")
        for m in _EXCEPT_422_RE.finditer(text):
            expr = m.group(2)
            if _SHARED_TUPLE_MARKER in expr:
                continue
            lineno = text.count("\n", 0, m.start()) + 1
            violations.append(
                f"{path.relative_to(ROOT)}:{lineno}: except {expr!r} as exc: raises HTTP 422 "
                "with a hand-rolled exception tuple -- route it through "
                "quantized.routes._errors.CALC_ERRORS (or call_calc(), or a locally-named "
                "tuple[type[BaseException], ...] built from CALC_ERRORS, e.g. CALC_ERRORS_IO) "
                "instead of listing exception classes literally."
            )
    assert not violations, "Hand-rolled 422 calc-adapter(s) found:\n  " + "\n  ".join(violations)
