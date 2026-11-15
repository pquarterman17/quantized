"""Plan item 3: score a figure quantized built FROM SCRATCH against Origin's oracle.

Pure (no server, no Origin). Inputs: the specimen context from
``scratch_run.prepare`` (family, ``oracle.json``, column map), the export
request the recipe harness built, and what the render route reported (status
and, for an XY figure, the hitmap's drawn axis limits).

Checks, each ``ok`` / ``wrong`` / ``n/a`` with a reason:

* ``type``    the quantized renderer's plot type == the corpus type
              (``scratch_recipes.QZ_KIND`` folds the map types)
* ``curves``  the set of Y columns quantized plots == the ones Origin plotted
              (error-bar companions 231/233 excluded; matched by long name)
* ``binding`` each curve's X column (XY routes) / the axis order (ternary) /
              the curve's layer (double-Y)
* ``values``  every plotted value == the family's planted value (masked rows
              removed, as Origin removes them); a stat/bar figure compares the
              values it was handed, a map the regridded z extent
* ``axes``    log/linear per axis, and (XY only) the drawn range against
              Origin's, each end within 5 % of the span
* ``styles``  the colour / width / dash / symbol the corpus set on Origin's
              curves reached the export request

A specimen ``match``es when it was built and type, curves, binding and
values are all ok; axes and styles are reported but do not decide it (Origin
pads ranges to its own tick rule, quantized to matplotlib's).
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Any

from scratch_data import ORIGIN_COLORS, origin_day_to_unix
from scratch_recipes import QZ_KIND

__all__ = ["CORE_CHECKS", "origin_curves", "qz_type", "score_specimen"]

CORE_CHECKS = ("type", "curves", "binding", "values")
_ERROR_TYPES = {231, 233}
_REF = re.compile(r"!([^\"!]+)\"")


def _check(ok: bool | None, why: str = "") -> dict[str, Any]:
    state = "n/a" if ok is None else ("ok" if ok else "wrong")
    return {"state": state, "why": why}


def origin_curves(oracle: dict[str, Any]) -> list[dict[str, Any]]:
    """Origin's data curves: layer, read-back type, Y and X column short names."""
    out = []
    for lay in oracle["graph"]["layers"]:
        for p in lay["plots"]:
            if p["plot_type"] in _ERROR_TYPES:
                continue
            m = _REF.search(p["ref"])
            y = m.group(1) if m else p["ref"]
            xs = str(p.get("x_dataset") or "")
            x = xs.rsplit("_", 1)[-1] if "_" in xs else None
            out.append({"layer": lay["index"], "type": p["plot_type"], "y": y, "x": x})
    return out


def qz_type(route: str, spec: dict[str, Any]) -> str:
    """The plot type quantized's renderer draws for this request."""
    if route == "statplot":
        return str(spec.get("kind"))
    if route == "categorical":
        return "stacked_column" if spec.get("stacked") else "column"
    if route == "map":
        return "contour" if spec.get("kind") in ("contour", "contourf") else "heatmap"
    if route == "ternary":
        return "ternary"
    if spec.get("polar") is not None:
        return "polar"
    if spec.get("y2_keys"):
        return "double_y"
    if any(v for v in spec.get("waterfall_offsets") or []):
        return "stacked_lines_offset"
    styles = [s or {} for s in spec.get("series_styles") or []] or [{}]
    s0 = styles[0]
    if s0.get("bars"):
        return "bar" if s0["bars"] == "horizontal" else "column"
    if s0.get("size_by") is not None:
        return "bubble"
    if s0.get("color_by") is not None:
        return "color_mapped"
    if s0.get("step"):
        return "step_horizontal"
    if s0.get("fill") == "under":
        return "area"
    scatter = s0.get("line") == "none" or s0.get("width") == 0
    if scatter and s0.get("marker"):
        return "scatter"  # error bars are scored under binding, as Origin adds them
    if s0.get("marker"):
        return "line_symbol"
    return "line"


def _close(a: Sequence[Any], b: Sequence[Any], rtol: float = 1e-9) -> bool:
    if len(a) != len(b):
        return False
    for u, v in zip(a, b, strict=True):
        fu = math.nan if u is None else float(u)
        fv = math.nan if v is None else float(v)
        if math.isnan(fu) and math.isnan(fv):
            continue
        if math.isnan(fu) or math.isnan(fv):
            return False
        if abs(fu - fv) > rtol * max(1.0, abs(fu), abs(fv)):
            return False
    return True


