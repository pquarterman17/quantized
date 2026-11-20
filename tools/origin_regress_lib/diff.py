"""Diff two snapshots and apply an "explained changes" allow-file."""

from __future__ import annotations

import fnmatch
import json
from collections import Counter
from pathlib import Path
from typing import Any, NamedTuple


class Change(NamedTuple):
    project: str
    kind: str
    detail: str


def _bkey(c: dict[str, Any]) -> tuple[Any, ...]:
    return (c.get("book"), c.get("sheet"), c.get("x"), c.get("y"))


def _label(c: dict[str, Any]) -> str:
    sheet = f"[{c['sheet']}]" if c.get("sheet") else ""
    return f"{c.get('book')}{sheet} X={c.get('x')} Y={c.get('y')}"


# curve attribute -> change kind (compared for curves whose binding matches)
_ATTR_KINDS = {
    "xRecorded": "x_recorded_changed",
    "plotType": "plot_type_changed",
    "style": "plot_type_changed",
    "symbol": "plot_type_changed",
    "color": "color_changed",
    "hidden": "hidden_changed",
}


def _pair_curves(
    base: list[dict[str, Any]], head: list[dict[str, Any]]
) -> tuple[list[tuple[dict[str, Any], dict[str, Any]]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Match exact bindings first, then leftover by (book, Y), then by order."""
    pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    pool: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    for h in head:
        pool.setdefault(_bkey(h), []).append(h)
    left_b: list[dict[str, Any]] = []
    for b in base:
        bucket = pool.get(_bkey(b))
        if bucket:
            pairs.append((b, bucket.pop(0)))
        else:
            left_b.append(b)
    left_h = [h for bucket in pool.values() for h in bucket]
    return pairs, left_b, left_h


def _diff_curves(proj: str, fig: str, base: list[Any], head: list[Any]) -> list[Change]:
    out: list[Change] = []
    pairs, lost, gained = _pair_curves(base, head)
    exact = not (lost or gained)
    # leftover with same (book, y) but different x/sheet = a changed binding
    for b in list(lost):
        for h in list(gained):
            if (b.get("book"), b.get("y")) == (h.get("book"), h.get("y")):
                out.append(Change(proj, "binding_changed", f"{fig}: {_label(b)} -> {_label(h)}"))
                lost.remove(b)
                gained.remove(h)
                break
    for b in lost:
        out.append(Change(proj, "curve_lost", f"{fig}: {_label(b)}"))
    for h in gained:
        out.append(Change(proj, "curve_gained", f"{fig}: {_label(h)}"))
    for b, h in pairs:
        for k in sorted(set(b) | set(h)):
            if k in ("book", "sheet", "x", "y"):
                continue
            if b.get(k) != h.get(k):
                kind = _ATTR_KINDS.get(k, "error_role_changed")
                out.append(
                    Change(proj, kind, f"{fig}: {_label(b)}: {k} {b.get(k)!r} -> {h.get(k)!r}")
                )
    # same curves in a different order is a (z-order / legend) change
    if exact and [_bkey(c) for c in base] != [_bkey(c) for c in head]:
        out.append(Change(proj, "curve_order_changed", f"{fig}: curve order differs"))
    return out


UNNAMED = "<unnamed>"
# Not "the same answer": the file was never fingerprinted. Two of these must
# never compare equal, or a slow file silently drops out of every check.
INCOMPLETE = ("timeout", "worker_died")


def _fig_keys(figs: list[dict[str, Any]]) -> dict[tuple[Any, ...], dict[str, Any]]:
    """Unique key per figure: (name, layer, nth occurrence of that pair).

    A missing/empty name becomes ``<unnamed>`` so unnamed figures pair up by
    order instead of colliding on ``None`` or being skipped.
    """
    seen: Counter[tuple[Any, Any]] = Counter()
    out: dict[tuple[Any, ...], dict[str, Any]] = {}
    for f in figs:
        base = (f.get("name") or UNNAMED, f.get("layer"))
        out[(*base, seen[base])] = f
        seen[base] += 1
    return out


def _fig_label(k: tuple[Any, ...]) -> str:
    return f"{k[0]}/L{k[1]}" + (f"#{k[2]}" if k[2] or k[0] == UNNAMED else "")


def _omit_map(f: dict[str, Any]) -> dict[tuple[Any, ...], list[str]]:
    """Omitted entries grouped by binding, each group a list (a multiset).

    Entries sharing a binding - or having none at all - stay separate list
    items rather than collapsing onto one dict key.
    """
    out: dict[tuple[Any, ...], list[str]] = {}
    for o in f.get("omitted", []):
        out.setdefault(_bkey(o), []).append(str(o.get("reason")) + _extra(o))
    return out


def _extra(o: dict[str, Any]) -> str:
    rest = {k: v for k, v in o.items() if k not in ("book", "sheet", "x", "y", "reason")}
    return f" {json.dumps(rest, sort_keys=True, default=str)}" if rest else ""


def _diff_omissions(proj: str, name: str, b: dict[str, Any], h: dict[str, Any]) -> list[Change]:
    out: list[Change] = []
    ob, oh = _omit_map(b), _omit_map(h)
    for k in sorted(set(ob) | set(oh), key=repr):
        lab = f"{name}: {k[0]} X={k[2]} Y={k[3]}"
        left, right = Counter(ob.get(k, [])), Counter(oh.get(k, []))
        lost = sorted((left - right).elements())
        gained = sorted((right - left).elements())
        for old, new in zip(lost, gained, strict=False):
            out.append(Change(proj, "omission_reason_changed", f"{lab}: {old} -> {new}"))
        for old in lost[len(gained) :]:
            out.append(Change(proj, "omission_removed", f"{lab} ({old})"))
        for new in gained[len(lost) :]:
            out.append(Change(proj, "omission_added", f"{lab} ({new})"))
    return out


def _diff_figure(proj: str, name: str, b: dict[str, Any], h: dict[str, Any]) -> list[Change]:
    out = _diff_curves(proj, name, b.get("curves", []), h.get("curves", []))
    for k in sorted(set(b.get("axes", {})) | set(h.get("axes", {}))):
        if b["axes"].get(k) != h["axes"].get(k):
            out.append(
                Change(
                    proj, "axis_changed", f"{name}: {k} {b['axes'].get(k)} -> {h['axes'].get(k)}"
                )
            )
    out += _diff_omissions(proj, name, b, h)
    if b.get("fid") != h.get("fid"):
        out.append(
            Change(proj, "fidelity_omissions_changed", f"{name}: {b.get('fid')} -> {h.get('fid')}")
        )
    return out


def diff_project(proj: str, b: dict[str, Any], h: dict[str, Any]) -> list[Change]:
    for side, fp in (("base", b), ("head", h)):
        if fp.get("error") in INCOMPLETE:
            return [
                Change(
                    proj,
                    "incomplete",
                    f"{side} snapshot has no fingerprint ({fp['error']}): cannot be compared",
                )
            ]
    if b.get("error") or h.get("error"):
        if b.get("error") != h.get("error"):
            return [
                Change(proj, "status_changed", f"error {b.get('error')!r} -> {h.get('error')!r}")
            ]
        return []
    out: list[Change] = []
    for k, kind in (
        ("status", "status_changed"),
        ("omissions", "project_omissions_changed"),
        ("total", "figure_count_changed"),
        ("actionable", "figure_count_changed"),
        ("filtered", "filtered_changed"),
        ("unrecovered", "unrecovered_changed"),
        ("embedded", "embedded_changed"),
    ):
        if b.get(k) != h.get(k):
            out.append(Change(proj, kind, f"{k}: {b.get(k)} -> {h.get(k)}"))
    bb = {x["id"]: x for x in b.get("books", [])}
    hb = {x["id"]: x for x in h.get("books", [])}
    for i in sorted(set(bb) | set(hb), key=str):
        if i not in hb:
            out.append(Change(proj, "book_lost", f"{i}"))
        elif i not in bb:
            out.append(Change(proj, "book_gained", f"{i}"))
        elif bb[i] != hb[i]:
            out.append(
                Change(
                    proj,
                    "book_changed",
                    f"{i}: rows {bb[i]['rows']}->{hb[i]['rows']} cols "
                    f"{bb[i]['cols']}->{hb[i]['cols']} labels {bb[i]['labels']}->{hb[i]['labels']}",
                )
            )
    fb, fh = _fig_keys(b.get("figures", [])), _fig_keys(h.get("figures", []))
    for k in fb.keys() - fh.keys():
        out.append(Change(proj, "figure_lost", f"{_fig_label(k)} ({len(fb[k]['curves'])} curves)"))
    for k in fh.keys() - fb.keys():
        out.append(
            Change(proj, "figure_gained", f"{_fig_label(k)} ({len(fh[k]['curves'])} curves)")
        )
    for k in sorted(fb.keys() & fh.keys(), key=repr):
        out += _diff_figure(proj, _fig_label(k), fb[k], fh[k])
    return out


def diff_snapshots(base: dict[str, Any], head: dict[str, Any]) -> list[Change]:
    bp, hp = base["projects"], head["projects"]
    out: list[Change] = []
    for proj in sorted(set(bp) | set(hp)):
        if proj not in hp:
            out.append(Change(proj, "project_lost", "present in base, absent in head"))
        elif proj not in bp:
            out.append(Change(proj, "project_gained", "absent in base, present in head"))
        else:
            out += diff_project(proj, bp[proj], hp[proj])
    return out


# ---- allow-file ----------------------------------------------------------


class AllowError(ValueError):
    pass


def load_allow(path: Path) -> list[dict[str, str]]:
    """``{"<project or glob>": [{"kind": "<kind or *>", "contains": "<optional
    substring of the detail>", "reason": "<why this change is correct>"}]}``.
    Every entry must carry a non-empty reason."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    rules: list[dict[str, str]] = []
    for proj, entries in raw.items():
        if not isinstance(entries, list):
            raise AllowError(f"{proj}: expected a list of entries")
        for e in entries:
            if not str(e.get("reason", "")).strip():
                raise AllowError(f"{proj}: every accepted change needs a non-empty 'reason'")
            rules.append(
                {
                    "project": proj,
                    "kind": e.get("kind", "*"),
                    "contains": e.get("contains", ""),
                    "reason": e["reason"],
                }
            )
    return rules


def _matches(rule: dict[str, str], c: Change) -> bool:
    return (
        fnmatch.fnmatchcase(c.project, rule["project"])
        and rule["kind"] in ("*", c.kind)
        and rule["contains"] in c.detail
    )


def apply_allow(
    changes: list[Change], rules: list[dict[str, str]]
) -> tuple[list[Change], list[tuple[Change, str]], list[dict[str, str]]]:
    """Return (unexplained, explained with reason, stale rules that matched nothing)."""
    used: set[int] = set()
    unexplained: list[Change] = []
    explained: list[tuple[Change, str]] = []
    for c in changes:
        hit = next((i for i, r in enumerate(rules) if _matches(r, c)), None)
        if hit is None:
            unexplained.append(c)
        else:
            used.add(hit)
            explained.append((c, rules[hit]["reason"]))
    stale = [r for i, r in enumerate(rules) if i not in used]
    return unexplained, explained, stale


def format_changes(changes: list[Change], *, limit: int = 0) -> str:
    """Per-project listing grouped by kind (``limit`` caps lines per kind)."""
    if not changes:
        return "no changes\n"
    by_proj: dict[str, dict[str, list[str]]] = {}
    for c in changes:
        by_proj.setdefault(c.project, {}).setdefault(c.kind, []).append(c.detail)
    lines: list[str] = []
    for proj in sorted(by_proj):
        lines.append(f"{proj}")
        for kind in sorted(by_proj[proj]):
            items = by_proj[proj][kind]
            lines.append(f"  {kind} ({len(items)})")
            shown = items if not limit else items[:limit]
            lines += [f"    - {d}" for d in shown]
            if len(shown) < len(items):
                lines.append(f"    ... {len(items) - len(shown)} more")
    kinds = Counter(c.kind for c in changes)
    lines.append("")
    lines.append(
        f"{len(changes)} change(s) in {len(by_proj)} project(s): "
        + ", ".join(f"{k}={n}" for k, n in sorted(kinds.items()))
    )
    return "\n".join(lines) + "\n"
