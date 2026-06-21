"""CIF (Crystallographic Information File) parser. Port of calc.importCIF.

Returns a crystal-structure dict (not a DataStruct — a crystal structure is not a
time/value series), so this parser is standalone and NOT registered in the
DataStruct ``registry``. Pure io layer.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

__all__ = ["import_cif"]


def _comment_pos(line: str) -> int:
    """Index of the first '#' not inside a quoted string, or -1."""
    in_single = in_double = False
    for k, ch in enumerate(line):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double:
            return k
    return -1


def _strip_uncertainty(s: str) -> float:
    """'5.4309(2)' -> 5.4309, '3.905' -> 3.905, '?'/'.' -> NaN."""
    s = s.strip()
    if s in ("?", "."):
        return float("nan")
    s = re.sub(r"\([^)]*\)", "", s)
    try:
        return float(s)
    except ValueError:
        return float("nan")


def _extract_single_value(token: str) -> str:
    """Strip surrounding quotes; for unquoted, take the first whitespace token."""
    token = token.strip()
    if not token:
        return ""
    if token[0] == "'":
        idx = token.rfind("'")
        return token[1:idx] if idx > 0 else token[1:]
    if token[0] == '"':
        idx = token.rfind('"')
        return token[1:idx] if idx > 0 else token[1:]
    return token.split()[0]


def _read_semicolon_block(lines: list[str], i: int, n: int) -> tuple[str, int]:
    """Read a ';'-delimited multi-line text field. Returns (text, last_content_idx)."""
    i += 1
    parts: list[str] = []
    while i < n:
        if lines[i][:1] == ";":
            break
        parts.append(lines[i])
        i += 1
    return " ".join(parts).strip(), i - 1


def _parse_tag_value(lines: list[str], i: int, n: int) -> tuple[str, str, int]:
    """Parse a '_tag value' pair (value may be on the next line / a text block)."""
    m = re.match(r"^(\S+)\s*(.*)", lines[i].strip())
    if not m:
        return lines[i].strip(), "", i
    tag = m.group(1).strip().lower()
    value = m.group(2).strip()
    if not value:
        if i + 1 < n:
            next_line = lines[i + 1].strip()
            if next_line and next_line[0] == ";":
                value, i = _read_semicolon_block(lines, i + 1, n)
            else:
                i += 1
                line2 = lines[i].strip()
                cp = _comment_pos(line2)
                if cp >= 0:
                    line2 = line2[:cp].strip()
                value = _extract_single_value(line2)
    elif value[0] == ";":
        value, i = _read_semicolon_block(lines, i, n)
    else:
        value = _extract_single_value(value)
    return tag, value, i


def _tokenise_cif_line(line: str) -> list[str]:
    """Split a CIF data line into tokens, respecting single/double quotes."""
    tokens: list[str] = []
    n = len(line)
    k = 0
    while k < n:
        ch = line[k]
        if ch in (" ", "\t"):
            k += 1
            continue
        if ch in ("'", '"'):
            quote = ch
            k += 1
            start = k
            while k < n and line[k] != quote:
                k += 1
            tokens.append(line[start:k])
            k += 1
        else:
            start = k
            while k < n and line[k] not in (" ", "\t"):
                k += 1
            tokens.append(line[start:k])
    return tokens


def _parse_loop(lines: list[str], i: int, n: int) -> tuple[dict[str, Any], int]:
    """Parse a loop_ block: collect tag names then data tokens into rows."""
    loop_tags: list[str] = []
    while i < n:
        line = lines[i].strip()
        cp = _comment_pos(line)
        if cp >= 0:
            line = line[:cp].strip()
        if not line:
            i += 1
            continue
        if line[0] == "_":
            loop_tags.append(line.strip().lower())
            i += 1
        else:
            break

    n_cols = len(loop_tags)
    if n_cols == 0:
        return {"tags": [], "data": []}, i

    tokens: list[str] = []
    while i < n:
        line = lines[i]
        cp = _comment_pos(line)
        if cp >= 0:
            line = line[:cp]
        trimmed = line.strip()
        if not trimmed:
            i += 1
            continue
        first = trimmed.split()[0]
        if first.lower() in ("loop_", "save_") or first[:5].lower() == "data_":
            break
        if first[0] == "_":
            break
        if trimmed[0] == ";":
            block, i = _read_semicolon_block(lines, i, n)
            tokens.append(block)
            i += 1
            continue
        tokens.extend(_tokenise_cif_line(trimmed))
        i += 1

    n_rows = len(tokens) // n_cols
    data = [[tokens[r * n_cols + c] for c in range(n_cols)] for r in range(n_rows)]
    return {"tags": loop_tags, "data": data}, i


def _find_col(tags: list[str], name: str) -> int:
    return tags.index(name) if name in tags else -1


def _get_cell(row: list[str], col: int) -> str:
    return row[col] if 0 <= col < len(row) else ""


def _extract_atom_sites(loops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build the atom-site list from the first _atom_site_* loop."""
    for lp in loops:
        tags = lp["tags"]
        if not tags or not any(t.startswith("_atom_site_") for t in tags):
            continue
        col = {
            "label": _find_col(tags, "_atom_site_label"),
            "symbol": _find_col(tags, "_atom_site_type_symbol"),
            "x": _find_col(tags, "_atom_site_fract_x"),
            "y": _find_col(tags, "_atom_site_fract_y"),
            "z": _find_col(tags, "_atom_site_fract_z"),
            "occupancy": _find_col(tags, "_atom_site_occupancy"),
        }
        sites = []
        for row in lp["data"]:
            sites.append({
                "label": _get_cell(row, col["label"]),
                "symbol": _get_cell(row, col["symbol"]),
                "x": _strip_uncertainty(_get_cell(row, col["x"])),
                "y": _strip_uncertainty(_get_cell(row, col["y"])),
                "z": _strip_uncertainty(_get_cell(row, col["z"])),
                "occupancy": _strip_uncertainty(_get_cell(row, col["occupancy"])),
            })
        return sites
    return []


