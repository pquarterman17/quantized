"""Scorecard output for ``score_import.py``: tallies, findings, markdown.

The JSON scorecard keeps every verdict; the markdown summary lists WRONG and
PHANTOM findings first (a wrong value is worse than a missing one), then the
omission reasons, then the per type and per (type x family) tables.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any

__all__ = ["CHECKS", "findings", "iter_verdicts", "tally", "to_markdown", "write_reports"]

CHECKS = (
    "curves", "drawn", "values", "column_meta", "plot_type", "axes", "styles",
    "error_bars", "sheets", "figures",
)
STATUSES = ("match", "wrong", "phantom", "omitted")


def iter_verdicts(spec: Mapping[str, Any]) -> Iterator[tuple[str, str, Mapping[str, Any]]]:
    """``(check, where, verdict)`` for every verdict in one specimen."""
    for sheet, cols in (spec.get("values") or {}).items():
        for col, res in cols.items():
            for key, v in res.items():
                yield ("values" if key == "values" else "column_meta",
                       f"{sheet}.{col}" + ("" if key == "values" else f".{key}"), v)
    for v in spec.get("phantom_sheets") or []:
        yield "sheets", str(v.get("quantized")), v
    for v in spec.get("phantom_figures") or []:
        yield "figures", json.dumps(v.get("quantized")), v
    for layer in spec.get("layers") or []:
        li = f"L{layer['layer']}"
        for i, v in enumerate(layer["curves"]):
            yield "curves", f"{li}.c{i}", v
        for i, v in enumerate(layer["drawn"]):
            yield "drawn", f"{li}.c{i}", v
        for i, st in enumerate(layer["styles"]):
            for name, v in st.items():
                yield "styles", f"{li}.c{i}.{name}", v
        yield "plot_type", li, layer["plot_type"]
        for name, v in layer["axes"].items():
            yield "axes", f"{li}.{name}", v
        for i, v in enumerate(layer["error_bars"]):
            yield "error_bars", f"{li}.e{i}", v


def tally(spec: Mapping[str, Any]) -> dict[str, dict[str, int]]:
    out: dict[str, Counter[str]] = defaultdict(Counter)
    for check, _where, v in iter_verdicts(spec):
        out[check][v["status"]] += 1
    return {k: dict(c) for k, c in out.items()}


def _signature(check: str, v: Mapping[str, Any]) -> str:
    """A finding's class, so 40 specimens with one defect read as one row."""
    if check in ("curves", "drawn"):
        o, q = v.get("origin") or {}, v.get("quantized") or {}
        if v["status"] == "phantom":
            return "curve drawn that Origin does not plot (e.g. an X / error column as a Y)"
        if v.get("field") == "x" or (o.get("y") == q.get("y") and o.get("x") != q.get("x")):
            return "Y bound to the wrong X column"
        return "curve bound to the wrong Y column"
    if check == "values":
        return "cell values differ from the planted data"
    if check == "column_meta":
        return f"{v.get('origin')!r} imported as {v.get('quantized')!r}"
    if check == "plot_type":
        return f"{v.get('origin')} drawn as {v.get('quantized')}"
    if check == "sheets":
        return f"phantom sheet: {v.get('reason')}"
    if check == "figures":
        return "figure with no Origin layer"
    return f"{v.get('origin')!r} imported as {v.get('quantized')!r}"


def findings(
    specimens: Sequence[Mapping[str, Any]], statuses: tuple[str, ...] = ("wrong", "phantom")
) -> list[dict[str, Any]]:
    """Grouped findings: ``{check, status, signature, count, specimens, example}``."""
    groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    for spec in specimens:
        name = f"{spec['type']}/{spec['family']}"
        for check, where, v in iter_verdicts(spec):
            if v["status"] not in statuses:
                continue
            key = (check, v["status"], _signature(check, v))
            g = groups.setdefault(key, {"check": check, "status": v["status"], "signature": key[2],
                                        "count": 0, "specimens": [], "example": None})
            g["count"] += 1
            if name not in g["specimens"]:
                g["specimens"].append(name)
            if g["example"] is None:
                g["example"] = {"specimen": name, "where": where, **v}
    order = {c: i for i, c in enumerate(CHECKS)}
    return sorted(groups.values(), key=lambda g: (order.get(g["check"], 99), -g["count"]))


