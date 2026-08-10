# Tutorial: Reciprocal-Space Map Cuts — Strain, Relaxation, and Epitaxial Quality

This tutorial walks through a complete reciprocal-space map (RSM) analysis:
load a PANalytical `.xrdml` area scan, view it in Q-space, find the
substrate and film peaks, cut radial and transverse profiles through each,
and extract strain and relaxation numbers you would paste into a paper —
plus what to do when the reflection you measured cannot answer the whole
question.

**Research question:** "I have an RSM around one reflection of my
epitaxial film. Is the film strained or relaxed relative to the substrate,
and how good is the epitaxy (mosaic spread, crystallite quality)?"

Every number below was produced by actually running the commands shown,
against the real corpus file `panalytical/xrd/epytaxy_rsm.xrdml` (a
substrate + thin-film RSM around a single, nearly-symmetric reflection,
Cu Kα1, $\lambda=1.540598$ Å). See
[`docs/theory/xrd.md`](../theory/xrd.md) for the underlying physics (the
angular↔Q transform, why the Q grid is curvilinear, the sector/chi/box cut
families, and the radial/transverse↔strain/mosaic relations) — this
tutorial is the workflow, that doc is the reference.

---

## 1. Physics in 60 seconds

An RSM measures intensity over a 2-D grid of $(2\theta,\omega)$ around one
Bragg reflection and converts it to reciprocal space $(Q_x,Q_z)$. A
substrate and a coherently strained film reflect at *different* $(Q_x,Q_z)$
because they have different lattice spacings. Two numbers, read off the
pair of peak positions, answer the research question:

$$\varepsilon_\perp=\frac{Q_{z,\rm sub}}{Q_{z,\rm film}}-1\quad\text{(out-of-plane strain)},\qquad
\varepsilon_\parallel=\frac{Q_{x,\rm sub}}{Q_{x,\rm film}}-1\quad\text{(in-plane strain)}$$

and two profile widths, read off cuts **along** ($\to$ radial, $d$-spacing
spread) and **across** ($\to$ transverse, mosaic spread) each peak's own
$\mathbf Q$ direction, answer the epitaxial-quality half of the question.
See [`docs/theory/xrd.md`](../theory/xrd.md) for the full derivations and
sign conventions — in particular the $\varphi=0°=+Q_x$ (not specular)
azimuth convention and the reason a "fixed-Q" cut must mask the point
cloud rather than select a detector row.

---

## 2. What you need

- An `.xrdml` 2-D area scan (`mesh_kind="mesh"` or `"snapshot"` in the
  parsed metadata — a genuine RSM, not a pole figure).
- The source wavelength — PANalytical embeds `kAlpha1` in the file, so
  `io.registry.import_auto` / `io.xrdml.import_xrdml` fill in
  `metadata.wavelength_a` and the `Qx`/`Qz` columns automatically when it's
  present.
- Two resolvable peaks (substrate + film) in the map. If the film peak is
  very weak (thin film, low volume fraction), lower `rsm_analyze`'s
  `threshold` — see Step 4.

```python
from quantized.io.registry import import_auto

ds = import_auto("panalytical/xrd/epytaxy_rsm.xrdml")
print(ds.labels, ds.units)
print(ds.metadata["is2D"], ds.metadata["map_shape"], ds.metadata["mesh_kind"])
print(ds.metadata["wavelength_a"])
```

```
('2Theta', 'Omega', 'Intensity', 'Qx', 'Qz') ('deg', 'deg', 'cps', 'Ang^-1', 'Ang^-1')
True [108, 169] mesh
1.540598
```

`Intensity` is in **cps** here (169 columns × 108 rows of a
counts-per-second area map, `counting_time = 29.07` s per point) — keep
that in mind for Step 7's uncertainty discussion.

---

## 3. View the map in Q-space

`ds` is a scattered `DataStruct` (one row per detector pixel); reshape it
to the $(N,M)$ grid to look at $|Q|$ coverage before cutting anything:

```python
import numpy as np

n, m = ds.metadata["map_shape"]
qx = ds.column("Qx").reshape(n, m)
qz = ds.column("Qz").reshape(n, m)
print("Qx range", qx.min(), qx.max())
print("Qz range", qz.min(), qz.max())
```

```
Qx range -0.26715786686156606 0.20342063612392738
Qz range 4.575506328039626 4.86798087801353
```

