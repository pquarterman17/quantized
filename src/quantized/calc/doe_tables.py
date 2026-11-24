"""Published design tables for :mod:`quantized.calc.doe` (GAP_AUDIT_9 J16).

Pure data, no logic. Every table below is transcribed from a published source
and is verified against that source in ``tests/test_doe.py`` (the NIST
per-design files are committed under ``tests/fixtures/nist_doe/``).

**2^(k-p) fractional factorials** (``FRACTIONAL``). NIST/SEMATECH
e-Handbook of Statistical Methods, section 5.3.3.4.7 "Summary of useful
fractional factorial designs" (Table 3.17) lists the designs and their
resolution; each design's generators come from its per-design file
(``https://www.itl.nist.gov/div898/handbook/pri/section3/eqns/2to7m4.txt`` for
2^(7-4), and so on). The same generators are in Montgomery, *Design and
Analysis of Experiments* (Wiley), the "selected 2^(k-p) fractional factorial
designs" table. Factors 1..k-p are the BASE factors (a full factorial in
standard order); factor ``k-p+j`` equals the product of the base factors
listed in ``generators[j]`` (all signs +, the principal fraction). Factor
numbers are NIST's 1-based numbers; ``doe`` maps them to letters.

**Plackett-Burman** (``PLACKETT_BURMAN_ROWS``). Plackett and Burman,
"The design of optimum multifactorial experiments", Biometrika 33(4)
(1946) 305-325, the published generating rows for N = 12, 20 and 24 runs
(the first row of each cyclic array; N-1 cyclic shifts plus a final row of
all minus signs). Cross-checked against NIST e-Handbook section 5.3.3.5
(Plackett-Burman designs) Tables 3.18-3.20 (the same rows, one position
shifted). Orthogonality is checked
numerically in the tests.

**Response-surface run counts and centre points** (``CCD_CENTER_POINTS``,
``BB_CENTER_POINTS``): NIST e-Handbook section 5.3.3.6.3 Table 3.28. These
are the only published "defaults" for the number of centre points; using them
as the tool's defaults is provisional, owner to confirm.
"""

from __future__ import annotations

#: (k factors, p generators) -> (resolution, generators for factors k-p+1..k).
#: Source: NIST e-Handbook Table 3.17 and the per-design 2to{k}m{p}.txt files.
FRACTIONAL: dict[tuple[int, int], tuple[int, tuple[tuple[int, ...], ...]]] = {
    (3, 1): (3, ((1, 2),)),
    (4, 1): (4, ((1, 2, 3),)),
    (5, 1): (5, ((1, 2, 3, 4),)),
    (5, 2): (3, ((1, 2), (1, 3))),
    (6, 1): (6, ((1, 2, 3, 4, 5),)),
    (6, 2): (4, ((1, 2, 3), (2, 3, 4))),
    (6, 3): (3, ((1, 2), (1, 3), (2, 3))),
    (7, 1): (7, ((1, 2, 3, 4, 5, 6),)),
    (7, 2): (4, ((1, 2, 3, 4), (1, 2, 4, 5))),
    (7, 3): (4, ((1, 2, 3), (2, 3, 4), (1, 3, 4))),
    (7, 4): (3, ((1, 2), (1, 3), (2, 3), (1, 2, 3))),
    (8, 1): (8, ((1, 2, 3, 4, 5, 6, 7),)),
    (8, 2): (5, ((1, 2, 3, 4), (1, 2, 5, 6))),
    (8, 3): (4, ((1, 2, 3), (1, 2, 4), (2, 3, 4, 5))),
    (8, 4): (4, ((2, 3, 4), (1, 3, 4), (1, 2, 3), (1, 2, 4))),
    (9, 2): (6, ((1, 3, 4, 6, 7), (2, 3, 5, 6, 7))),
    (9, 3): (4, ((1, 2, 3, 4), (1, 3, 5, 6), (3, 4, 5, 6))),
    (9, 4): (4, ((2, 3, 4, 5), (1, 3, 4, 5), (1, 2, 4, 5), (1, 2, 3, 5))),
    (9, 5): (3, ((1, 2, 3), (2, 3, 4), (1, 3, 4), (1, 2, 4), (1, 2, 3, 4))),
    (10, 3): (5, ((1, 2, 3, 7), (2, 3, 4, 5), (1, 3, 4, 6))),
    (10, 4): (4, ((2, 3, 4, 6), (1, 3, 4, 6), (1, 2, 4, 5), (1, 2, 3, 5))),
    (10, 5): (4, ((1, 2, 3, 4), (1, 2, 3, 5), (1, 2, 4, 5), (1, 3, 4, 5), (2, 3, 4, 5))),
    (10, 6): (3, ((1, 2, 3), (2, 3, 4), (1, 3, 4), (1, 2, 4), (1, 2, 3, 4), (1, 2))),
    (11, 4): (5, ((1, 2, 3, 7), (2, 3, 4, 5), (1, 3, 4, 6), (1, 2, 3, 4, 5, 6, 7))),
    (11, 5): (4, ((3, 4, 5), (1, 2, 3, 4), (1, 2, 6), (2, 4, 5, 6), (1, 4, 5, 6))),
    (11, 6): (4, ((1, 2, 3), (2, 3, 4), (3, 4, 5), (1, 3, 4), (1, 4, 5), (2, 4, 5))),
    (11, 7): (3, ((1, 2, 3), (2, 3, 4), (1, 3, 4), (1, 2, 4), (1, 2, 3, 4), (1, 2), (1, 3))),
}

#: Plackett and Burman (1946): the generating row of each cyclic array, + = 1.
PLACKETT_BURMAN_ROWS: dict[int, str] = {
    12: "++-+++---+-",
    20: "++--++++-+-+----++-",
    24: "+++++-+-++--++--+-+----",
}

#: NIST Table 3.28 centre-point counts: central composite, (k, fractional) -> n0
#: (k=2: 13 runs = 4 + 4 + 5; k=3: 20; k=4: 30; k=5: 33 / 52; k=6: 54 / 91).
CCD_CENTER_POINTS: dict[tuple[int, bool], int] = {
    (2, False): 5,
    (3, False): 6,
    (4, False): 6,
    (5, True): 7,
    (5, False): 10,
    (6, True): 10,
    (6, False): 15,
}
#: NIST Table 3.28 Box-Behnken: k=3: 15 runs (12 + 3), k=4: 27 (24 + 3), k=5: 46 (40 + 6).
BB_CENTER_POINTS: dict[int, int] = {3: 3, 4: 3, 5: 6}

#: Fallback centre points for a design NIST does not tabulate (provisional).
DEFAULT_CENTER_FALLBACK = 5

#: Factor letters: A..Z without I (reserved for the identity in I = ABC...).
LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"

#: Highest-resolution fractional factorial portion for a CCD (resolution >= V):
#: k -> p of the FRACTIONAL entry (NIST 5.3.3.6.1: "resolution V fractional").
CCD_FRACTION_P: dict[int, int] = {5: 1, 6: 1, 7: 1, 8: 2}
