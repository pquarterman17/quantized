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

__all__ = ["decimate_datastruct"]


def decimate_datastruct(ds: DataStruct, target_points: int = 200) -> DataStruct:
    """Row-decimate ``ds`` to about ``target_points`` rows.

    Buckets the row range into ``target_points // 2`` contiguous spans and
    keeps, from each span, the row holding the MINIMUM and the row holding the
    MAXIMUM value of the densest channel (most finite values) -- so a sparkline
    built from the result still shows real spikes/dips a plain stride sample
    would step over. Every retained row keeps ALL of its channels (they were
    picked together), so the output is a normal, if smaller, ``DataStruct``.

    Returns ``ds`` unchanged when it already has at most ``target_points`` rows
    or has no channels at all (an empty-data pseudo-book -- nothing to pick
    extrema from, and nothing to save by decimating zero columns).
    """
    n = ds.n_points
    if n <= target_points or ds.n_channels == 0:
        return ds

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
    return DataStruct(
        time=ds.time[idx],
        values=ds.values[idx, :],
        labels=ds.labels,
        units=ds.units,
        metadata=ds.metadata,
    )