This scan covers $Q_x\in[-0.27,0.20]$, $Q_z\in[4.58,4.87]$ Å⁻¹ — a
symmetric-ish reflection near $|Q|\approx4.8$ Å⁻¹ ($d\approx1.30$ Å from
Bragg's law). The map is curvilinear (see the theory doc) — do **not**
read a "fixed-$Q_z$ cut" off a raw detector row.

---

## 4. Find the peaks

`calc.rsm_analyze.rsm_analyze` smooths, finds local maxima, and fits each
with a 2D peak model (angle-space fit + a Q-space refit when Qx/Qz are
present). The two brightest are labelled `substrate` / `film`:

```python
from quantized.calc.rsm_analyze import rsm_analyze, rsm_grids_from_datastruct

g = rsm_grids_from_datastruct(ds)
result = rsm_analyze(
    g["intensity"], g["axis1"], g["axis2"],
    qx=g["qx"], qz=g["qz"], intensity_unit=g["intensity_unit"],
)
sub, film = result["peaks"]
print("substrate:", sub["centre_Q"], sub["fwhm_Q"], "amp", sub["amplitude"])
print("film:     ", film["centre_Q"], film["fwhm_Q"], "amp", film["amplitude"])
```

```
substrate: [0.0007999842951093815, 4.826976930890028] [0.0010654454045802798, 0.00148485784107202] amp 1210.03
film:      [0.00044230905046043975, 4.64007088121243] [0.0070777120093437895, 0.01879056317818595] amp 11.57
```

The film peak is ~100$\times$ weaker than the substrate — typical for a
thin epitaxial layer — but `rsm_analyze`'s default `threshold=0.01` (1% of
the smoothed map maximum) still finds it. If your film peak doesn't show
up, lower `threshold` and/or increase `n_peaks`.

`centre_Q` is `[Qx, Qz]`, `fwhm_Q` is `[FWHM_Qx, FWHM_Qz]`. Both peaks have
$Q_x\approx10^{-3}$ Å⁻¹ against $|Q|\approx4.8$ — this reflection is nearly
symmetric, which matters for Steps 5 and 6.

---

## 5. Radial and transverse cuts through the substrate peak

Because this reflection is nearly symmetric, radial ($\parallel\mathbf Q$)
is well approximated by $Q_z$ and transverse ($\perp\mathbf Q$) by $Q_x$ —
no rotation needed (see the theory doc's "Radial and transverse cuts"
section for the asymmetric-reflection case, which needs `box_cut`'s
`angle` parameter). Box a region around the substrate peak in Q-space and
collapse onto each axis in turn:

```python
from quantized.calc.boxcut import box_cut, box_stats

roi = dict(x_min=-0.01, x_max=0.01, y_min=4.80, y_max=4.86, space="q")

radial = box_cut(ds, **roi, collapse="y", reduce="sum", n_bins=80)      # vs Qz
transverse = box_cut(ds, **roi, collapse="x", reduce="sum", n_bins=80)  # vs Qx
stats = box_stats(ds, **roi)

print(stats)
```

```
{'n_points': 281, 'integrated_intensity': 3012.62, 'mean_intensity': 10.72,
 'max_intensity': 1033.37, 'peak_x': -0.000126, 'peak_y': 4.827391,
 'centroid_x': 0.000633, 'centroid_y': 4.826524, 'x_min': -0.01, 'x_max': 0.01,
 'y_min': 4.8, 'y_max': 4.86, 'space': 'q', 'angle': 0.0, 'wrap': None}
```

`box_stats`'s `peak_x/peak_y` (the single brightest raw pixel,
$-0.0001,4.8274$) and `centroid_x/centroid_y` (the intensity-weighted mean
of all 281 selected points, $0.0006,4.8265$) both land inside the
`rsm_analyze` fit centre from Step 4 — three independent reads of the same
peak agreeing is a good sanity check before trusting the FWHM numbers.

Read the FWHM directly off `rsm_analyze`'s fit (Step 4's `fwhm_Q`) rather
than off the binned `radial`/`transverse` `DataStruct`s — a Gaussian fit to
the unbinned cloud is a tighter estimate than a coarse-bin half-max read.
Reading the half-max points directly off the 80-bin `radial`/`transverse`
profiles gives $\approx0.0015$ Å⁻¹ (radial) and $\approx0.00125$ Å⁻¹
(transverse) — close to the fit's $0.00148$ / $0.00107$ (1% and 17% off,
respectively; the coarser bin grid under-resolves the narrower transverse
peak more than the radial one). Converting the fit values to physical
numbers (theory doc's radial/transverse relations, $|Q|_{\rm sub}=4.827$
Å⁻¹):

$$\frac{\Delta d}{d}=\frac{0.00148}{4.827}=0.031\%,\qquad
\Delta\beta_{\rm mosaic}=\frac{0.00107}{4.827}=2.21\times10^{-4}\ \text{rad}=45.5''$$

