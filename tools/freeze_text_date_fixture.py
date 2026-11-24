"""Freeze pandas / stdlib / dateutil reference values for the text and
date-time formula functions (``frontend/src/lib/formulaText.ts``,
``formulaDate.ts``, ``formulaCalendar.ts``; gap audit 9 G16).

Usage: ``uv run python tools/freeze_text_date_fixture.py``. pandas (BSD) and
python-dateutil (Apache/BSD) are the ORACLE only; the app computes the values
itself and ``formulaTextDate.test.ts`` compares them. Inputs the app refuses
BY DESIGN where pandas is more lenient (``inf``/``nan``/hex numbers, basic-
format dates) are listed in ``formulaTextDate.test.ts``, not here.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
from dateutil.relativedelta import relativedelta

OUT = Path(__file__).resolve().parents[1] / "frontend/src/lib/__fixtures__/formulaTextDate.json"
NAN = float("nan")

# Sample names: units to extract, empty, padded, Unicode (accents, CJK, an
# astral emoji = 1 code point / 2 UTF-16 units), repeated matches, no match.
TEXT = [
    "NbFe 300K",
    "Fe3O4_10K_run2",
    "  padded 5K  ",
    "",
    "café 77K",
    "样品A 4K",
    "😀 12K",
    "no unit here",
    "300K 300K",
    "ΣIGMA σς 2K",
    "Straße 1K",
    "x",
]
NUMS = [
    "12",
    " 7 ",
    "1.5",
    "-2e3",
    "+.5",
    "1e-2",
    "abc",
    "",
    "1,000",
    "0x10 ",
    "3.",
    "--1",
    "12abc",
    "٣",
]
# Number -> str(): values with exact short decimal expansions only (no ties).
FLOATS = [300.0, 1.5, -2.25, 0.0, 1234.5678, 1e-3, 77.0, 0.3127]
ISO = [
    "2026-03-01",
    "2026-03-01T12:30:45",
    "2026-03-01 12:30:45",
    "2026-03-01T12:30:45Z",
    "2026-03-01T12:30:45+05:30",
    "2026-03-01T12:30:45-0800",
    "2026-03-01T12:30",
    "2026-03-01T12:30:45.250Z",
    "2024-02-29",
    "2000-02-29",
    "1999-12-31T23:59:59Z",
    "1969-07-20T20:17:40Z",
    "2100-02-29",
    "2025-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-03-01T25:00:00",
    "2026-03-01T12:61:00",
    "not a date",
    "",
]
EPOCHS = [
    0.0,
    1.0,
    951782400.0,
    1709164800.0,
    1772368245.5,
    -86400.0,
    -1.5,
    1e9,
    4102444799.0,
    951827999.0,
    1678060800.0,
    7952400000.0,
]
WIDE = [-62135596800.0, 253402300799.0]  # 0001-01-01 and 9999-12-31T23:59:59 (stdlib datetime only)
PAIRS = [
    ("2026-01-31T00:00:00Z", "2026-02-28T00:00:00Z"),
    ("2026-01-31T00:00:00Z", "2026-03-01T00:00:00Z"),
    ("2024-02-29T12:00:00Z", "2025-02-28T12:00:00Z"),
    ("2024-02-29T12:00:00Z", "2025-03-01T11:59:59Z"),
    ("2024-02-29T12:00:00Z", "2028-02-29T12:00:00Z"),
    ("2026-03-15T08:00:00Z", "2026-01-15T08:00:00Z"),
    ("2026-03-15T08:00:00Z", "2026-01-15T09:00:00Z"),
    ("2026-03-15T08:00:00Z", "2026-01-15T07:00:00Z"),
    ("2026-03-08T00:00:00Z", "2026-03-09T00:00:00Z"),  # US DST day: still 24 h in UTC
    ("1999-12-31T23:59:59Z", "2000-01-01T00:00:00Z"),
    ("2026-03-01T00:00:00Z", "2026-03-01T00:00:00Z"),
]
MAKE = [
    (2026, 3, 1, 0, 0, 0),
    (2024, 2, 29, 12, 30, 45),
    (1999, 12, 31, 23, 59, 59),
    (1970, 1, 1, 0, 0, 0),
    (1969, 12, 31, 23, 59, 59),
    (2000, 2, 29, 0, 0, 0),
    (1, 1, 1, 0, 0, 0),
    (9999, 12, 31, 23, 59, 59),
]
MAKE_BAD = [
    (2026, 2, 30),
    (2026, 13, 1),
    (2026, 0, 1),
    (2100, 2, 29),
    (2026, 4, 31),
    (2026, 3, 1.5),
    (0, 1, 1),
]


def f(v: float | int | bool) -> float | None:
    return None if pd.isna(v) else float(v)


def text_expected() -> dict[str, list[float | None]]:
    s = pd.Series(TEXT, dtype="string")
    num = lambda x: pd.to_numeric(x, errors="coerce")  # noqa: E731
    flt = pd.Series(FLOATS)
    cases: dict[str, pd.Series] = {
        'len(col("S"))': s.str.len(),
        'contains(col("S"), "Fe")': s.str.contains("Fe", regex=False),
        'startswith(col("S"), "No")': s.str.startswith("No"),
        'endswith(col("S"), "K")': s.str.endswith("K"),
        'find(col("S"), "K")': s.str.find("K") + 1,
        'find(col("S"), "")': s.str.find("") + 1,
        'regex_match(col("S"), "\\d+K")': s.str.contains(r"\d+K", regex=True),
        'regex_match(col("S"), "^[A-Z]")': s.str.contains(r"^[A-Z]", regex=True),
        'num(regex_extract(col("S"), "(\\d+)K", 1))': num(s.str.extract(r"(\d+)K")[0]),
        'num(regex_extract(col("S"), "(\\d+)K"))': num(s.str.extract(r"(\d+)K")[0]),
        'len(regex_extract(col("S"), "[a-z]+", 0))': s.str.extract(r"([a-z]+)")[0].str.len(),
        'len(upper(col("S")))': s.str.upper().str.len(),
        'contains(lower(col("S")), "nbfe")': s.str.lower().str.contains("nbfe", regex=False),
        'len(trim(col("S")))': s.str.strip().str.len(),
        'len(left(col("S"), 3))': s.str[:3].str.len(),
        'find(right(col("S"), 4), "K")': s.str[-4:].str.find("K") + 1,
        'len(mid(col("S"), 2, 4))': s.str[1:5].str.len(),
        'len(substr(col("S"), 3, 100))': s.str[2:].str.len(),
        'len(replace(col("S"), "Fe", "Iron"))': s.str.replace("Fe", "Iron", regex=False).str.len(),
        'len(concat(col("S"), "-", trim(col("S"))))': (s + "-" + s.str.strip()).str.len(),
        'num(concat(trim(left(col("S"), 3)), "1"))': num(s.str[:3].str.strip() + "1"),
    }
    out = {k: [f(v) for v in series] for k, series in cases.items()}
    n = pd.Series(NUMS, dtype="string")
    # num(): pandas also accepts inf/nan/hex-free forms; NUMS avoids those cases.
    out['num(col("N"))'] = [f(v) for v in num(n.str.strip())]
    out["__str__"] = []
    strs = {
        "len(str(A))": flt.map(lambda v: len(str(int(v)) if v == int(v) else repr(v))),
        'len(str(A, "%.2f"))': flt.map(lambda v: len(f"{v:.2f}")),
        'num(str(A, "%.2f"))': num(flt.map(lambda v: f"{v:.2f}")),
        'len(str(A, "%d"))': flt.map(lambda v: len(f"{round(v):d}")),
        'len(str(A, "%e"))': flt.map(lambda v: len(f"{v:e}")),
        'len(str(A, "%.3g"))': flt.map(lambda v: len(f"{v:.3g}")),
        'num(str(A, "%.3g"))': num(flt.map(lambda v: f"{v:.3g}")),
    }
    del out["__str__"]
    out.update({k: [f(v) for v in series] for k, series in strs.items()})
    return out


def utc(t: float) -> pd.Timestamp:
    return pd.Timestamp(t, unit="s", tz="UTC")


def date_expected() -> dict[str, object]:
    # One string at a time: a whole-Series parse lets one element's UTC offset
    # leak into a neighbour that has none (seen with pandas 2.3.3).
    parsed = [pd.to_datetime(v, utc=True, format="ISO8601", errors="coerce") for v in ISO]
    parse = [None if pd.isna(v) else v.timestamp() for v in parsed]
    fields: dict[str, list[float | None]] = {
        k: [] for k in ("year", "month", "day", "hour", "minute", "second", "weekday", "dayofyear")
    }
    for t in EPOCHS:
        ts = utc(t)
        fields["year"].append(ts.year)
        fields["month"].append(ts.month)
        fields["day"].append(ts.day)
        fields["hour"].append(ts.hour)
        fields["minute"].append(ts.minute)
        fields["second"].append(ts.second + ts.microsecond / 1e6)
        fields["weekday"].append((ts.dayofweek + 1) % 7 + 1)  # pandas Monday=0 -> Sunday=1
        fields["dayofyear"].append(ts.dayofyear)
    wide = {k: [] for k in fields}
    for t in WIDE:
        d = datetime.fromtimestamp(t, tz=UTC) if t > 0 else datetime(1, 1, 1, tzinfo=UTC)
        wide["year"].append(d.year)
        wide["month"].append(d.month)
        wide["day"].append(d.day)
        wide["hour"].append(d.hour)
        wide["minute"].append(d.minute)
        wide["second"].append(d.second)
        wide["weekday"].append(d.isoweekday() % 7 + 1)
        wide["dayofyear"].append(d.timetuple().tm_yday)
    diffs: dict[str, list[float]] = {
        u: [] for u in ("second", "minute", "hour", "day", "week", "month", "year")
    }
    secs = {"second": 1, "minute": 60, "hour": 3600, "day": 86400, "week": 604800}
    pa = [pd.Timestamp(a) for a, _ in PAIRS]
    pb = [pd.Timestamp(b) for _, b in PAIRS]
    for a, b in zip(pa, pb, strict=True):
        for u, k in secs.items():
            diffs[u].append((b - a).total_seconds() / k)
        rd = relativedelta(b, a)
        diffs["month"].append(rd.years * 12 + rd.months)
        diffs["year"].append(rd.years)
    made = [datetime(*m, tzinfo=UTC).timestamp() for m in MAKE]
    return {
        "iso": ISO,
        "parse_date": parse,
        "epochs": EPOCHS,
        "fields": fields,
        "wide_epochs": WIDE,
        "wide_fields": wide,
        "pair_a": [a.timestamp() for a in pa],
        "pair_b": [b.timestamp() for b in pb],
        "datediff": diffs,
        "make": [list(m) for m in MAKE],
        "make_expected": made,
        "make_bad": [list(m) for m in MAKE_BAD],
    }


if __name__ == "__main__":
    doc = {
        "pandas": pd.__version__,
        "text": TEXT,
        "nums": NUMS,
        "floats": FLOATS,
        "text_expected": text_expected(),
        "date": date_expected(),
    }
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", OUT)
