"""Seeded data families for the plot corpus (pure: numpy + quantized only).

Each family plants data whose answer is known in advance, plus the edge case
it exists for (NaN gaps, a loop in X, a deleted sheet ...). Anything the app
also decides is DERIVED from quantized rather than restated here, per the
fixtures rule:

* column designations are spelled with the wire strings of
  ``quantized.io.origin_project.writer._DESIGNATION_CODE`` (the same strings
  the decoder emits), and the builder maps them to LabTalk with that table;
* Unicode units are written in their raw file spelling and the truth records
  ``quantized.unit_display.display_unit`` of each, i.e. what quantized's axis
  title will show;
* date columns are Origin day numbers derived from
  ``quantized.io.origin_project.opj_books.ORIGIN_DAY_NUMBER_OF_UNIX_EPOCH``.

Every family asserts its own edge case (:func:`check_family`), so a change
that quietly removes the property fails loudly instead of leaving a family
named "nan_gaps" that has no gaps.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import plot_types as pt

from quantized.io.origin_project.opj_books import ORIGIN_DAY_NUMBER_OF_UNIX_EPOCH
from quantized.io.origin_project.writer import _DESIGNATION_CODE
from quantized.unit_display import display_unit

__all__ = [
    "FAMILIES", "Book", "Column", "Family", "Matrix", "Sheet", "build_family", "check_family",
]

DESIGNATIONS = frozenset(_DESIGNATION_CODE)
LARGE_N = 20_000  # "large" while keeping the corpus cheap to clone


@dataclass
class Column:
    short: str
    long: str
    units: str
    designation: str
    values: list[float | None] | None = None
    text: list[str] | None = None
    comment: str = ""
    fmt: str = "numeric"  # numeric | text | date

    def __post_init__(self) -> None:
        if self.designation not in DESIGNATIONS:
            raise ValueError(f"{self.designation!r} is not a quantized designation")
        if (self.values is None) == (self.text is None):
            raise ValueError("a column holds numbers or text, not both/neither")

    @property
    def n_rows(self) -> int:
        return len(self.values if self.values is not None else self.text or [])


@dataclass
class Sheet:
    name: str
    columns: list[Column]
    deleted: bool = False  # built, then deleted in Origin
    masked_rows: dict[str, list[int]] = field(default_factory=dict)  # col short -> rows


@dataclass
class Book:
    name: str
    sheets: list[Sheet]


@dataclass
class Matrix:
    name: str
    values: list[list[float | None]]
    x1: float
    x2: float
    y1: float
    y2: float


@dataclass
class Family:
    name: str
    description: str
    shapes: frozenset[str]
    books: list[Book]
    matrices: list[Matrix] = field(default_factory=list)
    axis: dict[str, str] = field(default_factory=dict)  # {"x": "log10", ...}
    truth: dict[str, Any] = field(default_factory=dict)


def _f(a: Any) -> list[float | None]:
    return [None if not np.isfinite(v) else float(v) for v in np.asarray(a, dtype=float)]


def _xy_sheet(x: Any, ys: list[Any], *, xl: str = "x", xu: str = "", names: list[str] | None = None,
              units: list[str] | None = None) -> Sheet:
    cols = [Column("A", xl, xu, "X", _f(x))]
    for i, y in enumerate(ys):
        short = chr(ord("B") + i)
        nm = names[i] if names else f"y{i + 1}"
        un = units[i] if units else ""
        cols.append(Column(short, nm, un, "Y", _f(y)))
    return Sheet("Sheet1", cols)


def _base(rng: np.random.Generator, n: int = 50) -> tuple[Any, list[Any]]:
    x = np.linspace(0.0, 10.0, n)
    return x, [np.sin(x) + 2.0, 0.5 * np.cos(x) + 1.0, 0.1 * x + 0.5]


_XY_ALL = frozenset({pt.XY, pt.XY_MULTI, pt.XYY, pt.CATEGORY, pt.DISTRIBUTION})


def clean(rng: np.random.Generator) -> Family:
    x, ys = _base(rng)
    return Family("clean", "smooth noiseless curves on an ascending grid", _XY_ALL,
                  [Book("Clean", [_xy_sheet(x, ys)])])


def noisy(rng: np.random.Generator) -> Family:
    x, ys = _base(rng)
    ys = [y + rng.normal(0.0, 0.15, x.size) for y in ys]
    return Family("noisy", "the clean curves plus seeded gaussian noise (sigma 0.15)", _XY_ALL,
                  [Book("Noisy", [_xy_sheet(x, ys)])], truth={"noise_sigma": 0.15})


def nan_gaps(rng: np.random.Generator) -> Family:
    x, ys = _base(rng)
    gaps = [7, 8, 9, 30]
    ys[0][gaps] = np.nan
    return Family("nan_gaps", "missing values inside y1 (rows 7-9 and 30)", _XY_ALL,
                  [Book("Gaps", [_xy_sheet(x, ys)])], truth={"nan_rows": {"B": gaps}})


def masked_rows(rng: np.random.Generator) -> Family:
    x, ys = _base(rng)
    sheet = _xy_sheet(x, ys)
    sheet.masked_rows = {"B": [10, 11, 12, 13]}
    return Family("masked_rows", "y1 rows 10-13 masked in Origin (values present)", _XY_ALL,
                  [Book("Masked", [sheet])], truth={"masked_rows": {"B": [10, 11, 12, 13]}})


def descending_x(rng: np.random.Generator) -> Family:
    x, ys = _base(rng)
    return Family("descending_x", "X strictly descending; rows kept in file order", _XY_ALL,
                  [Book("Desc", [_xy_sheet(x[::-1], [y[::-1] for y in ys])])],
                  truth={"x_order": "descending"})


def loop_x(rng: np.random.Generator) -> Family:
    t = np.linspace(0.0, 2.0 * np.pi, 81)
    h = np.cos(t)
    m = np.tanh(3.0 * (h + np.where(np.sin(t) > 0, 0.3, -0.3)))
    return Family("loop_x", "a hysteresis loop: X goes down then back up", frozenset({pt.XY}),
                  [Book("Loop", [_xy_sheet(h, [m], xl="H", xu="T", names=["M"], units=["emu"])])],
                  truth={"x_order": "non_monotonic"})


def multi_x(rng: np.random.Generator) -> Family:
    x1 = np.linspace(0.0, 5.0, 30)
    x2 = np.linspace(1.0, 9.0, 30)
    cols = [Column("A", "x1", "", "X", _f(x1)), Column("B", "y1", "", "Y", _f(np.sqrt(x1))),
            Column("C", "x2", "", "X", _f(x2)), Column("D", "y2", "", "Y", _f(np.log(x2)))]
    return Family("multi_x", "X,Y,X,Y: each Y binds to its nearest-preceding X",
                  frozenset({pt.XY}), [Book("MultiX", [Sheet("Sheet1", cols)])],
                  truth={"bindings": {"B": "A", "D": "C"}})


def log_range(rng: np.random.Generator) -> Family:
    x = np.logspace(-3, 3, 61)
    return Family("log_range", "six decades in X and Y, log10 axes",
                  frozenset({pt.XY, pt.XY_MULTI}),
                  [Book("LogR", [_xy_sheet(x, [x**1.5, 3.0 * x**0.5])])],
                  axis={"x": "log10", "y": "log10"})


def negative(rng: np.random.Generator) -> Family:
    x = np.linspace(-5.0, 5.0, 41)
    return Family("negative", "X and Y cross zero; Y mostly negative", _XY_ALL,
                  [Book("Neg", [_xy_sheet(x, [x**3 / 10.0 - 4.0, -np.abs(x) - 1.0])])])


def huge_tiny(rng: np.random.Generator) -> Family:
    x = np.linspace(1.0, 10.0, 25)
    return Family("huge_tiny", "y1 ~1e12, y2 ~1e-12 (two separate magnitudes)",
                  frozenset({pt.XY, pt.CATEGORY, pt.DISTRIBUTION}),
                  [Book("Mag", [_xy_sheet(x, [1e12 * x, 1e-12 * x**2])])])


def text_categories(rng: np.random.Generator) -> Family:
    cats = ["alpha", "beta", "gamma", "delta", "epsilon"]
    cols = [Column("A", "sample", "", "X", text=cats, fmt="text"),
            Column("B", "run 1", "counts", "Y", _f([3, 7, 2, 9, 5])),
            Column("C", "run 2", "counts", "Y", _f([4, 6, 3, 8, 1]))]
    return Family("text_categories", "text X categories with two numeric series",
                  frozenset({pt.CATEGORY}), [Book("Cats", [Sheet("Sheet1", cols)])],
                  truth={"categories": cats})


def dates(rng: np.random.Generator) -> Family:
    unix0 = 1_767_225_600.0  # 2026-01-01T00:00:00Z
    unix = unix0 + 86400.0 * np.arange(30)
    days = unix / 86400.0 + ORIGIN_DAY_NUMBER_OF_UNIX_EPOCH
    y = 20.0 + 5.0 * np.sin(np.arange(30) / 4.0)
    cols = [Column("A", "date", "", "X", _f(days), fmt="date"),
            Column("B", "temperature", "degC", "Y", _f(y))]
    return Family("dates", "daily dates in X (Origin day numbers)", frozenset({pt.XY}),
                  [Book("Dates", [Sheet("Sheet1", cols)])],
                  truth={"unix_seconds_first": unix0, "unix_seconds_step": 86400.0})


def large_n(rng: np.random.Generator) -> Family:
    x = np.linspace(0.0, 100.0, LARGE_N)
    y = np.sin(x / 3.0) + rng.normal(0.0, 0.05, LARGE_N)
    return Family("large_n", f"{LARGE_N} points (stands in for 'large')",
                  frozenset({pt.XY, pt.DISTRIBUTION}), [Book("Large", [_xy_sheet(x, [y])])])


def single_point(rng: np.random.Generator) -> Family:
    return Family("single_point", "one row", frozenset({pt.XY, pt.CATEGORY, pt.DISTRIBUTION}),
                  [Book("One", [_xy_sheet([2.5], [[4.0]])])])


def duplicates(rng: np.random.Generator) -> Family:
    x = np.repeat(np.arange(10.0), 2)
    y = np.repeat(np.arange(10.0) ** 1.2, 2)
    y[1::4] += 0.5
    return Family("duplicates", "every X twice; some rows exact duplicates",
                  frozenset({pt.XY, pt.CATEGORY, pt.DISTRIBUTION}),
                  [Book("Dups", [_xy_sheet(x, [y])])])


_RAW_UNITS = ["Ang^-1", "emu/cm3", "um"]


def unicode_names(rng: np.random.Generator) -> Family:
    x, ys = _base(rng, 30)
    names = ["μ₀H ↑", "Δρ/ρ₀", "χ″ (ac)"]
    sheet = _xy_sheet(x, ys, xl="2θ", xu="deg", names=names, units=_RAW_UNITS)
    return Family("unicode_names", "Unicode long names and exponent units", _XY_ALL,
                  [Book("Uni", [sheet])],
                  truth={"display_units": {u: display_unit(u) for u in _RAW_UNITS}})


def error_columns(rng: np.random.Generator) -> Family:
    x = np.linspace(1.0, 10.0, 20)
    y = 2.0 * x + 1.0
    cols = [Column("A", "x", "", "X", _f(x)), Column("B", "y", "", "Y", _f(y)),
            Column("C", "dy", "", "Y-error", _f(0.1 * y)),
            Column("D", "dx", "", "X-error", _f(np.full_like(x, 0.2)))]
    return Family("error_columns", "Y with a Y-error and an X-error column",
                  frozenset({pt.XY, pt.XY_ERR}), [Book("Err", [Sheet("Sheet1", cols)])],
                  truth={"error_of": {"C": "B", "D": "A"}})


def many_sheets(rng: np.random.Generator) -> Family:
    x = np.linspace(0.0, 1.0, 11)
    sheets = []
    for k in range(5):
        s = _xy_sheet(x, [x ** (k + 1)])
        s.name = f"Run{k + 1}"
        sheets.append(s)
    return Family("many_sheets", "one book, five sheets; graphs plot sheet Run1",
                  frozenset({pt.XY}), [Book("Sheets", sheets)],
                  truth={"sheet_names": [s.name for s in sheets]})


def deleted_sheet(rng: np.random.Generator) -> Family:
    x = np.linspace(0.0, 1.0, 11)
    sheets = []
    for k in range(3):
        s = _xy_sheet(x, [x + k])
        s.name = f"Keep{k + 1}" if k != 1 else "Gone"
        s.deleted = k == 1
        sheets.append(s)
    return Family("deleted_sheet", "three sheets built, the middle one deleted before save",
                  frozenset({pt.XY}), [Book("Del", sheets)],
                  truth={"sheet_names": ["Keep1", "Keep3"], "deleted": ["Gone"]})


def _grid(n: int = 15) -> tuple[Any, Any, Any]:
    g = np.linspace(0.0, 1.0, n)
    xx, yy = np.meshgrid(g, g, indexing="ij")
    return xx.ravel(), yy.ravel(), np.sin(3.0 * xx.ravel()) * np.cos(2.0 * yy.ravel())


def xyz_grid(rng: np.random.Generator) -> Family:
    x, y, z = _grid()
    cols = [Column("A", "x", "mm", "X", _f(x)), Column("B", "y", "mm", "Y", _f(y)),
            Column("C", "height", "nm", "Z", _f(z))]
    return Family("xyz_grid", "regular 15x15 XYZ grid, z = sin(3x)cos(2y)", frozenset({pt.XYZ}),
                  [Book("XYZ", [Sheet("Sheet1", cols)])])


def matrix(rng: np.random.Generator) -> Family:
    g = np.linspace(0.0, 1.0, 20)
    xx, yy = np.meshgrid(g, g)  # rows = y, cols = x
    z = np.sin(3.0 * xx) * np.cos(2.0 * yy)
    return Family("matrix", "20x20 matrix, z = sin(3x)cos(2y), x/y in [0,1]",
                  frozenset({pt.MATRIX}), [],
                  matrices=[Matrix("Mat", [_f(r) for r in z], 0.0, 1.0, 0.0, 1.0)])


def ternary(rng: np.random.Generator) -> Family:
    a = rng.uniform(0.05, 0.9, 30)
    b = (1.0 - a) * rng.uniform(0.05, 0.95, 30)
    c = 1.0 - a - b
    cols = [Column("A", "A", "", "X", _f(a)), Column("B", "B", "", "Y", _f(b)),
            Column("C", "C", "", "Z", _f(c))]
    return Family("ternary", "30 compositions with a+b+c = 1", frozenset({pt.TERNARY}),
                  [Book("Tern", [Sheet("Sheet1", cols)])])


def polar(rng: np.random.Generator) -> Family:
    th = np.linspace(0.0, 360.0, 73)
    r = 1.0 + 0.5 * np.cos(np.radians(3.0 * th))
    return Family("polar", "a three-lobed rose: theta in degrees, r > 0", frozenset({pt.POLAR}),
                  [Book("Polar", [_xy_sheet(th, [r], xl="theta", xu="deg", names=["r"])])])


FAMILIES: dict[str, Callable[[np.random.Generator], Family]] = {
    f.__name__: f
    for f in (clean, noisy, nan_gaps, masked_rows, descending_x, loop_x, multi_x, log_range,
              negative, huge_tiny, text_categories, dates, large_n, single_point, duplicates,
              unicode_names, error_columns, many_sheets, deleted_sheet, xyz_grid, matrix,
              ternary, polar)
}


def build_family(name: str, seed: int) -> Family:
    """Family ``name`` from its own stream (seed + stable per-name offset)."""
    offset = sum(ord(c) for c in name)
    fam = FAMILIES[name](np.random.default_rng(seed + offset))
    check_family(fam)
    return fam


def _col(fam: Family, short: str) -> Column:
    return next(c for c in fam.books[0].sheets[0].columns if c.short == short)


def check_family(fam: Family) -> None:
    """Assert the family still HAS the property it exists for."""
    for book in fam.books:
        for sheet in book.sheets:
            lengths = {c.n_rows for c in sheet.columns}
            assert len(lengths) == 1, f"{fam.name}: ragged sheet {sheet.name}"
    t = fam.truth
    if "nan_rows" in t:
        for short, rows in t["nan_rows"].items():
            vals = _col(fam, short).values or []
            assert all(vals[r] is None for r in rows), f"{fam.name}: gap rows not NaN"
    if t.get("x_order") == "descending":
        x = np.array(_col(fam, "A").values, dtype=float)
        assert np.all(np.diff(x) < 0), f"{fam.name}: X not descending"
    if t.get("x_order") == "non_monotonic":
        d = np.sign(np.diff(np.array(_col(fam, "A").values, dtype=float)))
        assert (d > 0).any() and (d < 0).any(), f"{fam.name}: X is monotonic"
    if fam.name == "single_point":
        assert _col(fam, "A").n_rows == 1
    if fam.name == "large_n":
        assert _col(fam, "A").n_rows == LARGE_N
    if fam.name == "duplicates":
        xs = _col(fam, "A").values or []
        assert len(set(xs)) < len(xs), "duplicates family lost its duplicate X"
    if fam.name == "huge_tiny":
        assert abs(_col(fam, "B").values[-1] or 0) > 1e11  # type: ignore[index]
        assert abs(_col(fam, "C").values[-1] or 1) < 1e-9  # type: ignore[index]
    if fam.name == "unicode_names":
        assert any(display_unit(u) != u for u in _RAW_UNITS), "no unit changes on display"
        assert any(ord(ch) > 127 for c in fam.books[0].sheets[0].columns for ch in c.long)
    if fam.name == "deleted_sheet":
        assert sum(s.deleted for s in fam.books[0].sheets) == 1
    if fam.name == "ternary":
        a, b, c = (np.array(_col(fam, k).values, dtype=float) for k in "ABC")
        assert np.allclose(a + b + c, 1.0)
    if pt.XY_MULTI in fam.shapes:
        ys = [c for c in fam.books[0].sheets[0].columns if c.designation == "Y"]
        assert len(ys) >= 2, f"{fam.name}: xy_multi needs >= 2 Y"