def import_cif(file_path: str | Path) -> dict[str, Any]:
    """Parse a CIF file into a crystal-structure dict. Port of calc.importCIF.

    Returns ``blockName``, ``tags`` (lowercased tag -> value string), ``loops``,
    ``cellParams`` (a/b/c/alpha/beta/gamma, NaN if absent), ``spaceGroup``,
    ``formula``, and ``atomSites`` (label/symbol/x/y/z/occupancy).
    """
    lines = Path(file_path).read_text(encoding="utf-8").splitlines()
    n = len(lines)
    result: dict[str, Any] = {
        "blockName": "",
        "tags": {},
        "loops": [],
        "cellParams": {k: float("nan") for k in ("a", "b", "c", "alpha", "beta", "gamma")},
        "spaceGroup": "",
        "formula": "",
        "atomSites": [],
    }
    tags: dict[str, str] = result["tags"]

    i = 0
    while i < n:
        raw = lines[i]
        cp = _comment_pos(raw)
        if cp >= 0:
            raw = raw[:cp]
        line = raw.strip()
        if not line or line[0] == "#":
            i += 1
            continue
        if line[:5].lower() == "data_":
            result["blockName"] = line[5:].strip()
            i += 1
            continue
        if line.lower() == "loop_":
            loop_struct, i = _parse_loop(lines, i + 1, n)
            result["loops"].append(loop_struct)
            continue
        if line[0] == "_":
            tag, value, i = _parse_tag_value(lines, i, n)
            tags[tag] = value
            i += 1
            continue
        i += 1

    cell_map = {
        "_cell_length_a": "a", "_cell_length_b": "b", "_cell_length_c": "c",
        "_cell_angle_alpha": "alpha", "_cell_angle_beta": "beta", "_cell_angle_gamma": "gamma",
    }
    for tag, field in cell_map.items():
        if tag in tags:
            result["cellParams"][field] = _strip_uncertainty(tags[tag])

    for sg in ("_symmetry_space_group_name_h-m", "_space_group_name_h-m_alt"):
        if sg in tags:
            result["spaceGroup"] = tags[sg].strip()
            break
    if "_chemical_formula_sum" in tags:
        result["formula"] = tags["_chemical_formula_sum"].strip()

    result["atomSites"] = _extract_atom_sites(result["loops"])
    return result
