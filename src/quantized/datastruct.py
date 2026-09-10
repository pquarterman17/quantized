"""The canonical data contract: ``DataStruct``.

Every parser returns one, and every consumer (corrections, fitting, plotting,
export) reads one. Mirrors the MATLAB ``parser.createDataStruct`` contract:

    time     (N,)    independent variable / x-axis
    values   (N, M)  data matrix — N samples, M channels
    labels   (M,)    channel names (deduplicated: 'A','A' -> 'A','A (2)')
    units    (M,)    channel units ('' when unknown)
    metadata         immutable mapping of import metadata
    cat_levels       optional channel index -> ordered level-string table
                     (P1.4 categorical contract, see below)

Pure layer — no fastapi/pydantic imports (enforced by test_repo_integrity).
The instance is frozen and its arrays are read-only, honouring the
"raw data is preserved, never mutated in place" rule: compute on copies.

CATEGORICAL CONTRACT (P1.4, PRIMARY_SOFTWARE_AUDIT_PLAN): a categorical
column is not a second data type bolted onto ``values`` -- it IS a numeric
channel (float codes ``0..n-1``, NaN = missing) PLUS a first-class ordered
level table (``cat_levels``: channel index -> a non-empty tuple of level
strings, ``levels[code]`` recovers the original string). ``cat_levels`` is
ADDITIVE: absent (``None``, the default) means pure numeric, and every
existing construction/serialization path is byte-identical to before this
field existed -- ``to_dict()`` omits the key entirely when it's ``None``, so
no golden fixture (whose DataStruct never carries one) can be affected.
Level ORDER is the tuple's own order; it is the ordinal ordering a caller
sees today (first-appearance order from import) and the axis JMP would
render is user-reorderable in a later slice -- the representation already
carries an order, it just isn't user-editable yet.

This satisfies JMP-parity's "string levels preserved, not numeric-coded"
bar (JMP_GAP_PLAN J1) AT THE CONTRACT LEVEL: the original strings are
preserved exactly, recodable (``level_of``/``level_labels`` below), and
render everywhere as labels -- the fact that internal STORAGE is a numeric
code is an implementation detail, not a representational loss, because the
mapping is lossless and invertible (``levels[code] == original string`` for
every cell) and the accessor layer below is the ONLY sanctioned read path:
consumers must call ``is_categorical``/``level_labels``/``level_of`` rather
than reach into ``cat_levels`` directly, so the day the storage scheme
changes (e.g. to native strings) only this module's accessors need to.

VALIDATION SCOPE (P1.4 review, P2-3/P3-1 ruling -- document + degrade,
NEVER throw): ``__post_init__`` validates ``cat_levels``' TABLE SHAPE only
-- every key is an in-range channel index, every value a non-empty tuple of
``str``. It deliberately does NOT cross-check CODE/LEVEL COHERENCE against
``values`` -- a cell's numeric code may be out of range, non-integer, or
NaN for its channel's level table (a downstream row-edit, a bad merge, or a
Recode step gone wrong could all produce one), and construction still
succeeds. Coherence degrades at READ time instead: ``level_of`` returns
``None`` for any code it cannot resolve rather than raising or returning
garbage, so a malformed cell degrades to "no label" for that one cell,
never crashes the caller. This mirrors the frontend's ``levelLabel``
(``lib/categorical.ts``), which applies the identical rule.
"""

from __future__ import annotations

import json
import math
import numbers
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

__all__ = ["DataStruct", "is_categorical", "level_labels", "level_of"]


def _deduplicate(labels: tuple[str, ...]) -> tuple[str, ...]:
    """Append ' (2)', ' (3)', ... to repeated labels (matches MATLAB)."""
    seen: dict[str, int] = {}
    out: list[str] = []
    for lbl in labels:
        if lbl in seen:
            seen[lbl] += 1
            out.append(f"{lbl} ({seen[lbl]})")
        else:
            seen[lbl] = 1
            out.append(lbl)
    return tuple(out)