A $d$-spacing spread of 0.03% and a mosaic spread of 46 arcsec are both
tight — this is a good single-crystal substrate, as expected. Repeating for
the film peak (Step 4's numbers, $|Q|_{\rm film}=4.640$ Å⁻¹):

$$\frac{\Delta d}{d}=\frac{0.01879}{4.640}=0.405\%,\qquad
\Delta\beta_{\rm mosaic}=\frac{0.00708}{4.640}=1.53\times10^{-3}\ \text{rad}=315''$$

The film is ~13$\times$ broader radially and ~7$\times$ broader
transversely than the substrate — a thin, somewhat mosaic epitaxial layer,
not a perfect single crystal (expected: threading dislocations and
finite-thickness broadening both grow the peak in both directions).

---

## 6. Sanity-check with a sector / chi profile

A full-annulus sector/chi pair independently confirms the peak location
without picking an ROI by hand — useful as a first look, or to check for a
second, unindexed feature at the same $|Q|$ but a different azimuth:

```python
from quantized.calc.sectorcut import sector_profile, chi_profile

qrad = np.hypot(qx, qz)
sector = sector_profile(ds, q_min=float(qrad.min()), q_max=float(qrad.max()))
chi = chi_profile(ds, q_min=float(qrad.min()), q_max=float(qrad.max()))

i = sector.values[:, 0]
print("sector peak |Q| =", sector.time[np.nanargmax(i)])

ic = chi.values[:, 0]
print("chi peak phi =", chi.time[np.nanargmax(ic)])
```

```
sector peak |Q| = 4.826227430045378
chi peak phi = 90.0
```

$|Q|=4.826$ Å⁻¹ matches the fitted substrate peak to within one radial bin
($\approx0.003$ Å⁻¹ at the default 100 bins). $\varphi=90°$ is $+Q_z$
(specular) — recall the code's azimuth convention is $0°=+Q_x$, **not**
$0°=$ specular (theory doc, "Sector and azimuthal profiles" section), so
90° here is exactly where a near-symmetric reflection should sit.

---

## 7. Strain and relaxation

```python
from quantized.calc.rsm import rsm_strain

q_sub = tuple(sub["centre_Q"])
q_film = tuple(film["centre_Q"])
strain = rsm_strain(q_sub, q_film)
print(strain)
```

```
{'eps_parallel': 0.8086545917986643, 'eps_perp': 0.04028086088822014,
 'a_sub_parallel': 7854.14, 'a_sub_perp': 1.301681, 'a_film_parallel': 14205.42,
 'a_film_perp': 1.354114, 'relaxation': nan}
```

**Read `eps_perp`, not `eps_parallel`, here.** $\varepsilon_\perp=4.03\%$
is a well-conditioned number: both $Q_z$ values are $\mathcal O(1)$
Å⁻¹. $\varepsilon_\parallel=81\%$ is **not** a physical strain — it is the
ratio of two $Q_x$ values that are each barely above zero ($8\times10^{-4}$
and $4\times10^{-4}$ Å⁻¹), so the ratio is dominated by fit noise in the
vanishing in-plane component of this near-symmetric reflection. See the
theory doc's "Strain and relaxation" section for why: $\varepsilon_\parallel$
needs a genuinely *asymmetric* reflection (substantial $Q_x$), which this
particular scan is not. `relaxation` is `nan` because no `bulk` position
was supplied — pass the film's expected fully-relaxed $(Q_x,Q_z)$ (its bulk
lattice reflection position) as `bulk=` to get it.

---

## 8. What the answer means

For **this** measurement:

- **Out-of-plane strain:** $\varepsilon_\perp=+4.0\%$ — the film's
  out-of-plane spacing is expanded relative to the substrate's along $Q_z$
  (recall $\varepsilon_\perp=Q_{z,\rm sub}/Q_{z,\rm film}-1$, so a positive
  value means $Q_{z,\rm film}<Q_{z,\rm sub}$, i.e. a *larger* $d_{\rm film}$).
  A tetragonally distorted, coherently strained (pseudomorphic) film under
  in-plane compression would show exactly this sign via the Poisson effect
  — but that is one candidate explanation, not a conclusion this scan can
  reach on its own, because (next bullet) the in-plane sign is unmeasured
  here.
- **In-plane strain / relaxation:** **cannot be determined from this scan
  alone** — the reflection is too close to symmetric. Answering "is the
  film pseudomorphic (fully strained) or relaxed?" needs a second RSM
  around an asymmetric reflection (e.g. a $\{h0l\}$ or $\{hhl\}$ well off
  the surface normal), which gives a $Q_x$ large enough for
  $\varepsilon_\parallel$ and, with a known bulk film lattice parameter,
  the relaxation $R$.
