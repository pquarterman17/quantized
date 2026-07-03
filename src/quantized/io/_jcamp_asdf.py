"""JCAMP-DX ASDF ordinate decoder for ``(X++(Y..Y))`` XYDATA.

ASDF (ASCII Squeezed Difference Form) packs ordinates with four schemes:

* **AFFN / PAC** — plain signed numbers (space- or ``+``/``-``-separated).
* **SQZ** (squeezed) — the leading digit carries the sign as a letter
  (``@``=+0, ``A``-``I``=+1..+9, ``a``-``i``=-1..-9); an *absolute* value.
* **DIF** (difference) — leading letter (``%``=0, ``J``-``R``=+1..+9,
  ``j``-``r``=-1..-9) encodes the *difference* from the previous ordinate.
* **DUP** (duplicate) — ``S``-``Z``,``s`` = 1..9 repeat the previous token that
  many times *total* (so ``count-1`` additional copies); after a DIF token the
  difference is re-applied, after an absolute the value is repeated.

Cross-line rule: in DIF mode each continuation line's first ordinate repeats
the previous line's last value as a **Y-value check** — it is verified and
dropped (the line's abscissa also leads each line and is discarded, since X is
reconstructed from FIRSTX/LASTX).

Algorithm adapted from the JCAMP-DX standard (McDonald & Wilks, 1988) and the
MIT-licensed ``nzhagen/jcamp`` reference; re-implemented here.
"""

from __future__ import annotations

__all__ = ["DifCheckError", "decode_xydata"]

_SQZ = {"@": 0, "A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7, "H": 8, "I": 9,
        "a": -1, "b": -2, "c": -3, "d": -4, "e": -5, "f": -6, "g": -7, "h": -8, "i": -9}
_DIF = {"%": 0, "J": 1, "K": 2, "L": 3, "M": 4, "N": 5, "O": 6, "P": 7, "Q": 8, "R": 9,
        "j": -1, "k": -2, "l": -3, "m": -4, "n": -5, "o": -6, "p": -7, "q": -8, "r": -9}
_DUP = {"S": 1, "T": 2, "U": 3, "V": 4, "W": 5, "X": 6, "Y": 7, "Z": 8, "s": 9}

# Token modes.
_ABS, _DIFF, _DUPL = "ABS", "DIF", "DUP"


class DifCheckError(ValueError):
    """A DIF Y-value check failed (a line's leading value != previous last)."""


def _tokenize(line: str) -> list[tuple[str, float]]:
    """Split one data line into ``(mode, value)`` tokens (X first, then Y's).

    A new token starts at a sign, a SQZ/DIF/DUP letter, or after a delimiter.
    Digits, ``.`` and exponent chars extend a plain number.
    """
    tokens: list[tuple[str, float]] = []
    cur = ""
    cur_letter = ""  # the SQZ/DIF/DUP letter that opened `cur`, if any

    def flush() -> None:
        nonlocal cur, cur_letter
        if cur == "" and cur_letter == "":
            return
        if cur_letter in _SQZ:
            tokens.append((_ABS, float(f"{_SQZ[cur_letter]}{cur}")))
        elif cur_letter in _DIF:
            tokens.append((_DIFF, float(f"{_DIF[cur_letter]}{cur}")))
        elif cur_letter in _DUP:
            tokens.append((_DUPL, float(int(f"{_DUP[cur_letter]}{cur}"))))
        elif cur not in ("", "+", "-"):
            tokens.append((_ABS, float(cur)))
        cur, cur_letter = "", ""

    for ch in line:
        if ch in " \t,":
            flush()
        elif ch in _SQZ or ch in _DIF or ch in _DUP:
            flush()
            cur_letter = ch
        elif ch in "+-" and cur[-1:] not in ("e", "E"):
            flush()
            cur = ch
        elif ch.isdigit() or ch in ".eE":
            cur += ch
        # any other char (stray) ends the current token
        elif ch:
            flush()
    flush()
    return tokens


def decode_xydata(
    data_lines: list[str], *, ycheck: bool = True, ytol: float = 1e-6
) -> list[float]:
    """Decode ASDF ``(X++(Y..Y))`` lines into a flat list of raw ordinates.

    Parameters
    ----------
    ycheck
        Verify DIF-mode Y-value checks; raise :class:`DifCheckError` on mismatch.
    ytol
        Absolute tolerance for the Y-value check (raw ordinate units).
    """
    y: list[float] = []
    last = 0.0
    prev_mode, prev_val = _ABS, 0.0
    prev_line_dif = False  # did the previous line end in DIF mode?

    for li, line in enumerate(data_lines):
        toks = _tokenize(line)
        if not toks:
            continue
        ords = toks[1:]  # first token is the abscissa (X) -> discard
        line_dif = False
        first = True
        for mode, val in ords:
            if mode == _DUPL:
                for _ in range(int(val) - 1):
                    if prev_mode == _DIFF:
                        last += prev_val
                        line_dif = True
                    else:
                        last = prev_val
                    y.append(last)
                continue
            if mode == _DIFF:
                last += val
                y.append(last)
                prev_mode, prev_val, line_dif = _DIFF, val, True
            else:  # absolute (SQZ / AFFN / PAC)
                if first and li > 0 and prev_line_dif:
                    # continuation Y-check: must equal the running last value
                    if ycheck and abs(val - last) > ytol:
                        raise DifCheckError(
                            f"line {li + 1}: Y-check {val} != previous last {last}"
                        )
                    prev_mode, prev_val = _ABS, val
                else:
                    last = val
                    y.append(last)
                    prev_mode, prev_val = _ABS, val
            first = False
        prev_line_dif = line_dif
    return y