def _normalize_cat_levels(
    cat_levels: Mapping[int, tuple[str, ...]] | None, n_channels: int
) -> Mapping[int, tuple[str, ...]] | None:
    """Validate + freeze ``cat_levels`` (P1.4): every key must be a real
    channel index and every value a non-empty tuple of ``str`` (the level
    table for a code-0..n-1 categorical channel). ``None`` in -> ``None``
    out, so a plain-numeric DataStruct never allocates one."""
    if cat_levels is None:
        return None
    normalized: dict[int, tuple[str, ...]] = {}
    for idx, levels in cat_levels.items():
        if not isinstance(idx, int) or isinstance(idx, bool) or not (0 <= idx < n_channels):
            raise ValueError(f"cat_levels channel index {idx!r} out of range [0, {n_channels})")
        levels_t = tuple(levels)
        if not levels_t or not all(isinstance(s, str) for s in levels_t):
            raise ValueError(f"cat_levels[{idx}] must be a non-empty tuple of str, got {levels!r}")
        normalized[idx] = levels_t
    return MappingProxyType(normalized)


def _level_code(code: Any) -> int | float | None:
    """One level CODE, normalized, or ``None`` if it is not a usable code.

    Accepts any FINITE REAL, not just ``int``, because that is what the
    frontend contract this field mirrors accepts: ``lib/categorical.ts``'s
    ``sanitizeLevelOrder`` keeps every ``Number.isFinite`` value and
    ``orderLevels`` matches them through a ``Set`` of plain numbers. Server-
    side grouping is equally float-tolerant — ``build_grouped_series`` groups
    by ANY channel and ``group_is_categorical`` only decides whether the level
    gets a LABEL — so an int-only rule here would silently drop a legitimate
    order for a group column whose distinct values are, say, ``{0.5, 1.5}``:
    the screen would show the user's order and the exported PDF ascending,
    which is the exact divergence `_ordered_levels` exists to prevent.

    ``Integral`` inputs normalize to ``int`` so the overwhelmingly common
    integer order still serializes as ``[1, 0]`` and not ``[1.0, 0.0]``; this
    is also what admits ``np.int64``, which ``isinstance(c, int)`` rejects and
    which any producer building an order from ``np.unique`` will hand us."""
    if isinstance(code, bool):
        return None
    if isinstance(code, numbers.Integral):
        return int(code)
    if isinstance(code, numbers.Real) and math.isfinite(float(code)):
        return float(code)
    return None


def _normalize_level_order(
    level_order: Mapping[int, tuple[float, ...]] | None, n_channels: int
) -> Mapping[int, tuple[float, ...]] | None:
    """Validate + freeze ``level_order`` (JMP_GAP J1): a channel index -> the
    level CODES in the user's chosen DISPLAY order. Purely presentational; the
    codes in ``values`` never move, which is the whole point of the design (a
    code is a level's IDENTITY, and it is referenced from places nothing can
    rewrite -- a computed column's formula text most sharply).

    Mirrors ``_normalize_cat_levels`` above, with ONE deliberate difference:
    ``-1`` is a legal key. That is the x/time column under the ``-1 = x,
    0.. = a value channel`` convention the frontend's ``ColumnFilter.col`` and
    ``lib/categorical.ts``'s ``categoryLevels`` both use, and the frontend does
    order a categorical x axis. Nothing here CONSUMES that entry -- server-side
    grouping is per value channel -- but rejecting it would make the API drop a
    preference the client legitimately holds."""
    if level_order is None:
        return None
    normalized: dict[int, tuple[float, ...]] = {}
    for idx, codes in level_order.items():
        if not isinstance(idx, int) or isinstance(idx, bool) or not (-1 <= idx < n_channels):
            raise ValueError(f"level_order channel index {idx!r} out of range [-1, {n_channels})")
        coded = tuple(_level_code(c) for c in codes)
        if not coded or any(c is None for c in coded):
            raise ValueError(
                f"level_order[{idx}] must be a non-empty tuple of finite numbers, got {codes!r}"
            )
        normalized[idx] = tuple(c for c in coded if c is not None)
    # An empty mapping becomes ABSENT, not a stale `{}` — `to_dict` and
    # `routes/_payload.py` both key their additive emission off `is not None`,
    # so returning `{}` here would emit `"level_order": {}` on the way out and
    # nothing on the way back, making the very first round trip lossy.
    return MappingProxyType(normalized) if normalized else None


