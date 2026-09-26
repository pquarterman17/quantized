"""Tokenizer, grammar check and shunting-yard for ``calc.fit_equation`` (P2.7).

Pure calc layer, split out of ``fit_equation`` so the evaluator stays small.
Every syntax error is an ``EquationSyntaxError`` carrying the character span
``[start, end)`` it is about, in code-point offsets into the ORIGINAL string
(before a leading ``y =`` / ``f(x) =`` is stripped), so an editor can mark it.
Messages are ASCII-only (non-ASCII input is echoed as ``\\uXXXX`` escapes),
matching the HTTP error-text convention of ``routes/peaks_batch``.

Grammar (Python-flavoured): numbers, ``x``, parameters, the constants
``pi``/``e``, one-argument functions ``name(expr)``, parentheses, binary
``+ - * / ^`` and ``**`` (a synonym of ``^``: right-associative, binding
tighter than unary minus on its left -- ``-x**2`` is ``-(x**2)`` -- and
looser on its right -- ``2**-1`` is ``2**(-1)``), and unary ``+``/``-``.
There is no implicit multiplication (``2x`` is an error that says so).

Unary minus has two encodings, deliberately. At the start of an expression or
after ``(`` it is the historical ``0 - operand`` (bit-identical to every
equation that already worked, including the golden set). After a binary
operator or another sign it is a prefix ``neg`` token; the historical
``0 -`` encoding was simply wrong there (``3*-2`` gave -2, ``2^-3`` gave -2,
``3--2`` gave 1), so only those previously-wrong results change.
"""

from __future__ import annotations

import math
import re
from typing import Any

__all__ = ["CONSTANTS", "FUNCTION_NAMES", "EquationSyntaxError", "parse_tokens"]

FUNCTION_NAMES: tuple[str, ...] = (
    "exp", "log", "log10", "sqrt", "abs", "sin", "cos", "tan", "asin", "acos",
    "atan", "sinh", "cosh", "tanh", "coth", "erf", "erfc", "sign", "floor",
    "ceil", "round",
)
_FUNCTION_SET = frozenset(FUNCTION_NAMES)
CONSTANTS: dict[str, float] = {"pi": math.pi, "e": math.e}
# Binary operators, plus the prefix "neg" (between * / and ^: see the module doc).
_PREC = {"+": 1.0, "-": 1.0, "*": 2.0, "/": 2.0, "neg": 2.5, "^": 3.0}
_DIGITS = "0123456789"
_VALUE_TYPES = ("number", "x", "param")
_LHS = re.compile(r"^\s*(y|f\(x\))\s*=\s*")

Token = dict[str, Any]


def _ascii(text: str) -> str:
    return text.encode("ascii", "backslashreplace").decode("ascii")


class EquationSyntaxError(ValueError):
    """A syntax error at ``[start, end)`` (code points of the original text)."""

    def __init__(self, message: str, start: int, end: int) -> None:
        self.start = start
        self.end = max(end, start + 1)
        #: The message without its column suffix, for callers that parse a
        #: REWRITTEN string whose columns mean nothing to the user
        #: (``calc.fit_constraints``).
        self.detail = _ascii(message)
        super().__init__(f"{self.detail} (column {start + 1})")


def _tok(kind: str, value: Any, start: int, end: int, text: str) -> Token:
    return {"type": kind, "value": value, "start": start, "end": end, "text": text}


def _number(s: str, pos: int, base: int) -> tuple[Token, int]:
    start, n = pos, len(s)
    while pos < n and (s[pos] in _DIGITS or s[pos] == "."):
        pos += 1
    if pos < n and s[pos] in "eE":
        pos += 1
        if pos < n and s[pos] in "+-":
            pos += 1
        while pos < n and s[pos] in _DIGITS:
            pos += 1
    text = s[start:pos]
    try:
        value = float(text)
    except ValueError:
        raise EquationSyntaxError(f'Malformed number "{text}"', base + start, base + pos) from None
    return _tok("number", value, base + start, base + pos, text), pos


