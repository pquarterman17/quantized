"""Regenerates tests/fixtures/import_formats/ (HDF5/NeXus, MATLAB, Igor, images).

Every file is tiny and built from public format layouts, so none is a copy of
anyone's data or of any LGPL/GPL package's test files:

    uv run python tests/fixtures/make_import_fixtures.py

* ``quantized_export.h5``   -- ``io.hdf5.write_hdf5`` output (raw + corrected,
  corrections, a non-ASCII unit, a categorical channel).
* ``nexus_1d.nxs`` / ``nexus_2d.nxs`` / ``generic.h5`` -- written with h5py.
* ``workspace_v5.mat`` -- ``scipy.io.savemat``; ``workspace_v73.mat`` -- an
  HDF5 file laid out the way MATLAB writes ``-v7.3`` (512-byte user block,
  ``MATLAB_class`` attributes, dimensions reversed).
* ``wave_v5.ibw`` / ``wave_v2.ibw`` / ``wave2d_v5.ibw`` -- Igor binary waves per
  WaveMetrics TN003 (the offsets in ``quantized.io.igor_ibw``); ``ibw_bytes``
  below is also used by the tests to make big-endian and damaged variants. The
  reader was checked against real Igor-written files in both byte orders.
* ``gray8.png`` / ``rgb.png`` / ``gray16.tif`` / ``pages.tif`` / ``photo.jpg``.

The writers are importable (``ibw_bytes``) so tests can build variants.
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "import_formats"

# Expected contents, shared with the tests.
X = np.linspace(10.0, 20.0, 6)
Y = np.array([1.0, 4.0, 9.0, 16.0, 25.0, 36.0])
GRID = np.arange(12, dtype=float).reshape(3, 4)  # (ny=3, nx=4)


def ibw_bytes(
    data: np.ndarray,
    *,
    name: str = "wave0",
    version: int = 5,
    big_endian: bool = False,
    dx: tuple[float, ...] = (1.0, 1.0),
    x0: tuple[float, ...] = (0.0, 0.0),
    data_units: str = "",
    dim_units: tuple[str, ...] = ("", ""),
    note: str = "",
    wave_type: int = 4,
) -> bytes:
    """An Igor binary wave (version 2: 1-D only; version 5: 1-D to 4-D).

    ``wave_type`` 0 (text) and 5 (complex) write the header only; the tests use
    them to check the refusals."""
    e = ">" if big_endian else "<"
    dx, x0 = (*dx, 1.0)[:2], (*x0, 0.0)[:2]
    dtype = {0: "u1", 2: "f4", 4: "f8", 5: "f8", 0x10: "i2", 0x20: "i4", 0x50: "u2"}[wave_type]
    payload = np.asarray(data).astype(e + dtype)
    body = payload.tobytes()  # C order: the last numpy axis (Igor rows, x) runs fastest
    note_b = note.encode("latin-1")
    if version == 5:
        # nDim[0] = rows = Igor's first dimension = numpy's LAST axis
        dims = [payload.size, 0, 0, 0]
        if payload.ndim >= 2:  # Igor's first dimension is numpy's last axis
            dims = [*payload.shape[::-1], *([0] * (4 - payload.ndim))]
        wh = bytearray(320)
        struct.pack_into(e + "i", wh, 12, int(payload.size))
        struct.pack_into(e + "h", wh, 16, wave_type)
        wh[28 : 28 + len(name)] = name.encode("latin-1")
        struct.pack_into(e + "4i", wh, 68, *dims)
        struct.pack_into(e + "4d", wh, 84, dx[0], dx[1], 1.0, 1.0)
        struct.pack_into(e + "4d", wh, 116, x0[0], x0[1], 0.0, 0.0)
        wh[148 : 148 + len(data_units)] = data_units.encode("latin-1")
        for d, unit in enumerate(dim_units[:2]):
            wh[152 + 4 * d : 152 + 4 * d + len(unit)] = unit.encode("latin-1")
        wfm = len(wh) + len(body)
        binh = bytearray(64)
        struct.pack_into(e + "h", binh, 0, 5)
        struct.pack_into(e + "i", binh, 4, wfm)
        struct.pack_into(e + "i", binh, 12, len(note_b))
        head = bytes(binh) + bytes(wh)
        check = -(sum(struct.unpack(f"{e}{len(head) // 2}h", head)) & 0xFFFF)
        binh[2:4] = struct.pack(e + "h", ((check + 0x8000) & 0xFFFF) - 0x8000)
        return bytes(binh) + bytes(wh) + body + note_b
    # version 2: 1-D; the 126-byte header struct + the first 16 data bytes are checksummed
    wh = bytearray(110)
    struct.pack_into(e + "h", wh, 0, wave_type)
    wh[6 : 6 + len(name)] = name.encode("latin-1")
    wh[34 : 34 + len(data_units)] = data_units.encode("latin-1")
    wh[38 : 38 + len(dim_units[0])] = dim_units[0].encode("latin-1")
    struct.pack_into(e + "i", wh, 42, int(payload.size))
    struct.pack_into(e + "dd", wh, 48, dx[0], x0[0])
    padded = body + b"\x00" * max(0, 16 - len(body))
    wfm = 110 + len(padded)
    binh = bytearray(16)
    struct.pack_into(e + "h", binh, 0, 2)
    struct.pack_into(e + "i", binh, 2, wfm)
    struct.pack_into(e + "i", binh, 6, len(note_b))
    head = bytes(binh) + bytes(wh) + padded[:16]
    check = -(sum(struct.unpack(f"{e}{len(head) // 2}h", head)) & 0xFFFF)
    binh[14:16] = struct.pack(e + "h", ((check + 0x8000) & 0xFFFF) - 0x8000)
    return bytes(binh) + bytes(wh) + padded + note_b


def _hdf5() -> None:
    import h5py

    from quantized.datastruct import DataStruct
    from quantized.io.hdf5 import write_hdf5

    t = np.array([300.0, 290.0, 280.0, 270.0])
    vals = np.column_stack([t * 1e-3, [0.0, 1.0, 0.0, 2.0]])
    ds = DataStruct.create(
        t,
        vals,
        labels=["Moment", "Phase"],
        units=["emu", "µm"],
        metadata={
            "x_column_name": "Temperature",
            "x_column_unit": "K",
            "parser_name": "import_ppms",
            "source": "orig/ppms.dat",
        },
        cat_levels={1: ("a", "b", "c")},
    )
    corr = DataStruct.create(t, vals * 2.0, labels=["Moment", "Phase"], units=["emu", "µm"])
    write_hdf5(ds, OUT / "quantized_export.h5", corr_data=corr,
               corrections={"xOff": 1.5, "bgSlope": -0.25})

    with h5py.File(OUT / "nexus_1d.nxs", "w") as f:
        entry = f.create_group("entry")
        entry.attrs["NX_class"] = "NXentry"
        data = entry.create_group("data")
        data.attrs["NX_class"] = "NXdata"
        data.attrs["signal"] = "counts"
        data.attrs["axes"] = ["two_theta"]
        data.attrs["auxiliary_signals"] = ["monitor"]
        tt = data.create_dataset("two_theta", data=X)
        tt.attrs["units"] = "degrees"
        c = data.create_dataset("counts", data=Y)
        c.attrs["units"] = "counts"
        data.create_dataset("counts_errors", data=np.sqrt(Y))
        data.attrs["errors"] = "counts_errors"
        data.create_dataset("monitor", data=np.full(6, 100.0))
    with h5py.File(OUT / "nexus_2d.nxs", "w") as f:
        data = f.create_group("entry/data")
        data.attrs["NX_class"] = "NXdata"
        data.attrs["signal"] = "image"
        data.attrs["axes"] = ["y", "x"]
        data.create_dataset("image", data=GRID).attrs["units"] = "counts"
        data.create_dataset("x", data=np.array([0.5, 1.5, 2.5, 3.5])).attrs["units"] = "mm"
        data.create_dataset("y", data=np.array([-1.0, 0.0, 1.0])).attrs["units"] = "mm"
    with h5py.File(OUT / "generic.h5", "w") as f:
        g = f.create_group("scan")
        g.create_dataset("field", data=X)
        g.create_dataset("moment", data=Y).attrs["units"] = "emu"
        g.create_dataset("short", data=np.arange(3.0))
        f.create_dataset("table", data=np.arange(8.0).reshape(4, 2))


def _mat() -> None:
    import h5py
    from scipy.io import savemat

    savemat(
        OUT / "workspace_v5.mat",
        {
            "t": X.reshape(-1, 1),
            "signal": Y.reshape(1, -1),
            "mat2": np.arange(12.0).reshape(6, 2),
            "k": np.array([[2.5]]),
            "title": "ignored text",
            "scan": {"H": X, "M": Y, "inner": {"c": np.arange(3.0)}},
        },
    )
    # -v7.3: HDF5 with a 512-byte user block, MATLAB_class attributes, dimensions reversed.
    with h5py.File(OUT / "workspace_v73.mat", "w", userblock_size=512) as f:
        t = f.create_dataset("t", data=X.reshape(-1, 1).T)  # MATLAB 6x1 -> HDF5 (1, 6)
        t.attrs["MATLAB_class"] = np.bytes_("double")
        m = f.create_dataset("mat2", data=np.arange(12.0).reshape(6, 2).T)  # 6x2 -> (2, 6)
        m.attrs["MATLAB_class"] = np.bytes_("double")
        s = f.create_group("scan")
        s.attrs["MATLAB_class"] = np.bytes_("struct")
        for key, arr in (("H", X), ("M", Y)):
            d = s.create_dataset(key, data=arr.reshape(-1, 1).T)
            d.attrs["MATLAB_class"] = np.bytes_("double")
        txt = f.create_dataset("title", data=np.array([[116, 120]], dtype=np.uint16))
        txt.attrs["MATLAB_class"] = np.bytes_("char")
    raw = bytearray((OUT / "workspace_v73.mat").read_bytes())
    banner = b"MATLAB 7.3 MAT-file, Platform: GLNXA64, Created on: fixture generator"
    raw[: len(banner)] = banner
    (OUT / "workspace_v73.mat").write_bytes(bytes(raw))


def _ibw() -> None:
    (OUT / "wave_v5.ibw").write_bytes(
        ibw_bytes(Y, name="moment", dx=(0.5,), x0=(10.0,), data_units="emu",
                  dim_units=("Oe",), note="fixture wave")
    )
    (OUT / "wave_v2.ibw").write_bytes(
        ibw_bytes(Y.astype("f4"), name="moment2", version=2, wave_type=2, dx=(0.25,), x0=(1.0,),
                  data_units="V", dim_units=("s",), note="v2 note")
    )
    (OUT / "wave2d_v5.ibw").write_bytes(
        ibw_bytes(GRID, name="map", dx=(0.1, 2.0), x0=(1.0, -3.0), data_units="cts",
                  dim_units=("um", "mm"))
    )


def _images() -> None:
    from PIL import Image

    g = (np.arange(6 * 4, dtype=np.uint8) * 10).reshape(4, 6)  # 6 wide, 4 tall
    Image.fromarray(g, "L").save(OUT / "gray8.png")
    rgb = np.zeros((4, 6, 3), dtype=np.uint8)
    rgb[..., 0] = 200
    rgb[..., 1] = 100
    rgb[..., 2] = 50
    Image.fromarray(rgb, "RGB").save(OUT / "rgb.png")
    g16 = (np.arange(6 * 4, dtype=np.uint16) * 2500 + 7).reshape(4, 6)
    Image.fromarray(g16).save(OUT / "gray16.tif")
    frames = [Image.fromarray((g + k).astype(np.uint8), "L") for k in (0, 5)]
    frames[0].save(OUT / "pages.tif", save_all=True, append_images=frames[1:])
    Image.fromarray(np.tile(g, (4, 4)), "L").save(OUT / "photo.jpg", quality=100)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    _hdf5()
    _mat()
    _ibw()
    _images()
    for p in sorted(OUT.iterdir()):
        print(f"{p.name}: {p.stat().st_size} bytes")


if __name__ == "__main__":
    main()