def _parse_level_order_payload(raw: Any) -> dict[int, tuple[float, ...]] | None:
    """Parse the wire-format ``level_order`` payload -- the same UNTRUSTED
    boundary ``_parse_cat_levels_payload`` guards, and the same
    degrade-never-raise contract: a malformed entry is DROPPED so a corrupted
    body still constructs a ``DataStruct`` instead of 500ing.

    The two must agree on what they accept, or the pair raises: this parser is
    what feeds ``_normalize_level_order``, so anything it lets through and the
    normalizer rejects would raise from ``from_dict``. Hence unusable codes are
    filtered HERE, not merely validated there.

    KNOWN ASYMMETRY, not fixed here: ``_parse_cat_levels_payload`` does NOT
    filter its VALUES this way, so ``cat_levels {"0": []}`` or
    ``{"0": [1, 2]}`` still reaches the normalizer and raises. That surfaces
    as a descriptive 422 (``ValueError`` is in ``CALC_ERRORS``), not a 500, so
    it is a design question — is a malformed level table worth failing the
    request over? — rather than a bug, and it is not this field's to answer.
    Adopting the filter for ``level_order`` is safe because the field is new:
    nothing yet depends on its malformed payloads being rejected."""
    if not isinstance(raw, Mapping) or not raw:
        return None
    out: dict[int, tuple[float, ...]] = {}
    for k, v in raw.items():
        try:
            idx = int(k)
        except (TypeError, ValueError, OverflowError):
            # OverflowError is `int(float("inf"))`. Unreachable from JSON (its
            # object keys are strings) but NOT from the callers that hand
            # `from_dict` a plain Python dict — `plugins/loader.py`'s
            # `_wrap_read` and `client.py` — and unlike the other two it is
            # absent from `CALC_ERRORS`, so it would be a genuine 500.
            continue
        # `str`/`bytes` are not `list`/`tuple`, so the sequence check alone
        # already excludes them (a bare `tuple("abc")` splitting into
        # characters is the trap `_parse_cat_levels_payload` names).
        if not isinstance(v, (list, tuple)):
            continue
        codes = tuple(c for c in (_level_code(x) for x in v) if c is not None)
        # A mapping whose every code was junk collapses to nothing rather than
        # reaching the normalizer as an empty tuple, which it rejects.
        if codes:
            out[idx] = codes
    return out or None


def _parse_cat_levels_payload(raw: Any) -> dict[int, tuple[str, ...]] | None:
    """Parse the wire-format ``cat_levels`` payload (``DataStruct.from_dict``'s
    deserialization boundary -- P2-1, Sol's Day-6 audit).

    ``raw`` is UNTRUSTED (a request body, a hand-edited ``.dwk``): the prior
    one-liner (``{int(k): tuple(v) ...}``) assumed a clean
    ``{channel_index: [level, ...]}`` shape and blew up on anything else --
    a non-dict payload raised ``AttributeError`` (an uncaught 500 at the
    route boundary), a non-int key raised ``ValueError``, and a STRING value
    (``{"0": "abc"}``) didn't raise at all -- ``tuple("abc")`` silently split
    it into ``('a', 'b', 'c')``, a wrong-but-successful level table.

    Every per-entry check below degrades instead of raising -- a malformed
    entry is simply DROPPED, consistent with ``_normalize_cat_levels``'s
    documented "degrade, never raise" philosophy (see the module docstring's
    VALIDATION SCOPE section) -- so a corrupted payload still constructs a
    ``DataStruct`` (possibly with ``cat_levels=None``) rather than 500ing.
    Well-formed payloads round-trip identically to the old one-liner."""
    if not isinstance(raw, Mapping) or not raw:
        return None
    out: dict[int, tuple[str, ...]] = {}
    for k, v in raw.items():
        try:
            idx = int(k)
        except (TypeError, ValueError, OverflowError):  # see `_parse_level_order_payload`
            continue
        if isinstance(v, (str, bytes)) or not isinstance(v, (list, tuple)):
            continue
        out[idx] = tuple(v)
    return out or None


