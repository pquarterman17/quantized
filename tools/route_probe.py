"""Backend hardening probe: send edge-case bodies to every POST /api route.

The standing "backend hardening round" in BACKLOG.md hunts one class of bug:
a route that answers plausible bad input with an HTTP 500 instead of a 4xx
(a calc function raises something the route's narrow ``except`` does not
catch). Rounds 1-3 were reading audits; round 4 (2026-11-05) generated the
requests instead, and this is that probe, kept so the next round is one
command rather than a rebuild.

For every POST route under /api, the request body is built from the route's
own OpenAPI schema in several shapes (empty arrays, one row, zeros,
negatives, huge values), malformed datasets (ragged rows, row/time length
mismatch, wrong-typed fields, duplicate labels and X) in every field whose
schema is a DataStruct, and one "plausible" shape: values inside the
schema's bounds, 30-row non-constant arrays and datasets, and real names for
free-text vocabularies (model, crystal system, material...). Every response
>= 500 is reported.

Coverage limit, printed at the end: a route whose validation rejects every
generated body (a model name, an enum spelled as free text, a required
path) is never exercised past validation. Those routes are listed so a
later round can give them hand-written bodies.

Run (exit status 1 if any route returned a 5xx):
    uv run python tools/route_probe.py
    uv run python tools/route_probe.py --path-filter /api/stats --verbose
"""

from __future__ import annotations

import argparse
import collections
import sys
from typing import Any

from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.auth import TOKEN_HEADER

# Routes that act on the machine or the session rather than on a request
# body: shutting down, desktop dialogs, file writes, background jobs.
SKIP_PARTS = (
    "/shutdown",
    "/jobs",
    "/desktop",
    "/origin/send",
    "/export/file",
    "/open",
    "/save",
    "/autosave",
)

SHAPES = (
    "empty",
    "one",
    "zero",
    "neg",
    "big",
    "ragged",
    "mismatch",
    "strs",
    "dup",
    "plausible",
)

# Rows in a "plausible" array or dataset: enough for the fits and tests that
# need a minimum sample (hysteresis wants 20, regressions 5 per predictor).
PLAUSIBLE_ROWS = 30


def _ds(
    time: list[Any], values: list[Any], labels: list[Any], units: list[Any], metadata: Any
) -> dict[str, Any]:
    return {"time": time, "values": values, "labels": labels, "units": units, "metadata": metadata}


def _ramp(n: int, offset: float = 0.0) -> list[float]:
    """Increasing, non-constant, not perfectly linear values."""
    return [round(1.0 + offset + 0.5 * i + ((i * 7) % 5) * 0.3, 3) for i in range(n)]


DATASETS: dict[str, dict[str, Any]] = {
    "empty": _ds([], [], [], [], {}),
    "one": _ds([0.0], [[1.0]], ["a"], [""], {}),
    "zero": _ds([0.0, 0.0, 0.0], [[0.0], [0.0], [0.0]], ["a"], [""], {}),
    "neg": _ds([-1.0, -2.0, -3.0], [[-1.0], [-1.0], [-1.0]], ["a"], [""], {}),
    "big": _ds([0.0, 1.0, 2.0], [[1e300], [1e300], [1e300]], ["a"], [""], {}),
    "ragged": _ds([0.0, 1.0, 2.0], [[1.0, 2.0], [1.0], [1.0, 2.0]], ["a", "b"], ["", ""], {}),
    "mismatch": _ds([0.0, 1.0, 2.0], [[1.0], [2.0]], ["a", "b"], [""], {}),
    "strs": _ds(["a", "b"], [["x"], ["y"]], [1], [None], []),
    "dup": _ds([1.0, 1.0, 1.0, 2.0], [[1.0, 1.0]] * 4, ["a", "a"], ["", ""], {}),
    "plausible": _ds(
        [float(i) for i in range(PLAUSIBLE_ROWS)],
        [
            list(row)
            for row in zip(_ramp(PLAUSIBLE_ROWS), _ramp(PLAUSIBLE_ROWS, 3.0)[::-1], strict=True)
        ],
        ["a", "b"],
        ["", ""],
        {},
    ),
}

NUMBERS = {"empty": 0.0, "one": 0.0, "zero": 0.0, "neg": -1.0, "big": 1e300}
INTEGERS = {"empty": 0, "one": 0, "zero": 0, "neg": -1, "big": 10**9}

# Free-text fields whose valid values are a vocabulary the schema does not
# spell out as an enum. Used by the "plausible" shape only, so the other
# shapes keep sending garbage.
STRING_HINTS = {
    "model": "Linear",
    "system": "cubic",
    "crystal_system": "cubic",
    "material": "Si",
    "shape": "Sphere",
    "formula": "SiO2",
    "axis": "pixels",
    "quantity": "wavelength",
    "mode": "q_from_2theta",
    "name": "p1",
    "id": "item1",
}


# Many routes type a dataset as a free-form object (`dict[str, Any]`), so a
# field with one of these names and no declared properties is a dataset too.
DATASET_FIELDS = ("dataset", "data", "bg_dataset", "reference", "datasets", "source")


def _is_datastruct(schema: dict[str, Any], field: str) -> bool:
    props = schema.get("properties", {})
    if "time" in props and "values" in props:
        return True
    free_form = schema.get("type") == "object" and not props
    return free_form and field in DATASET_FIELDS