def _family_values(col: dict[str, Any], masked: set[int]) -> list[Any]:
    vals = col["values"] if col.get("text") is None else list(range(len(col["text"])))
    out = [v for i, v in enumerate(vals) if i not in masked]
    if col["fmt"] == "date":
        out = [None if v is None else origin_day_to_unix(v) for v in out]
    return out


def _finite(vals: Sequence[Any]) -> list[float]:
    return [float(v) for v in vals if v is not None and math.isfinite(float(v))]


def _masked(c: dict[str, Any]) -> set[int]:
    fam = c["fam"]
    if not fam["books"]:
        return set()
    rows: set[int] = set()
    for rr in fam["books"][0]["sheets"][0].get("masked_rows", {}).values():
        rows.update(int(r) for r in rr)
    return rows


def _by_short(c: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {col["short"]: col for col in c["columns"]}


# ── per-route extraction: (curve names, {name: values}, {name: x name}) ──────


def _figure_curves(spec: dict[str, Any]) -> tuple[list[str], dict[str, list[tuple[Any, Any]]]]:
    """Each plotted curve's drawn ``(x, y)`` points (rows with a finite y).

    Read off the request's own dataset: a per-series-X sheet arrives as
    concatenated X blocks (``lib/figureSpecPerSeriesX``), so the points, not a
    column name, say which X a curve sits on."""
    ds = spec.get("dataset") or {}
    labels = ds.get("labels") or []
    rows = ds.get("values") or []
    xk = spec.get("x_key")
    xcol = [r[xk] for r in rows] if isinstance(xk, int) else list(ds.get("time") or [])
    names, pts = [], {}
    for k in spec.get("y_keys") or []:
        if not isinstance(k, int) or k >= len(labels):
            continue
        names.append(labels[k])
        pts[labels[k]] = [(x, r[k]) for x, r in zip(xcol, rows, strict=False) if _finite([r[k]])]
    return names, pts


def _planted_points(
    ycol: dict[str, Any], xcol: dict[str, Any] | None, masked: set[int]
) -> list[tuple[Any, Any]]:
    ys = _family_values(ycol, set())
    xs = _family_values(xcol, set()) if xcol else list(range(len(ys)))
    return [
        (x, y)
        for i, (x, y) in enumerate(zip(xs, ys, strict=False))
        if i not in masked and _finite([y])
    ]


def _stat_curves(spec: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    if spec.get("kind") == "histogram":
        # One value column; its name rides the axis label.
        return [str(spec.get("x_label", ""))], {
            str(spec.get("x_label", "")): spec.get("data") or []
        }
    labels = [str(x) for x in spec.get("labels") or []]
    return labels, dict(zip(labels, spec.get("data") or [], strict=False))


def score_specimen(
    c: dict[str, Any], built: dict[str, Any] | None, rinfo: dict[str, Any]
) -> dict[str, Any]:
    ptype, fam = c["type"], c["family"]
    row: dict[str, Any] = {
        "key": f"{ptype}/{fam}",
        "type": ptype,
        "family": fam,
        "recipe": c["recipe"].get("steps"),
        "note": c["recipe"].get("note"),
    }
    if "missing" in c["recipe"]:
        return {
            **row,
            "built": "unbuildable",
            "verdict": "unbuildable",
            "why": c["recipe"]["missing"],
            "checks": {},
        }
    if not built or built.get("error") or built.get("spec") is None:
        why = (built or {}).get("error") or "the recipe produced no export request"
        return {**row, "built": "failed", "verdict": "not built", "why": why, "checks": {}}
    route, spec = built["route"], built["spec"]
    row["route"] = route
    row["render"] = rinfo.get("status")
    checks: dict[str, dict[str, Any]] = {}

    want_type = QZ_KIND.get(ptype, ptype)
    got_type = qz_type(route, spec)
    row["qz_type"] = got_type
    checks["type"] = _check(
        got_type == want_type, f"quantized draws {got_type}, Origin {want_type}"
    )

    o_curves = origin_curves(c["oracle"])
    cols = _by_short(c)
    o_names = [cols[cv["y"]]["long"] if cv["y"] in cols else cv["y"] for cv in o_curves]
    masked = _masked(c)

    vals: dict[str, Any] = {}
    pts: dict[str, list[tuple[Any, Any]]] = {}
    if route == "figure":
        names, pts = _figure_curves(spec)
    elif route == "statplot":
        names, vals = _stat_curves(spec)
    elif route == "categorical":
        names = [str(s) for s in spec.get("series") or []]
        mat = spec.get("values") or []
        vals = {n: [r[j] for r in mat] for j, n in enumerate(names)}
    elif route == "map":
        names = [str(spec.get("z_label", "")).split(" (")[0]]
    else:  # ternary
        names = [str(x) for x in spec.get("labels") or []]
        rows3 = spec.get("data") or []
        vals = {n: [r[i] for r in rows3] for i, n in enumerate(names)}
    row["qz_curves"], row["origin_curves"] = names, o_names

    # curves -----------------------------------------------------------------
    if ptype == "ternary":
        want = sorted(col["long"] for col in c["columns"])
        checks["curves"] = _check(sorted(names) == want, f"quantized {names}, Origin {want}")
    elif route == "map":
        want_z = [col["long"] for col in c["columns"] if col["designation"] == "Z"]
        checks["curves"] = _check(names == want_z, f"quantized z {names}, Origin z {want_z}")
    else:
        checks["curves"] = _check(
            sorted(names) == sorted(o_names), f"quantized {names}, Origin {o_names}"
        )

    # binding ----------------------------------------------------------------
    if ptype == "ternary":
        order = [col["long"] for col in c["columns"]]
        checks["binding"] = _check(names == order, f"axis order quantized {names}, Origin {order}")
    elif route == "figure":
        bad = []
        for cv, on in zip(o_curves, o_names, strict=True):
            if on not in pts or cv["y"] not in cols:
                continue
            want_x = cols.get(cv["x"] or "")
            planted = _planted_points(cols[cv["y"]], want_x, masked)
            got_x, planted_x = [p[0] for p in pts[on]], [p[0] for p in planted]
            if len(got_x) == len(planted_x) and not _close(got_x, planted_x):
                bad.append(f"{on}: not drawn against X column {want_x['long'] if want_x else '?'}")
        # Error bars Origin added for the Y-/X-error columns (231/233).
        o_err = {
            t
            for lay in c["oracle"]["graph"]["layers"]
            for t in (p["plot_type"] for p in lay["plots"])
            if t in _ERROR_TYPES
        }
        spans = [s for s in spec.get("error_spans") or [] if s]
        q_err = {231 for s in spans if s.get("y")} | {233 for s in spans if s.get("x")}
        if o_err != q_err:
            bad.append(f"error bars quantized {sorted(q_err)}, Origin {sorted(o_err)}")
        if ptype == "double_y":
            y2 = [
                names[i]
                for i, k in enumerate(spec.get("y_keys") or [])
                if k in (spec.get("y2_keys") or [])
            ]
            o_y2 = [on for cv, on in zip(o_curves, o_names, strict=True) if cv["layer"] == 1]
            if sorted(y2) != sorted(o_y2):
                bad.append(f"right axis quantized {y2}, Origin {o_y2}")
        checks["binding"] = _check(not bad, "; ".join(bad))
    else:
        checks["binding"] = _check(None, "no per-curve X on this route")

    # values -----------------------------------------------------------------
    by_long = {col["long"]: col for col in c["columns"]}
    if route == "map":
        z = _finite(v for r in spec.get("z_grid") or [] for v in r)
        src = _finite(by_long[names[0]]["values"]) if names and names[0] in by_long else []
        if z and src:
            span = max(src) - min(src)
            ok = abs(min(z) - min(src)) <= 0.05 * span and abs(max(z) - max(src)) <= 0.05 * span
            checks["values"] = _check(
                ok,
                f"regridded z [{min(z):.4g}, {max(z):.4g}] vs data "
                f"[{min(src):.4g}, {max(src):.4g}]",
            )
        else:
            checks["values"] = _check(False, "no finite z")
    else:
        bad = []
        for n in names:
            if n not in by_long or (n not in vals and n not in pts):
                continue
            want_v = _family_values(by_long[n], masked)
            if route == "figure":
                got_v = [p[1] for p in pts[n]]
                want_v = _finite(want_v)
            else:
                got_v = vals[n]
            if route == "figure" or route == "ternary":
                ok = _close(got_v, want_v)
            elif route == "categorical":
                ok = _close(got_v, want_v)  # Origin draws one bar per ROW
            else:  # statplot: the distribution of the column's finite values
                ok = _close(sorted(_finite(got_v)), sorted(_finite(want_v)))
            if not ok:
                bad.append(
                    f"{n}: {len(_finite(got_v))} values vs {len(_finite(want_v))} planted"
                    + ("" if len(got_v) != len(want_v) else " (same count, different values)")
                )
        checks["values"] = _check(not bad, "; ".join(bad))

    # axes -------------------------------------------------------------------
    lay0 = c["oracle"]["graph"]["layers"][0]["axes"]
    o_log = {a: lay0.get(a, {}).get("type") == 2.0 for a in ("x", "y")}
    axes = rinfo.get("axes") or {}
    notes = []
    if route == "figure" and axes:
        q_log = {"x": axes.get("xscale") == "log", "y": axes.get("yscale") == "log"}
        for a in ("x", "y"):
            if q_log[a] != o_log[a]:
                notes.append(
                    f"{a} scale {'log' if q_log[a] else 'linear'} vs Origin "
                    f"{'log' if o_log[a] else 'linear'}"
                )
            lim = axes.get(f"{a}lim")
            o_from, o_to = lay0.get(a, {}).get("from"), lay0.get(a, {}).get("to")
            if a == "x" and c["columns"][0]["fmt"] == "date" and o_from is not None:
                o_from, o_to = origin_day_to_unix(o_from), origin_day_to_unix(o_to)
            if lim and o_from is not None and o_to is not None and not q_log[a]:
                span = abs(o_to - o_from) or 1.0
                lo, hi = sorted(lim)
                olo, ohi = sorted((o_from, o_to))
                if abs(lo - olo) > 0.05 * span or abs(hi - ohi) > 0.05 * span:
                    notes.append(f"{a} range [{lo:.4g}, {hi:.4g}] vs Origin [{olo:.4g}, {ohi:.4g}]")
        checks["axes"] = _check(not notes, "; ".join(notes))
    elif any(o_log.values()):
        checks["axes"] = _check(False, "Origin axis is log; this route has no log axis")
    else:
        checks["axes"] = _check(None, "range not reported by this route")

    # styles -----------------------------------------------------------------
    req = c["oracle"].get("requested_styles") or []
    if req and route == "figure":
        wire = spec.get("series_styles") or []
        bad = []
        # The corpus styles layer 1's plots in order, error-bar companions
        # included; only the data curves have a series style to compare.
        plots0 = c["oracle"]["graph"]["layers"][0]["plots"]
        data_req = [
            st for st, p in zip(req, plots0, strict=False) if p["plot_type"] not in _ERROR_TYPES
        ]
        for i, st in enumerate(data_req):
            w = (wire[i] if i < len(wire) else None) or {}
            if "c" in st and str(w.get("color", "")).lower() != ORIGIN_COLORS.get(
                int(st["c"]), "?"
            ):
                bad.append(f"curve {i + 1} colour {w.get('color')}")
            if "d" in st and w.get("line", "solid") != ("solid", "dashed", "dotted")[int(st["d"])]:
                bad.append(f"curve {i + 1} dash {w.get('line', 'solid')}")
            if (
                "w" in st
                and w.get("width") not in (None, 0)
                and abs(float(w["width"]) - st["w"] / 500) > 1e-6
            ):
                bad.append(f"curve {i + 1} width {w.get('width')}")
            if "k" in st and w.get("marker") and w.get("marker_shape") is None:
                bad.append(f"curve {i + 1} symbol shape not sent")
        checks["styles"] = _check(not bad, "; ".join(bad))
    elif req:
        checks["styles"] = _check(False, f"{route} requests carry no per-curve style")
    else:
        checks["styles"] = _check(None, "Origin type not styled by the corpus")

    row["checks"] = checks
    failed = [k for k in CORE_CHECKS if checks.get(k, {}).get("state") == "wrong"]
    if rinfo.get("status") != 200:
        failed.append("render")
        checks["render"] = _check(False, str(rinfo.get("detail", ""))[:200])
    row["built"] = "built"
    row["verdict"] = "match" if not failed else "mismatch"
    row["why"] = "; ".join(f"{k}: {checks[k]['why']}" for k in failed)
    return row