- **Epitaxial quality:** the film peak's radial/transverse widths are both
  roughly an order of magnitude broader than the substrate's — a real but
  moderate degree of imperfection (mosaic spread ~5 arcmin vs the
  substrate's ~45 arcsec), consistent with a thin coherently-strained
  layer rather than a fully relaxed, dislocation-riddled one (a fully
  relaxed film typically shows *both* a shifted peak toward the bulk
  position *and* substantially broader, sometimes streaked, transverse
  width from misfit-dislocation-induced mosaic spread).

---

## 9. Common pitfalls

- **Reading a detector row as a "fixed-Q" cut.** The $(2\theta,\omega)$
  grid is curvilinear in Q-space — one row can sweep 79–99% of the map's
  whole $Q_z$ range (theory doc). Always use `line_cut(..., space="q")`,
  `box_cut(..., space="q")`, or the sector/chi tools, never a raw grid
  index, for anything you want to call "fixed-Q".
- **$\varepsilon_\parallel$ from a near-symmetric reflection.** As in Step
  7 — a near-zero $Q_x$ ratio is numerically unstable long before it's
  exactly zero (where `rsm_strain` would at least return `NaN`). If both
  peaks have $\lvert Q_x\rvert\ll\lvert Q_z\rvert$, don't report
  $\varepsilon_\parallel$; get an asymmetric-reflection RSM instead.
- **$\sqrt{\sum I}$ on a cps map.** `epytaxy_rsm.xrdml`'s `Intensity` is in
  cps (`ds.units[2] == "cps"`), the parser's default. A Poisson error bar
  on a `sector_profile`/`box_cut` sum needs the intensity in raw counts
  first (`ds.metadata["counting_time"]` gives the per-point integration
  time) — see the theory doc's "Uncertainty" section.
- **The $\varphi=0°$ convention.** `sector_profile`/`chi_profile` put
  $0°$ along $+Q_x$ (in-plane), not specular. A specular-referenced
  azimuth is $\varphi-90°$.
- **A weak film peak below `rsm_analyze`'s default threshold.** If only
  one peak is found, lower `threshold` (default `0.01`, i.e. 1% of the
  smoothed map max) before concluding there's no film peak to find.

---

## 10. Going further

| If you need to... | Use |
|---|---|
| Convert $(2\theta,\omega)\to(Q_x,Q_z)$ directly | [`calc/qspace.py::compute_qspace`](../../src/quantized/calc/qspace.py) |
| A fixed-$Q_x$/$Q_z$ line cut (band mask, not a row) | [`calc/linecut.py::line_cut`](../../src/quantized/calc/linecut.py) (`space="q"`) |
| An arbitrary straight cut through the cloud | [`calc/linecut.py::cut_segment`](../../src/quantized/calc/linecut.py) |
| Full-map projection onto one axis | [`calc/linecut.py::projection`](../../src/quantized/calc/linecut.py) |
| A rotated / peak-anchored radial or transverse cut | [`calc/boxcut.py::box_cut`](../../src/quantized/calc/boxcut.py) (`angle=`) |
| An azimuthal profile of a pole figure | [`calc/boxcut.py::box_cut`](../../src/quantized/calc/boxcut.py) (`wrap="x"` on $\Phi$) |
| Scalar summary (∫I, centroid, peak) over an ROI | [`calc/boxcut.py::box_stats`](../../src/quantized/calc/boxcut.py) |
| Find + fit substrate/film peaks automatically | [`calc/rsm_analyze.py::rsm_analyze`](../../src/quantized/calc/rsm_analyze.py) |
| Strain + relaxation from a peak pair | [`calc/rsm.py::rsm_strain`](../../src/quantized/calc/rsm.py) |

For the geometry, curvilinear-grid warning, sector/chi/box math, and the
radial/transverse↔strain/mosaic relations used throughout, see
[`docs/theory/xrd.md`](../theory/xrd.md).

---

## 11. References

- Fewster, P.F., "Reciprocal Space Mapping," in *X-ray and Neutron
  Dynamical Diffraction: Theory and Applications*, NATO ASI Series B:
  Physics Vol. 357 (Springer, 1997), pp. 269–283.
- Fewster, P.F., *X-Ray Scattering from Semiconductors and Other
  Materials*, 3rd ed. (World Scientific, 2015).
- Bowen, D.K. & Tanner, B.K., *High Resolution X-ray Diffractometry and
  Topography* (Taylor & Francis, 1998).
- Pietsch, U., Holý, V. & Baumbach, T., *High-Resolution X-Ray Scattering:
  From Thin Films to Lateral Nanostructures*, 2nd ed. (Springer, 2004).
- Als-Nielsen, J. & McMorrow, D., *Elements of Modern X-ray Physics*, 2nd
  ed. (Wiley, 2011).

For derivations and the full formula set, see
[`docs/theory/xrd.md`](../theory/xrd.md).
