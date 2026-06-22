"""Live end-to-end smoke test against a running qz server (:8000).

Exercises every route with real (QD fixture) + synthetic data, and verifies the
fit-overlay alignment assumption (yFit length == plot x length) on real data.
Not part of the test suite — a manual integration check. Run with the server up.
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
import numpy as np

BASE = "http://127.0.0.1:8000"
FIXTURE = Path(__file__).parent.parent / "tests" / "fixtures" / "qd_edp124.dat"
c = httpx.Client(base_url=BASE, timeout=30.0)

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    mark = "PASS" if cond else "FAIL"
    if cond:
        passed += 1
    else:
        failed += 1
    print(f"  [{mark}] {name}{(' — ' + detail) if detail else ''}")


print("== health / SPA ==")
check("GET /api/health", c.get("/api/health").json().get("status") == "ok")
root = c.get("/")
check("GET / serves SPA", root.status_code == 200 and "<" in root.text, f"{root.status_code}, {len(root.text)}B")

print("== parsers + plot (real QD data) ==")
ds = c.post("/api/parsers/import", json={"path": str(FIXTURE)}).json()
npts = len(ds["time"])
check("import QD .dat", npts > 100 and len(ds["labels"]) >= 1, f"{npts} pts, labels={ds['labels']}")
plot = c.post("/api/plot/series", json={"dataset": ds}).json()
plot_x_len = len(plot["data"][0])
check("plot/series", plot_x_len == npts and len(plot["series"]) >= 1, f"x={plot_x_len}, series={len(plot['series'])}")

print("== corrections (real data) ==")
corr = c.post("/api/corrections/apply", json={"dataset": ds, "params": {"yOff": 1.0, "smoothEnabled": True, "smoothWindow": 5, "smoothMethod": "moving"}}).json()
changed = corr["values"] != ds["values"]
check("corrections/apply (yOff+smooth)", changed and len(corr["time"]) == npts, "values changed")

print("== fitting ==")
models = c.get("/api/fitting/models").json()["models"]
names = {m["name"] for m in models}
check("fitting/models", "Linear" in names and "Gaussian" in names, f"{len(models)} models")
# synthetic clean line
xs = list(np.linspace(0, 10, 60))
ys = [2.0 * v + 1.0 for v in xs]
guess = c.post("/api/fitting/autoguess", json={"model": "Linear", "x": xs, "y": ys}).json()["p0"]
check("fitting/autoguess", len(guess) == 2)
fit = c.post("/api/fitting/fit", json={"model": "Linear", "x": xs, "y": ys}).json()
check("fitting/fit recovers slope/intercept", abs(fit["params"][0] - 2.0) < 1e-6 and abs(fit["params"][1] - 1.0) < 1e-6, f"params={[round(p,4) for p in fit['params']]}, R2={fit['R2']}")
# overlay-alignment on REAL data: fit the QD dataset, yFit must align to plot x
ds_x = ds["time"]
ds_y = [row[0] for row in ds["values"]]
fit_real = c.post("/api/fitting/fit", json={"model": "Linear", "x": ds_x, "y": ds_y}).json()
check("fit overlay aligns to plot x (real data)", len(fit_real["yFit"]) == plot_x_len, f"yFit={len(fit_real['yFit'])} == plotX={plot_x_len}")

print("== baseline ==")
xb = np.linspace(0.0, 49.0, 50)
yb = list(0.1 * xb + 2.0 + 10.0 * np.exp(-((xb - 25.0) ** 2) / 18.0))
est = c.post("/api/baseline/estimate", json={"x": list(xb), "y": yb, "method": "snip"}).json()["baseline"]
check("baseline/estimate (snip)", len(est) == 50 and all(b <= yi + 1e-9 for b, yi in zip(est, yb)), "clamped <= signal")
als = c.post("/api/baseline/als", json={"y": yb, "lam": 1e5}).json()["baseline"]
check("baseline/als", len(als) == 50)
rb = c.post("/api/baseline/rollingball", json={"y": yb, "radius": 10}).json()
check("baseline/rollingball", len(rb["baseline"]) == 50 and rb["info"]["radius"] == 10)

print("== stats ==")
d1 = c.post("/api/stats/descriptive", json={"x": [1, 2, 3, 4, 5]}).json()
check("stats/descriptive", abs(d1["mean"] - 3.0) < 1e-12 and d1["N"] == 5)
reg = c.post("/api/stats/regression", json={"x": xs, "y": [3 * v - 2 for v in xs]}).json()
check("stats/regression", abs(reg["coeffs"][1] - 3.0) < 1e-6 and reg["R2"] > 0.9999)
tt = c.post("/api/stats/ttest", json={"x": [1.1, 2.0, 1.9, 2.2, 1.8], "mu": 0.0}).json()
check("stats/ttest", "tStat" in tt and len(tt["ci"]) == 2)
av = c.post("/api/stats/anova", json={"groups": [[1, 2, 3], [2, 3, 4], [5, 6, 7]]}).json()
check("stats/anova", "fStat" in av and "pValue" in av)
pca = c.post("/api/stats/pca", json={"data": np.random.default_rng(0).standard_normal((30, 3)).tolist()}).json()
check("stats/pca", "coeff" in pca and len(pca["explained"]) >= 1)

print("== reference ==")
consts = c.get("/api/reference/constants").json()["constants"]
check("reference/constants", consts["c"] > 2.9e8, f"c={consts['c']:.4e}")
els = c.get("/api/reference/elements").json()["elements"]
check("reference/elements", len(els) == 118 and els[0]["symbol"] == "H")
fe = c.get("/api/reference/elements/Fe").json()
check("reference/elements/Fe", fe["symbol"] == "Fe" and fe["Z"] == 26)
conv = c.post("/api/reference/convert", json={"value": 1.0, "from": "Oe", "to": "T"}).json()
check("reference/convert (Oe->T)", abs(conv["result"] - 1e-4) < 1e-12, f"1 Oe = {conv['result']} T")

print("== export (file downloads) ==")
xrd = {
    "time": [10.0, 10.02, 10.04, 10.06],
    "values": [[100.0], [120.0], [95.0], [110.0]],
    "labels": ["Intensity"],
    "units": ["cps"],
    "metadata": {"x_column_name": "2Theta", "x_column_unit": "deg"},
}
csv = c.post("/api/export/xrd-csv", json={"dataset": xrd, "filename": "smoke"})
check(
    "export/xrd-csv download",
    csv.status_code == 200
    and csv.headers["content-type"].startswith("text/csv")
    and 'filename="smoke.csv"' in csv.headers.get("content-disposition", "")
    and "Intensity" in csv.text,
    csv.headers.get("content-disposition", ""),
)
h5 = c.post("/api/export/hdf5", json={"dataset": xrd, "filename": "smoke"})
check(
    "export/hdf5 download (valid signature)",
    h5.status_code == 200 and h5.content[:8] == b"\x89HDF\r\n\x1a\n",
    f"{len(h5.content)}B, magic={h5.content[:4]!r}",
)

print("== error handling ==")
e1 = c.post("/api/fitting/fit", json={"model": "NoSuch", "x": [0, 1], "y": [0, 1]})
check("unknown model -> 422", e1.status_code == 422)
e2 = c.get("/api/reference/elements/Zz")
check("unknown element -> 404", e2.status_code == 404)

print(f"\n==== {passed} passed, {failed} failed ====")
sys.exit(1 if failed else 0)