class BodyBuilder:
    """Builds a request body for one shape from an OpenAPI schema."""

    def __init__(self, components: dict[str, Any]) -> None:
        self.components = components

    def resolve(self, schema: dict[str, Any]) -> dict[str, Any]:
        while "$ref" in schema:
            schema = self.components[schema["$ref"].split("/")[-1]]
        return schema

    def build(self, schema: dict[str, Any], shape: str, depth: int = 0, field: str = "") -> Any:
        schema = self.resolve(schema)
        if depth > 6:
            return None
        for key in ("anyOf", "oneOf"):
            if key in schema:
                options = [
                    o for o in schema[key] if self.resolve(o).get("type") != "null"
                ] or schema[key]
                return self.build(options[0], shape, depth + 1, field)
        if "allOf" in schema:
            return self.build(schema["allOf"][0], shape, depth + 1, field)
        if "enum" in schema:
            return schema["enum"][0]
        if _is_datastruct(schema, field):
            # Only real dataset fields get the malformed dataset variants; a
            # plain `data: list[list[float]]` field is built like any array.
            return DATASETS[shape]
        kind = schema.get("type")
        if kind == "object" or "properties" in schema:
            props = schema.get("properties", {})
            required = schema.get("required", list(props))
            return {k: self.build(props[k], shape, depth + 1, k) for k in required if k in props}
        if kind == "array":
            return self._array(schema, shape, depth, field)
        if kind in ("number", "integer"):
            return self._number(schema, shape, kind == "integer")
        if kind == "string":
            if shape == "plausible":
                return STRING_HINTS.get(field, "x")
            return "" if shape in ("empty", "zero") else "x"
        if kind == "boolean":
            return False
        return None

    def _array(self, schema: dict[str, Any], shape: str, depth: int, field: str) -> Any:
        if "prefixItems" in schema:  # a tuple: exactly its listed items
            return [self.build(item, shape, depth + 1, field) for item in schema["prefixItems"]]
        if shape == "empty":
            return []
        count = {"one": 1, "dup": 4, "plausible": PLAUSIBLE_ROWS}.get(shape, 3)
        count = max(schema.get("minItems", 0), min(count, schema.get("maxItems", count)))
        items = self.resolve(schema.get("items", {}))
        if shape == "plausible" and items.get("type") == "number":
            return _ramp(count)
        item = self.build(items, shape, depth + 1, field)
        return [item] * count

    def _number(self, schema: dict[str, Any], shape: str, integer: bool) -> float | int:
        if shape != "plausible":
            return INTEGERS.get(shape, 1) if integer else NUMBERS.get(shape, 1.0)
        # Inside the schema's bounds, so validation lets it through.
        low = schema.get("minimum", schema.get("exclusiveMinimum"))
        high = schema.get("maximum", schema.get("exclusiveMaximum"))
        value = 2.0
        if high is not None and value >= high:
            value = (high + low) / 2 if low is not None else high - 1
        if low is not None and value <= low:
            value = (low + high) / 2 if high is not None else low + 1
        return max(int(value), int(low or 0) + 1) if integer else value

    def body(self, schema: dict[str, Any], shape: str) -> Any:
        return self.build(schema, shape)


def post_routes(spec: dict[str, Any], path_filter: str) -> list[tuple[str, dict[str, Any]]]:
    """POST routes under /api with a JSON body, minus the SKIP_PARTS ones."""
    routes = []
    for path, ops in spec["paths"].items():
        post = ops.get("post")
        if post is None or "{" in path or not path.startswith(path_filter):
            continue
        if any(part in path for part in SKIP_PARTS):
            continue
        schema = (
            post.get("requestBody", {}).get("content", {}).get("application/json", {}).get("schema")
        )
        if schema:
            routes.append((path, schema))
    return routes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--path-filter", default="/api", help="only probe routes starting with this prefix"
    )
    parser.add_argument(
        "--verbose", action="store_true", help="also list routes never exercised past validation"
    )
    args = parser.parse_args(argv)

    app = create_app()
    # 127.0.0.1 passes the Host guard; the token passes the API guard.
    client = TestClient(app, raise_server_exceptions=False, base_url="http://127.0.0.1")
    client.headers[TOKEN_HEADER] = app.state.api_token
    spec = app.openapi()
    builder = BodyBuilder(spec.get("components", {}).get("schemas", {}))

    statuses: collections.Counter[int] = collections.Counter()
    failures: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    reached: set[str] = set()
    routes = post_routes(spec, args.path_filter)
    for path, schema in routes:
        for shape in SHAPES:
            response = client.post(path, json=builder.body(schema, shape))
            statuses[response.status_code] += 1
            if response.status_code < 300:
                reached.add(path)
            if response.status_code >= 500:
                failures[path].append((shape, response.text[:160]))

    total = sum(statuses.values())
    print(
        f"{len(routes)} routes, {total} requests, status counts: {dict(sorted(statuses.items()))}"
    )
    print(f"{len(reached)} of {len(routes)} routes returned a 2xx for at least one shape")
    if args.verbose:
        for path, _ in routes:
            if path not in reached:
                print(f"  never past validation: {path}")
    for path, hits in sorted(failures.items()):
        shapes = ", ".join(shape for shape, _ in hits)
        print(f"5xx {path} [{shapes}]: {hits[0][1]}")
    print(f"{len(failures)} route(s) answered with a 5xx")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