@dataclass(frozen=True, slots=True)
class DataStruct:
    """Immutable, parser-agnostic dataset. Build via :meth:`create`."""

    time: NDArray[np.float64]
    values: NDArray[np.float64]
    labels: tuple[str, ...] = ()
    units: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)
    cat_levels: Mapping[int, tuple[str, ...]] | None = None
    level_order: Mapping[int, tuple[float, ...]] | None = None

    def __post_init__(self) -> None:
        time = np.asarray(self.time, dtype=float).ravel()
        values = np.asarray(self.values, dtype=float)
        if values.ndim == 1:
            values = (
                values.reshape(-1, 1)
                if values.size
                else np.empty((time.shape[0], 0), dtype=float)
            )
        if values.ndim != 2:
            raise ValueError(f"values must be 2-D, got {values.ndim}-D")

        n = time.shape[0]
        if values.shape[0] != n:
            raise ValueError(
                f"time length ({n}) must equal values row count ({values.shape[0]})"
            )
        m = values.shape[1]

        labels = tuple(self.labels) if self.labels else tuple(f"ch{i + 1}" for i in range(m))
        units = tuple(self.units) if self.units else tuple("" for _ in range(m))
        if len(labels) != m:
            raise ValueError(f"expected {m} labels for {m} columns, got {len(labels)}")
        if len(units) != m:
            raise ValueError(f"expected {m} units for {m} columns, got {len(units)}")
        labels = _deduplicate(labels)

        time.flags.writeable = False
        values.flags.writeable = False

        object.__setattr__(self, "time", time)
        object.__setattr__(self, "values", values)
        object.__setattr__(self, "labels", labels)
        object.__setattr__(self, "units", units)
        object.__setattr__(self, "metadata", MappingProxyType(dict(self.metadata)))
        object.__setattr__(self, "cat_levels", _normalize_cat_levels(self.cat_levels, m))
        object.__setattr__(self, "level_order", _normalize_level_order(self.level_order, m))

    # ── Construction ──────────────────────────────────────────────────────
    @classmethod
    def create(
        cls,
        time: ArrayLike,
        values: ArrayLike,
        *,
        labels: Sequence[str] | None = None,
        units: Sequence[str] | None = None,
        metadata: Mapping[str, Any] | None = None,
        cat_levels: Mapping[int, tuple[str, ...]] | None = None,
        level_order: Mapping[int, tuple[float, ...]] | None = None,
    ) -> DataStruct:
        """Mirror of MATLAB ``createDataStruct``. Accepts array-likes.

        Raises ``ValueError`` for anything that is not coercible to a float
        array. ``np.asarray(..., dtype=float)`` raises ``TypeError`` for a
        non-numeric payload (a nested dict, say), which is NOT in the
        ``(ValueError, KeyError, IndexError)`` tuple every route that builds a
        DataStruct catches -- so a malformed ``dataset`` on the wire escaped as
        an unhandled HTTP 500 from ~17 handlers across 7 route modules. Every
        such route types the field as ``dict[str, Any]``, so pydantic does not
        filter it.

        Normalizing here rather than widening each route's except tuple is the
        class fix: this is the ONE constructor they all go through, so current
        and future callers are covered without touching a route file.
        """
        try:
            time_arr = np.asarray(time, dtype=float)
            values_arr = np.asarray(values, dtype=float)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"dataset time/values must be numeric arrays: {exc}") from exc
        return cls(
            time=time_arr,
            values=values_arr,
            labels=tuple(labels) if labels is not None else (),
            units=tuple(units) if units is not None else (),
            metadata=dict(metadata) if metadata is not None else {},
            cat_levels=cat_levels,
            level_order=level_order,
        )

    # ── Shape helpers ─────────────────────────────────────────────────────
    @property
    def n_points(self) -> int:
        return int(self.time.shape[0])

    @property
    def n_channels(self) -> int:
        return int(self.values.shape[1])

    def column(self, key: int | str) -> NDArray[np.float64]:
        """Return one channel's data (read-only) by index or label."""
        idx = key if isinstance(key, int) else self.labels.index(key)
        return self.values[:, idx]

    # ── Serialization (route boundary) ────────────────────────────────────
    # NOTE: JSON here is Python-round-trippable (NaN/Inf survive via the
    # stdlib json's non-standard tokens). The HTTP boundary (M1 #5) will map
    # non-finite floats to null for valid wire JSON — that's a routes concern.
    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "time": self.time.tolist(),
            "values": self.values.tolist(),
            "labels": list(self.labels),
            "units": list(self.units),
            "metadata": dict(self.metadata),
        }
        # ADDITIVE (P1.4): the key is only emitted when there IS a categorical
        # channel, so a pure-numeric DataStruct's to_dict() is byte-identical
        # to before this field existed -- no golden fixture is affected. JSON
        # object keys must be strings; from_dict below accepts either (a
        # direct Python round trip keeps int keys, a JSON round trip yields
        # str ones).
        if self.cat_levels is not None:
            out["cat_levels"] = {str(k): list(v) for k, v in self.cat_levels.items()}
        # ADDITIVE for the same reason (JMP_GAP J1): emitted only when a user
        # has actually chosen an order, so every existing golden fixture and
        # every plain-numeric payload is byte-identical to before.
        if self.level_order is not None:
            out["level_order"] = {str(k): list(v) for k, v in self.level_order.items()}
        return out

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> DataStruct:
        # An OUT-OF-RANGE channel index in either channel-keyed map reaches the
        # normalizer and RAISES — deliberately, and NOT a 500: `ValueError` is
        # in `routes/_errors.py`'s `CALC_ERRORS`, and every `from_dict` call
        # site in `routes/` sits inside an `except CALC_ERRORS` that turns it
        # into a 422 naming the offending index. Measured on
        # `POST /api/export/xrd-csv` with `cat_levels {"0": []}`: 422
        # "cat_levels[0] must be a non-empty tuple of str, got ()".
        #
        # An earlier draft of this commit filtered those entries out here on
        # the belief they 500'd. They do not, and the filter was strictly
        # worse: a descriptive 422 became a silent 200 whose response quietly
        # lacked the client's level table. It also could not compute the
        # channel count for a 1-D or ndarray `values` — both shapes
        # `__post_init__` accepts — so it dropped `cat_levels` that had round-
        # tripped fine for years (a plugin returning a numpy `values` via
        # `plugins/loader.py`'s `_wrap_read` is the live vector). Whether a
        # vestigial out-of-range entry deserves a 422 or a silent drop is a
        # real product question; it is not this commit's, and answering it by
        # accident cost real data.
        return cls.create(
            time=payload["time"],
            values=payload["values"],
            labels=payload.get("labels"),
            units=payload.get("units"),
            metadata=payload.get("metadata"),
            cat_levels=_parse_cat_levels_payload(payload.get("cat_levels")),
            level_order=_parse_level_order_payload(payload.get("level_order")),
        )

    def to_json(self) -> str:
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, text: str) -> DataStruct:
        return cls.from_dict(json.loads(text))


