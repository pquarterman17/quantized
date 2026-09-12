"""Row-decimated preview ``DataStruct`` for the lazy per-book import transport
(``ORIGIN_FILE_DECODE_PLAN`` #38).

Mirrors the frontend's min/max-per-bucket envelope-preserving downsample
(``frontend/src/lib/downsample.ts``, used for Library sparklines) but picks
whole ROWS -- every channel moves together -- instead of decimating one
channel's points independently. The result is a genuine (just smaller)
``DataStruct``: any consumer that only reads ``.time``/``.values``/``.labels``/
``.units``/``.metadata`` keeps working on it unchanged, which is the whole
point of the "pending dataset carries a real but preview-sized `data`" design
(see ``routes/parsers.py``'s ``_book_preview_payload``).

Pure layer -- no fastapi/pydantic imports (enforced by test_repo_integrity).
"""

from __future__ import annotations

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["decimate_datastruct", "decimate_with_alignment"]


def _trim_trailing_padding(ds: DataStruct) -> DataStruct:
    """Drop trailing rows that carry no real data, mirroring the frontend's
    ``dropTrailingEmptyRows`` (``frontend/src/lib/plotdata.ts``). Origin's
    over-allocated worksheet storage leaves "allocated but unfilled" rows at
    the END of a book (verified byte-for-byte across ~10 PNR-corpus books,
    e.g. Book15: 19 of 180 rows), in two shapes:

      - not plottable at all -- ``.time`` is non-finite, or (when there are
        value channels) every value in the row is also non-finite, or
      - over-allocated-storage padding -- ``.time`` AND every value in the
        row read exactly finite ``0.0`` simultaneously. This is a "point", not
        a gap, so the rule above doesn't catch it, and left in, it resets the
        independent axis back to 0 at the tail (breaking x-ascending) and
        collapses a sparkline/preview built from the raw row order.

    Only trims a contiguous run off the END; interior gaps are left in place.
    Returns ``ds`` unchanged (same object) when there is no prunable tail.
    """
    n = ds.n_points
    if n == 0:
        return ds
    time = ds.time
    values = ds.values
    has_y = ds.n_channels > 0

    def plottable(i: int) -> bool:
        if not np.isfinite(time[i]):
            return False
        if not has_y:
            return True
        return bool(np.any(np.isfinite(values[i, :])))

    def all_zero_row(i: int) -> bool:
        if not has_y:
            return False
        if time[i] != 0:
            return False
        return bool(np.all(values[i, :] == 0))

    end = n
    while end > 0 and (not plottable(end - 1) or all_zero_row(end - 1)):
        end -= 1
    if end == n:
        return ds
    return DataStruct(
        time=ds.time[:end],
        values=ds.values[:end, :],
        labels=ds.labels,
        units=ds.units,
        metadata=ds.metadata,
    )


def decimate_datastruct(ds: DataStruct, target_points: int = 200) -> DataStruct:
    """Row-decimate ``ds`` to about ``target_points`` rows.

    First prunes a trailing "allocated but unfilled" padding run (see
    :func:`_trim_trailing_padding`) so a pending dataset's preview never
    carries the padding into the thumbnail -- the fix for a preview whose
    sparkline collapsed toward (0, 0) instead of tracing the real curve.

    Then buckets the (pruned) row range into ``target_points // 2``
    contiguous spans and keeps, from each span, the row holding the MINIMUM
    and the row holding the MAXIMUM value of the densest channel (most finite
    values) -- so a sparkline built from the result still shows real
    spikes/dips a plain stride sample would step over. Every retained row
    keeps ALL of its channels (they were picked together), so the output is a
    normal, if smaller, ``DataStruct``.

    Returns the (possibly padding-trimmed) ``ds`` unchanged when it already
    has at most ``target_points`` rows or has no channels at all (an
    empty-data pseudo-book -- nothing to pick extrema from, and nothing to
    save by decimating zero columns).
    """
    return _decimate(ds, target_points)[0]


def decimate_with_alignment(
    ds: DataStruct, target_points: int = 200
) -> tuple[DataStruct, list[int] | None]:
    """:func:`decimate_datastruct`, plus HOW the result's rows map to the source.

    ``(preview, source_rows)``. ``source_rows`` is ``None`` when output row ``r``
    IS source row ``r`` -- an untouched or merely padding-trimmed preview, a
    strict prefix. It is the list of kept source indices, in output order, only
    when the bucketed min/max pick below actually ran.

    Exists because only this module can answer that, and a consumer holding just
    the two DataStructs cannot infer it: BOTH the padding trim and the sampling
    shorten the data, and only the sampling breaks row correspondence. A row-count
    comparison therefore cannot tell them apart -- which is exactly the bug it
    caused. The frontend's ``worksheet/textColumns.ts`` gated on
    ``pending.rows > data.time.length`` and blanked a book's text columns whenever
    :func:`_trim_trailing_padding` had removed ANY over-allocated row
    (corpus-attested: Book15 drops 19 of 180), even though a trimmed preview is a
    strict PREFIX whose sidecar cells line up exactly.

    USED TO RETURN A BOOL (``sampled``), which was only ever "is there a mapping?"
    -- so it now returns the mapping and lets the caller derive the bool. The
    sampler already had these indices and threw them away, which is what made a
    SAMPLED preview's row-indexed sidecars unreadable rather than merely
    reordered: with the map, cell ``r`` is ``sidecar[source_rows[r]]``, exactly.
    """
    return _decimate(ds, target_points)


def _decimate(ds: DataStruct, target_points: int) -> tuple[DataStruct, list[int] | None]:
    ds = _trim_trailing_padding(ds)
    n = ds.n_points
    if n <= target_points or ds.n_channels == 0:
        return ds, None

    finite_counts = np.count_nonzero(np.isfinite(ds.values), axis=0)
    densest = int(np.argmax(finite_counts))
    y = ds.values[:, densest]

    bucket_count = max(1, target_points // 2)
    edges = np.linspace(0, n, bucket_count + 1)
    keep: set[int] = set()
    for b in range(bucket_count):
        start, end = int(edges[b]), int(edges[b + 1])
        if start >= end:
            continue
        seg = y[start:end]
        finite = np.isfinite(seg)
        if not finite.any():
            keep.add(start)  # nothing finite in this span -> keep a placeholder row
            continue
        local = np.flatnonzero(finite)
        seg_finite = seg[local]
        keep.add(start + int(local[int(np.argmin(seg_finite))]))
        keep.add(start + int(local[int(np.argmax(seg_finite))]))

    idx = np.fromiter(sorted(keep), dtype=np.int64)
    return (
        DataStruct(
            time=ds.time[idx],
            values=ds.values[idx, :],
            labels=ds.labels,
            units=ds.units,
            metadata=ds.metadata,
        ),
        [int(i) for i in idx],
    )