def _omission_reasons(specimens: Sequence[Mapping[str, Any]]) -> list[tuple[str, str, int, int]]:
    c: Counter[tuple[str, str]] = Counter()
    who: dict[tuple[str, str], set[str]] = defaultdict(set)
    for spec in specimens:
        for check, _w, v in iter_verdicts(spec):
            if v["status"] == "omitted":
                key = (check, str(v.get("reason")))
                c[key] += 1
                who[key].add(f"{spec['type']}/{spec['family']}")
    return [(k[0], k[1], n, len(who[k])) for k, n in c.most_common()]


def _cell(counts: Mapping[str, int]) -> str:
    if not counts:
        return "-"
    return "/".join(str(counts.get(s, 0)) for s in STATUSES)


def _list(names: Sequence[str], n: int = 6) -> str:
    return ", ".join(names[:n]) + (f" (+{len(names) - n})" if len(names) > n else "")


def to_markdown(specimens: Sequence[Mapping[str, Any]]) -> str:
    scored = [s for s in specimens if s.get("status") == "scored"]
    totals: dict[str, Counter[str]] = defaultdict(Counter)
    per_type: dict[str, dict[str, Counter[str]]] = defaultdict(lambda: defaultdict(Counter))
    for s in scored:
        for check, counts in tally(s).items():
            totals[check].update(counts)
            per_type[s["type"]][check].update(counts)
    lines = [
        "# Origin import scorecard (check 1)",
        "",
        f"{len(specimens)} specimens: {len(scored)} scored, "
        + ", ".join(f"{n} {st}" for st, n in Counter(
            s.get("status") for s in specimens if s.get("status") != "scored").items())
        + ". Cells read match/wrong/phantom/omitted.",
        "",
        "| check | match | wrong | phantom | omitted |",
        "|---|---|---|---|---|",
    ]
    for check in CHECKS:
        tot = totals.get(check, Counter())
        lines.append(f"| {check} | " + " | ".join(str(tot.get(s, 0)) for s in STATUSES) + " |")
    lines += ["", "## Wrong and phantom findings (listed first: worse than omitted)", ""]
    fs = findings(scored)
    if not fs:
        lines.append("None.")
    else:
        lines += ["| check | status | finding | count | specimens |", "|---|---|---|---|---|"]
        for g in fs:
            lines.append(
                f"| {g['check']} | {g['status']} | {g['signature']} | {g['count']} | "
                f"{len(g['specimens'])}: {_list(g['specimens'])} |"
            )
    lines += ["", "## Omission reasons", "", "| check | reason | items | specimens |",
              "|---|---|---|---|"]
    for check, reason, n, k in _omission_reasons(scored):
        lines.append(f"| {check} | {reason} | {n} | {k} |")
    lines += ["", "## Per plot type", "",
              "| type | n | " + " | ".join(CHECKS) + " |",
              "|---|---|" + "---|" * len(CHECKS)]
    n_type = Counter(s["type"] for s in scored)
    for ty in sorted(per_type):
        lines.append(f"| {ty} | {n_type[ty]} | "
                     + " | ".join(_cell(per_type[ty].get(c, {})) for c in CHECKS) + " |")
    lines += ["", "## Per type x family", "",
              "| type | family | figs | " + " | ".join(CHECKS) + " |",
              "|---|---|---|" + "---|" * len(CHECKS)]
    for s in sorted(specimens, key=lambda s: (s["type"], s["family"])):
        if s.get("status") != "scored":
            lines.append(f"| {s['type']} | {s['family']} | {s.get('status')}: "
                         f"{s.get('reason') or ''} |" + " |" * len(CHECKS))
            continue
        tal = tally(s)
        lines.append(f"| {s['type']} | {s['family']} | {s['n_figures']} | "
                     + " | ".join(_cell(tal.get(c, {})) for c in CHECKS) + " |")
    return "\n".join(lines) + "\n"


def write_reports(specimens: Sequence[Mapping[str, Any]], out: Path) -> tuple[Path, Path]:
    out.mkdir(parents=True, exist_ok=True)
    card = {
        "version": 1,
        "specimens": list(specimens),
        "tallies": {f"{s['type']}/{s['family']}": tally(s) for s in specimens
                    if s.get("status") == "scored"},
        "findings": findings([s for s in specimens if s.get("status") == "scored"]),
    }
    json_path = out / "scorecard.json"
    json_path.write_text(json.dumps(card, indent=1, default=float), encoding="utf-8")
    md_path = out / "scorecard.md"
    md_path.write_text(to_markdown(specimens), encoding="utf-8")
    return json_path, md_path