# ── P1.4 categorical accessors ──────────────────────────────────────────────
# The ONLY sanctioned read path for `cat_levels` (see the class docstring's
# CATEGORICAL CONTRACT). Every consumer -- calc/plotting, io importers, routes
# -- goes through these rather than indexing `ds.cat_levels` directly, so a
# future storage-scheme change is a one-module edit.


def _channel_index(ds: DataStruct, channel: int | str) -> int:
    return channel if isinstance(channel, int) else ds.labels.index(channel)


def is_categorical(ds: DataStruct, channel: int | str) -> bool:
    """Is `channel` a categorical channel (has a level table)?"""
    if ds.cat_levels is None:
        return False
    return _channel_index(ds, channel) in ds.cat_levels


def level_labels(ds: DataStruct, channel: int | str) -> tuple[str, ...]:
    """The ordered level strings for `channel`, or `()` when it isn't
    categorical. Order IS the levels' code order (``levels[code]``)."""
    if ds.cat_levels is None:
        return ()
    return ds.cat_levels.get(_channel_index(ds, channel), ())


def level_of(ds: DataStruct, channel: int | str, code: float) -> str | None:
    """The level string for one numeric `code` (a cell value from
    ``ds.values``), or ``None`` for a non-categorical channel, a non-finite
    code (NaN = missing), a non-integer code, or an out-of-range one --
    never raises, so a caller can pass a raw cell value with no pre-check."""
    levels = level_labels(ds, channel)
    if not levels or code is None or not math.isfinite(code):
        return None
    if not float(code).is_integer():
        return None
    idx = int(code)
    if not (0 <= idx < len(levels)):
        return None
    return levels[idx]