def _identifier(s: str, pos: int, base: int, params: list[str], spans: dict[str, tuple[int, int]]
                ) -> tuple[Token, int]:
    start, n = pos, len(s)
    pos += 1
    # The historical rule, kept exactly: a letter or "_" starts a name and
    # letters / digits / "_" continue it (str.isalnum, so saved models with
    # names like "A\u2080" or "\u03c4" keep parsing). str.isidentifier() would
    # break those AND swallow "\u00b7" (a middle dot typed as "times") into
    # a parameter name. A mistyped "x\u00b2" stays a parameter, but the
    # before-run summary then says x is unused.
    while pos < n and (s[pos].isalnum() or s[pos] == "_"):
        pos += 1
    name = s[start:pos]
    a, b = base + start, base + pos
    if name in _FUNCTION_SET:
        return _tok("function", name, a, b, name), pos
    # A non-function identifier directly followed by "(" is a call of an
    # unknown symbol (there is no implicit multiplication in this grammar).
    look = pos
    while look < n and s[look] in " \t":
        look += 1
    if look < n and s[look] == "(":
        if name in CONSTANTS or name == "x":
            raise EquationSyntaxError(f'"{name}" cannot be called as a function', a, b)
        raise EquationSyntaxError(
            f'Unknown function "{name}". Known functions: ' + ", ".join(sorted(FUNCTION_NAMES)),
            a, b,
        )
    if name in CONSTANTS:
        tok = _tok("number", CONSTANTS[name], a, b, name)
        tok["const"] = name
        return tok, pos
    if name == "x":
        return _tok("x", "x", a, b, name), pos
    if name not in params:
        params.append(name)
        spans[name] = (a, b)
    return _tok("param", params.index(name), a, b, name), pos


def _tokenize(s: str, base: int) -> tuple[list[Token], list[str], dict[str, tuple[int, int]]]:
    tokens: list[Token] = []
    params: list[str] = []
    spans: dict[str, tuple[int, int]] = {}
    pos, n = 0, len(s)
    prev = "start"  # start | value | operator | lparen | function
    while pos < n:
        ch = s[pos]
        if ch in " \t":
            pos += 1
            continue
        if ch in _DIGITS or (ch == "." and pos + 1 < n and s[pos + 1] in _DIGITS):
            tok, pos = _number(s, pos, base)
            tokens.append(tok)
            prev = "value"
            continue
        if ch.isalpha() or ch == "_":
            tok, pos = _identifier(s, pos, base, params, spans)
            tokens.append(tok)
            prev = "function" if tok["type"] == "function" else "value"
            continue
        a = base + pos
        if s.startswith("**", pos):
            tokens.append(_tok("operator", "^", a, a + 2, "**"))
            prev = "operator"
            pos += 2
            continue
        if ch in "+-*/^(),":
            if ch == "(":
                tokens.append(_tok("lparen", "(", a, a + 1, ch))
                prev = "lparen"
            elif ch == ")":
                tokens.append(_tok("rparen", ")", a, a + 1, ch))
                prev = "value"
            elif ch == ",":
                tokens.append(_tok("comma", ",", a, a + 1, ch))
                prev = "operator"
            elif ch == "-" and prev in ("start", "lparen"):
                tokens.append(_tok("number", 0.0, a, a + 1, ch))  # historical "0 -"
                tokens.append(_tok("operator", "-", a, a + 1, ch))
                prev = "operator"
            elif ch == "-" and prev == "operator":
                tokens.append(_tok("unary", "neg", a, a + 1, ch))
            elif ch == "+" and prev in ("start", "lparen", "operator"):
                pass  # unary plus is the identity
            else:
                tokens.append(_tok("operator", ch, a, a + 1, ch))
                prev = "operator"
            pos += 1
            continue
        raise EquationSyntaxError(f'Unexpected character "{ch}"', a, a + 1)
    return tokens, params, spans


def _missing_operand(op: Token) -> EquationSyntaxError:
    return EquationSyntaxError(
        f'operator "{op["text"]}" is missing an operand', op["start"], op["end"]
    )


