"""The six P0.4 measurement cases (a)-(f). Each ``case_*`` function takes the
large-fixtures directory and returns a ``list[CaseResult]`` -- one list entry
per measured call. See ``envelope.py`` for orchestration and
``envelope_measure.py`` for the timing/memory primitive.

Every case routes through the REAL pure ``quantized.io`` / ``quantized.calc``
path a request would take -- never a shortcut synthetic reimplementation of
what those modules do.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from envelope_measure import CaseResult, fixture_rel, measure
from large import write_large_map

from quantized.calc.corrections import apply_corrections
from quantized.calc.figure import render_figure
from quantized.calc.figure_map import render_map_figure
from quantized.calc.linecut import line_cut
from quantized.calc.plotting import PlotState, build_series
from quantized.calc.resample import resample_data
from quantized.datastruct import DataStruct
from quantized.io.delimited import import_csv
from quantized.io.origin_project.preview import decimate_datastruct
from quantized.io.registry import import_auto
from quantized.io.xrdml import import_xrdml
from quantized.routes._payload import jsonify

__all__ = [
    "case_correction_chain",
    "case_csv_import",
    "case_dense_multiseries",
    "case_figure_export_scale",
    "case_map_suite",
    "case_plot_payload",
]

_MAP_SIZES = (500, 1000, 2000)


# ── (a) 1M-row x 8-col CSV import ────────────────────────────────────────────


def case_csv_import(fixtures_dir: Path) -> list[CaseResult]:
    path = fixtures_dir / "large_million_row.csv"
    file_bytes = path.stat().st_size
    # Clean (no-tracemalloc) wall time for this parser measures ~6s on this
    # machine -- under the 10s best-of-3 threshold, so it gets the same
    # best-of-3 + warm-up treatment as every other case (a pilot run WITH
    # tracemalloc active throughout measured ~22s instead of ~6s: allocation
    # tracing is not free against a parser doing per-cell Python float()
    # calls across 8M+ cells, which is exactly why `measure()` keeps timing
    # and memory-profiling as separate calls -- see envelope_measure.py).
    m = measure(lambda: import_auto(str(path)), repeat=3, warmup=True)
    ds = m.result
    expansion = (m.peak_mem_mb * 1e6) / file_bytes
    return [
        CaseResult(
            case="1M-row x 8-col CSV import",
            fixture=fixture_rel(path),
            fixture_bytes=file_bytes,
            command="quantized.io.registry.import_auto(path)  # -> io.delimited.import_csv",
            wall_s=m.wall_s,
            peak_mem_mb=m.peak_mem_mb,
            repeat=3,
            warmup=True,
            output_shape=f"DataStruct.values {ds.values.shape}",
            notes=(
                f"expansion ratio (peak traced mem / file bytes) = {expansion:.1f}x"
            ),
        )
    ]


# ── (b) correction chain at 1M rows ─────────────────────────────────────────


def case_correction_chain(_fixtures_dir: Path) -> list[CaseResult]:
    # Exact params from tests/test_perf_baselines.py::test_correction_chain_baseline,
    # scaled from n=100_000 to n=1_000_000.
    rng = np.random.default_rng(7)
    n = 1_000_000
    t = np.linspace(-10.0, 10.0, n)
    vals = rng.normal(size=(n, 4)) + t[:, None] * 0.5
    ds = DataStruct.create(t, vals, labels=["a", "b", "c", "d"], units=["V"] * 4)
    params: dict[str, object] = {
        "xTrimMin": -9.0,
        "xTrimMax": 9.0,
        "xOff": 0.1,
        "yOff": 0.05,
        "bgPoly": [0.01, -0.2, 0.5, 1.0],
        "smoothEnabled": True,
        "smoothWindow": 7,
        "smoothMethod": "moving",
        "normMethod": "Range [0,1]",
        "derivativeMode": "dY/dX",
    }
    m = measure(lambda: apply_corrections(ds, params), repeat=3, warmup=True)
    out = m.result
    return [
        CaseResult(
            case="correction chain (1M x 4): trim+offsets+bgPoly+smooth+norm+deriv",
            fixture="synthetic in-memory (test_perf_baselines chain params, n=1,000,000)",
            fixture_bytes=None,
            command="quantized.calc.corrections.apply_corrections(ds, params)",
            wall_s=m.wall_s,
            peak_mem_mb=m.peak_mem_mb,
            repeat=3,
            warmup=True,
            output_shape=f"DataStruct.values {out.values.shape}",
        )
    ]


# ── (c) 2-D map import + render + line-cut at 3 sizes ───────────────────────


def _ensure_map_fixture(fixtures_dir: Path, n: int) -> Path:
    path = fixtures_dir / f"large_rsm_map_{n}.xrdml"
    if not path.exists():
        write_large_map(path, seed=9000 + n, n_omega=n, n_tt=n)
    return path


def case_map_suite(fixtures_dir: Path) -> list[CaseResult]:
    results: list[CaseResult] = []
    for n in _MAP_SIZES:
        path = _ensure_map_fixture(fixtures_dir, n)
        file_bytes = path.stat().st_size
        rel = fixture_rel(path)

        m_import = measure(lambda p=path: import_xrdml(p), repeat=3, warmup=True)
        ds = m_import.result
        results.append(
            CaseResult(
                case=f"2-D map import ({n}x{n} XRDML mesh)",
                fixture=rel,
                fixture_bytes=file_bytes,
                command="quantized.io.xrdml.import_xrdml(path)",
                wall_s=m_import.wall_s,
                peak_mem_mb=m_import.peak_mem_mb,
                repeat=3,
                warmup=True,
                output_shape=f"map_shape={ds.metadata.get('map_shape')}",
            )
        )

        n_frames, m_pixels = ds.metadata["map_shape"]
        tt = ds.column("2Theta").reshape(n_frames, m_pixels)
        om = ds.column("Omega").reshape(n_frames, m_pixels)
        iv = ds.column("Intensity").reshape(n_frames, m_pixels)
        x_axis, y_axis, z_grid = tt[0, :], om[:, 0], iv

        m_render = measure(
            lambda x=x_axis, y=y_axis, z=z_grid: render_map_figure(
                x, y, z, kind="contourf", fmt="svg",
                title="envelope", x_label="2Theta", y_label="Omega", z_label="Intensity",
            ),
            repeat=3,
            warmup=True,
        )
        out_bytes = m_render.result
        results.append(
            CaseResult(
                case=f"2-D map figure render ({n}x{n}, contourf/svg)",
                fixture=rel,
                fixture_bytes=file_bytes,
                command=(
                    "quantized.calc.figure_map.render_map_figure(x, y, z, "
                    "kind='contourf', fmt='svg')"
                ),
                wall_s=m_render.wall_s,
                peak_mem_mb=m_render.peak_mem_mb,
                repeat=3,
                warmup=True,
                output_shape=f"{len(out_bytes)} bytes SVG",
            )
        )

        target = float(om[n_frames // 2, 0])
        m_cut = measure(
            lambda d=ds, v=target: line_cut(d, direction="h", value=v), repeat=3, warmup=True
        )
        cut = m_cut.result
        results.append(
            CaseResult(
                case=f"line-cut extraction ({n}x{n} map, H-cut)",
                fixture=rel,
                fixture_bytes=file_bytes,
                command="quantized.calc.linecut.line_cut(ds, direction='h', value=...)",
                wall_s=m_cut.wall_s,
                peak_mem_mb=m_cut.peak_mem_mb,
                repeat=3,
                warmup=True,
                output_shape=f"values {cut.values.shape}",
            )
        )
    return results


# ── (d) dense multi-series: full-res vs downsampled render ─────────────────


def case_dense_multiseries(fixtures_dir: Path) -> list[CaseResult]:
    path = fixtures_dir / "large_dense_multiseries.csv"
    file_bytes = path.stat().st_size
    rel = fixture_rel(path)
    ds = import_csv(path)  # not timed here -- generic CSV import is case (a)'s subject
    x = ds.time
    series = [(ds.labels[i], ds.values[:, i]) for i in range(ds.values.shape[1])]

    m_full = measure(
        lambda: render_figure(x, series, fmt="svg", title="dense", x_label="t", y_label="y"),
        repeat=3,
        warmup=True,
    )
    out_full = m_full.result
    n_series, n_rows = ds.values.shape[1], ds.values.shape[0]
    results = [
        CaseResult(
            case=f"dense multi-series render ({n_series} x {n_rows}, full-res, svg)",
            fixture=rel,
            fixture_bytes=file_bytes,
            command="quantized.calc.figure.render_figure(x, series, fmt='svg')",
            wall_s=m_full.wall_s,
            peak_mem_mb=m_full.peak_mem_mb,
            repeat=3,
            warmup=True,
            output_shape=f"{len(out_full)} bytes SVG",
        )
    ]

    # No purpose-built "downsample for rendering" function exists in calc/ (no
    # downsample/decimate/lttb hits there). Two adjacent building blocks exist
    # elsewhere and neither is quite it -- both are exercised and reported so
    # the gap is evidenced, not asserted:
    #  - calc.resample.resample_data: interpolates ALL channels onto a common
    #    new x-grid. Correct per-channel values, but interpolation can wash
    #    out a real spike a plain grid sample would land between.
    #  - io.origin_project.preview.decimate_datastruct: a real min/max-
    #    preserving row decimator, but it picks bucket rows from the SINGLE
    #    densest channel and keeps that SAME row for every other channel --
    #    fine for a one-series sparkline preview (its actual current use),
    #    wrong for a 20-series plot where each series' extrema fall on
    #    different rows. It also lives under io/origin_project/, not calc/,
    #    so routes/plot.py's dense-render path has no direct line to it.
    m_resample = measure(
        lambda: resample_data(ds, n_points=2000, method="linear"), repeat=3, warmup=True
    )
    ds_resampled = m_resample.result
    series_resampled = [
        (ds_resampled.labels[i], ds_resampled.values[:, i])
        for i in range(ds_resampled.values.shape[1])
    ]
    m_resample_render = measure(
        lambda: render_figure(
            ds_resampled.time, series_resampled,
            fmt="svg", title="dense-resampled", x_label="t", y_label="y",
        ),
        repeat=3,
        warmup=True,
    )
    out_resampled = m_resample_render.result
    results.append(
        CaseResult(
            case=f"dense multi-series render ({n_series} x ~2k, resample_data/linear, svg)",
            fixture=rel,
            fixture_bytes=file_bytes,
            command=(
                "quantized.calc.resample.resample_data(ds, n_points=2000, method='linear') "
                "then render_figure(..., fmt='svg')"
            ),
            wall_s=m_resample_render.wall_s,
            peak_mem_mb=m_resample_render.peak_mem_mb,
            repeat=3,
            warmup=True,
            output_shape=f"{len(out_resampled)} bytes SVG",
            notes=(
                f"resample step alone: {m_resample.wall_s * 1000:.1f} ms; "
                f"vs full-res render: {m_full.wall_s / m_resample_render.wall_s:.1f}x faster, "
                f"{len(out_full) / len(out_resampled):.1f}x smaller SVG. "
                "Interpolation-based -- does not preserve per-channel extrema (see case docstring)."
            ),
        )
    )

    m_decimate = measure(
        lambda: decimate_datastruct(ds, target_points=2000), repeat=3, warmup=True
    )
    ds_decimated = m_decimate.result
    results.append(
        CaseResult(
            case=f"row-decimate to ~2k rows (decimate_datastruct, {n_series} channels)",
            fixture=rel,
            fixture_bytes=file_bytes,
            command=(
                "quantized.io.origin_project.preview.decimate_datastruct(ds, target_points=2000)"
            ),
            wall_s=m_decimate.wall_s,
            peak_mem_mb=m_decimate.peak_mem_mb,
            repeat=3,
            warmup=True,
            output_shape=f"values {ds_decimated.values.shape}",
            notes=(
                "min/max-preserving but keyed off ONE 'densest' channel's extrema for ALL "
                "channels -- not a general multi-series visual downsampler as-is "
                "(see case docstring)."
            ),
        )
    )
    return results


# ── (e) figure export at scale: 1 series x 1,000,000 points ────────────────


def case_figure_export_scale(_fixtures_dir: Path) -> list[CaseResult]:
    rng = np.random.default_rng(1)
    n = 1_000_000
    x = np.linspace(0.0, 100.0, n)
    y = np.sin(x) + 0.01 * rng.normal(size=n)
    series = [("series", y)]

    results = []
    for fmt in ("svg", "png"):
        m = measure(
            lambda fmt=fmt: render_figure(
                x, series, fmt=fmt, title="scale", x_label="x", y_label="y"
            ),
            repeat=3,
            warmup=True,
        )
        out = m.result
        results.append(
            CaseResult(
                case=f"figure export at scale (1 series x 1,000,000 pts, {fmt})",
                fixture="synthetic in-memory (sine + noise, n=1,000,000)",
                fixture_bytes=None,
                command=f"quantized.calc.figure.render_figure(x, [('series', y)], fmt='{fmt}')",
                wall_s=m.wall_s,
                peak_mem_mb=m.peak_mem_mb,
                repeat=3,
                warmup=True,
                output_shape=f"{len(out)} bytes {fmt.upper()}",
                notes="matplotlib path.simplify collapses dense points; no timeout needed",
            )
        )
    return results


# ── (f) plot-payload wire cost (the pure path behind POST /api/plot/series) ─


def case_plot_payload(fixtures_dir: Path) -> list[CaseResult]:
    path = fixtures_dir / "large_million_row.csv"
    file_bytes = path.stat().st_size
    rel = fixture_rel(path)
    ds = import_auto(str(path))  # not timed here -- import cost is case (a)

    def _pack() -> dict[str, object]:
        plot = build_series(ds, PlotState())
        data = [jsonify(plot.x)] + [jsonify(s.values) for s in plot.series]
        return {
            "data": data,
            "series": [{"label": s.label, "unit": s.unit, "axis": s.axis} for s in plot.series],
            "x": {"label": plot.x_label, "unit": plot.x_unit, "log": False},
            "y": {"log": False},
        }

    m_pack = measure(_pack, repeat=3, warmup=True)
    payload = m_pack.result
    n_series = len(payload["series"])  # type: ignore[arg-type]
    n_rows = len(payload["data"][0])  # type: ignore[index]

    m_encode = measure(lambda: json.dumps(payload), repeat=3, warmup=True)
    encoded = m_encode.result
    payload_mb = len(encoded) / 1e6

    return [
        CaseResult(
            case="plot-payload packing (build_series + jsonify, 1M x 7)",
            fixture=rel,
            fixture_bytes=file_bytes,
            command=(
                "quantized.calc.plotting.build_series(ds, PlotState()) + "
                "quantized.routes._payload.jsonify(...)  "
                "# the pure path behind POST /api/plot/series"
            ),
            wall_s=m_pack.wall_s,
            peak_mem_mb=m_pack.peak_mem_mb,
            repeat=3,
            warmup=True,
            output_shape=f"{n_series} columns x {n_rows} rows",
        ),
        CaseResult(
            case="plot-payload JSON encode (json.dumps, 1M x 7)",
            fixture=rel,
            fixture_bytes=file_bytes,
            command="json.dumps(payload)",
            wall_s=m_encode.wall_s,
            peak_mem_mb=m_encode.peak_mem_mb,
            repeat=3,
            warmup=True,
            output_shape=f"{payload_mb:.1f} MB encoded JSON",
            notes=(
                f"WIRE PAYLOAD SIZE for one full-resolution 1M-row plot = {payload_mb:.1f} MB "
                f"(this is what the browser must download+parse); pack+encode combined "
                f"~{m_pack.wall_s + m_encode.wall_s:.2f}s server-side"
            ),
        ),
    ]
