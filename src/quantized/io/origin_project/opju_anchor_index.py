"""First-occurrence lookup for a book's length-prefixed name anchors.

``windows_opju._book_anchor`` finds a book's window section by the first
occurrence at or after ``search_from`` of ``<len+2> 00 00 <name>`` (form 1) or
``<len+1> <name> 00`` (form 2). A book with no such section costs one full
scan of the file tail per form, and a project with hundreds of books repeats
that hundreds of times (a 30 MB project spent ~8 s in ``bytes.find`` alone).

:class:`AnchorSearcher` answers exactly what ``bytes.find`` would: the first
match position, or -1. The first few queries use ``find`` itself; once enough
queries are made one vectorised pass over the tail indexes every candidate of
both forms (form 2 only for all-printable names, any other name keeps using
``find``), so each later query is a dictionary lookup.
"""

from __future__ import annotations

from bisect import bisect_left

import numpy as np

__all__ = ["AnchorSearcher"]

_CHUNK = 1 << 20
_LOOKAHEAD = 256  # a length byte reaches at most 255 bytes ahead
_DIRECT_QUERIES = 8  # queries answered by find() before the index is built
_PRINTABLE_LO, _PRINTABLE_HI = 0x20, 0x7E


def _is_printable(name: bytes) -> bool:
    return all(_PRINTABLE_LO <= c <= _PRINTABLE_HI for c in name)


class AnchorSearcher:
    def __init__(self, b: bytes, from_pos: int) -> None:
        self._b = b
        self._from = from_pos
        self._queries = 0
        self._form1: dict[bytes, list[int]] | None = None
        self._form2: dict[bytes, list[int]] = {}

    def find_form1(self, name: bytes, search_from: int) -> int:
        """``b.find(bytes([len(name)+2]) + b"\\0\\0" + name, search_from)``."""
        pattern = bytes([len(name) + 2]) + b"\x00\x00" + name
        if not self._use_index(len(name) >= 1 and len(name) + 2 < 256, search_from):
            return self._b.find(pattern, search_from)
        assert self._form1 is not None
        return _first(self._form1.get(name), search_from)

    def find_form2(self, name: bytes, search_from: int) -> int:
        """``b.find(bytes([len(name)+1]) + name + b"\\0", search_from)``."""
        pattern = bytes([len(name) + 1]) + name + b"\x00"
        ok = len(name) >= 4 and len(name) + 1 < 256 and _is_printable(name)
        if not self._use_index(ok, search_from):
            return self._b.find(pattern, search_from)
        return _first(self._form2.get(name), search_from)

    def _use_index(self, eligible: bool, search_from: int) -> bool:
        self._queries += 1
        if not eligible or search_from < self._from or self._queries <= _DIRECT_QUERIES:
            return False
        if self._form1 is None:
            self._build()
        return True

    def _build(self) -> None:
        b = self._b
        arr = np.frombuffer(b, dtype=np.uint8)
        n = len(arr)
        form1: dict[bytes, list[int]] = {}
        form2: dict[bytes, list[int]] = {}
        for c in range(self._from, n, _CHUNK):
            cnt = min(_CHUNK, n - c)
            seg = np.zeros(cnt + _LOOKAHEAD, dtype=np.uint8)  # zero pad past EOF
            tail = arr[c : c + cnt + _LOOKAHEAD]
            seg[: len(tail)] = tail
            length = seg[:cnt].astype(np.int64)
            i = np.arange(cnt, dtype=np.int64)
            absi = i + c
            # form 1: <L> 00 00 <L-2 name bytes>, all inside the file
            m1 = (length >= 3) & (absi + length + 1 <= n)
            m1 &= (seg[1 : cnt + 1] == 0) & (seg[2 : cnt + 2] == 0)
            for k in np.flatnonzero(m1).tolist():
                a = c + k
                form1.setdefault(b[a + 3 : a + int(length[k]) + 1], []).append(a)
            # form 2: <L> <L-1 printable name bytes> 00, all inside the file
            m2 = (length >= 5) & (absi + length < n)
            if m2.any():
                j = np.minimum(i + length, cnt + _LOOKAHEAD - 1)
                m2 &= seg[j] == 0
                printable = (seg >= _PRINTABLE_LO) & (seg <= _PRINTABLE_HI)
                pcs = np.concatenate(([0], np.cumsum(printable, dtype=np.int64)))
                m2 &= (pcs[j] - pcs[i + 1]) == (length - 1)
                for k in np.flatnonzero(m2).tolist():
                    a = c + k
                    form2.setdefault(b[a + 1 : a + int(length[k])], []).append(a)
        self._form1, self._form2 = form1, form2


def _first(positions: list[int] | None, search_from: int) -> int:
    if not positions:
        return -1
    k = bisect_left(positions, search_from)
    return positions[k] if k < len(positions) else -1