def _check_sequence(tokens: list[Token], whole: tuple[int, int]) -> None:
    """Walk the tokens as a value/operator alternation, raising the FIRST
    positioned error: missing operand, missing operator, a function without
    ``(``, a wrong argument count, or unbalanced parentheses."""
    expect_value = True
    opens: list[tuple[Token, Token | None]] = []  # (lparen, its function or None)
    prev: Token | None = None
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        t = tok["type"]
        if expect_value:
            if t in _VALUE_TYPES:
                expect_value = False
            elif t == "function":
                nxt = tokens[i + 1] if i + 1 < len(tokens) else None
                if nxt is None or nxt["type"] != "lparen":
                    raise EquationSyntaxError(
                        f'function "{tok["value"]}" needs parentheses, e.g. {tok["value"]}(x)',
                        tok["start"], tok["end"])
                opens.append((nxt, tok))
                prev, i = nxt, i + 2
                continue
            elif t == "lparen":
                opens.append((tok, None))
            elif t == "unary":
                pass
            elif prev is not None and prev["type"] in ("operator", "unary"):
                raise _missing_operand(prev)  # "a*)", "a+*b", "a-,"
            elif t == "rparen" and prev is not None and prev["type"] == "lparen":
                func = opens[-1][1]
                if func is not None:
                    raise EquationSyntaxError(
                        f'function "{func["value"]}" is missing its argument',
                        func["start"], tok["end"])
                raise EquationSyntaxError("Empty parentheses", prev["start"], tok["end"])
            elif t == "operator":
                raise _missing_operand(tok)  # "*x", "(*x)"
            elif t == "rparen" and not opens:
                raise EquationSyntaxError(
                    'Mismatched parentheses: unmatched ")"', tok["start"], tok["end"])
            else:
                raise EquationSyntaxError(f'Unexpected "{tok["text"]}"', tok["start"], tok["end"])
        elif t == "operator":
            expect_value = True
        elif t == "rparen":
            if not opens:
                raise EquationSyntaxError(
                    'Mismatched parentheses: unmatched ")"', tok["start"], tok["end"])
            opens.pop()
        elif t == "comma":
            func = opens[-1][1] if opens else None
            if func is None:
                raise EquationSyntaxError('Unexpected ","', tok["start"], tok["end"])
            raise EquationSyntaxError(
                f'function "{func["value"]}" takes exactly one argument',
                func["start"], tok["end"])
        else:
            raise EquationSyntaxError(
                f'Missing operator before "{tok["text"]}" (write "*" to multiply)',
                tok["start"], tok["end"])
        prev = tok
        i += 1
    if expect_value:
        if prev is not None and prev["type"] in ("operator", "unary"):
            raise _missing_operand(prev)
        if not opens:
            raise EquationSyntaxError("Expected a value", *whole)
    if opens:
        lparen, func = opens[-1]
        start = func["start"] if func is not None else lparen["start"]
        raise EquationSyntaxError(
            'Mismatched parentheses: "(" is never closed', start, lparen["end"])


def _should_pop(stack_op: str, new_op: str) -> bool:
    sp, np_ = _PREC[stack_op], _PREC[new_op]
    return sp > np_ if new_op == "^" else sp >= np_


def _to_rpn(tokens: list[Token]) -> list[Token]:
    """Shunting-yard. ``_check_sequence`` has already proven the token stream
    well-formed, so this cannot meet an unbalanced parenthesis."""
    rpn: list[Token] = []
    op_stack: list[Token] = []
    for tok in tokens:
        ttype = tok["type"]
        if ttype in _VALUE_TYPES:
            rpn.append(tok)
        elif ttype in ("function", "unary", "lparen"):
            op_stack.append(tok)  # prefix: pushed without popping anything
        elif ttype == "operator":
            while (op_stack and op_stack[-1]["type"] in ("operator", "unary")
                   and _should_pop(op_stack[-1]["value"], tok["value"])):
                rpn.append(op_stack.pop())
            op_stack.append(tok)
        elif ttype == "rparen":
            while op_stack[-1]["type"] != "lparen":
                rpn.append(op_stack.pop())
            op_stack.pop()  # discard '('
            if op_stack and op_stack[-1]["type"] == "function":
                rpn.append(op_stack.pop())
    while op_stack:
        rpn.append(op_stack.pop())
    return rpn


def _check_arity(rpn: list[Token], whole: tuple[int, int]) -> None:
    """Defensive backstop: RPN that would under/overflow the eval stack. The
    sequence check should make this unreachable."""
    depth = 0
    for tok in rpn:
        ttype = tok["type"]
        if ttype in _VALUE_TYPES:
            depth += 1
        elif ttype == "operator":
            if depth < 2:
                raise _missing_operand(tok)
            depth -= 1
        elif depth < 1:  # function / unary
            raise EquationSyntaxError(f'"{tok["text"]}" is missing its operand',
                                      tok["start"], tok["end"])
    if depth != 1:
        raise EquationSyntaxError("malformed expression (check operators and parentheses)", *whole)


def parse_tokens(
    eqn_str: str,
) -> tuple[list[Token], list[Token], list[str], dict[str, tuple[int, int]]]:
    """``(tokens, rpn, param_names, param_spans)`` for ``eqn_str``.

    ``param_spans`` maps each parameter to its FIRST occurrence. Raises
    ``EquationSyntaxError`` (a ValueError) with a span on any syntax error.
    """
    stripped = eqn_str.strip()
    lead = len(eqn_str) - len(eqn_str.lstrip())
    m = _LHS.match(stripped)
    cut = m.end() if m else 0
    expr = stripped[cut:]
    whole = (0, max(len(eqn_str), 1))
    if not expr:
        raise EquationSyntaxError("Equation string is empty.", *whole)
    tokens, params, spans = _tokenize(expr, lead + cut)
    _check_sequence(tokens, whole)
    rpn = _to_rpn(tokens)
    _check_arity(rpn, whole)
    return tokens, rpn, params, spans
