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
"""

from __future__ import annotations

import json
import math
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


@dataclass(frozen=True, slots=True)
class DataStruct:
    """Immutable, parser-agnostic dataset. Build via :meth:`create`."""

    time: NDArray[np.float64]
    values: NDArray[np.float64]
    labels: tuple[str, ...] = ()
    units: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)
    cat_levels: Mapping[int, tuple[str, ...]] | None = None

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
        return out

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> DataStruct:
        raw_cat_levels = payload.get("cat_levels")
        cat_levels = (
            {int(k): tuple(v) for k, v in raw_cat_levels.items()} if raw_cat_levels else None
        )
        return cls.create(
            time=payload["time"],
            values=payload["values"],
            labels=payload.get("labels"),
            units=payload.get("units"),
            metadata=payload.get("metadata"),
            cat_levels=cat_levels,
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
