# X-ray & neutron diffraction

Covers `calc/miller_bravais.py`, `calc/crystallography.py::interplanar_angle`,
and `calc/xray.py`. Lengths in angstrom (Å), angles in degrees, $Q$ in Å⁻¹
unless noted. For the $d$-spacing formulas by crystal system
(`calc/crystallography.py::d_spacing`), see the function's docstring — those
predate this doc pass and aren't repeated here.

## Miller-Bravais indices (hexagonal/trigonal)

Hexagonal and trigonal cells are conventionally indexed on four axes
$(a_1, a_2, a_3, c)$ with the redundant axis $a_3 = -(a_1+a_2)$, so both
planes and directions have a 4-index alternate form — but the two convert
**differently**. Planes' intercepts on $a_1, a_2$ are unaffected by the
redundant axis, so the extra index is a pure identity with no rescaling:

$$(hkl) \to (hki l), \qquad i = -(h+k)$$

Direction *components* are not intercepts, so mapping $[UVW]$ onto the same
4-axis basis picks up an overall factor of 3 (Weber indices, $t=-(u+v)$):

$$u = \frac{2U-V}{3}, \quad v = \frac{2V-U}{3}, \quad w = W$$

reduced to lowest integers by scaling by 3 first (`2U-V, 2V-U, -(U+V), 3W`)
then dividing by the GCD. **When to use:** identifying slip systems and habit
planes in hexagonal metals (Mg, Zn, Ti, Zr) and wurtzite/corundum
semiconductors, where the 4-index form makes symmetry-equivalent
planes/directions visually obvious (e.g. the three $\langle11\bar20\rangle$
close-packed directions) in a way the 3-index form does not.

Worked example: $(110) \to (11\bar20)$; $[110] \to [1,1,\bar2,0]$ — note the
plane keeps `h=1,k=1` unchanged while the direction does not (`[UVW]=[110]`
is not `[uvtw]=[110]`, it's `[1,1,-2,0]`).

**References:** Cullity, B.D. & Stock, S.R., *Elements of X-Ray Diffraction*,
3rd ed. (Prentice Hall, 2001), App. 3 (planes); Kelly, A. & Knowles, K.M.,
*Crystallography and Crystal Defects*, 2nd ed. (Wiley, 2012), §1.4
(directions).

## Interplanar angle (reciprocal metric tensor, all 7 systems)

The angle $\varphi$ between two lattice planes $(h_1k_1l_1)$ and
$(h_2k_2l_2)$, for *any* crystal system, follows from the reciprocal metric
tensor $S_{ij}$ (the same quadratic form the general triclinic $1/d^2$ uses,
generalized to a cross term):

$$\cos\varphi = d_1 d_2\Big[S_{11}h_1h_2 + S_{22}k_1k_2 + S_{33}l_1l_2
+ S_{23}(k_1l_2+k_2l_1) + S_{13}(l_1h_2+l_2h_1) + S_{12}(h_1k_2+h_2k_1)\Big]$$

with $S_{11}=(bc\sin\alpha)^2$, $S_{22}=(ac\sin\beta)^2$,
$S_{33}=(ab\sin\gamma)^2$ and the three cross terms built from
$V$ = cell volume; it reduces to the single-plane $1/d^2$ form exactly when
$(h_1k_1l_1)=(h_2k_1l_2)$ since $\cos 0=1$. **When to use:** indexing a
diffraction pattern's angular relationships between reflections (Laue/pole
figures, twin-plane and habit-plane angle checks) in a low-symmetry cell
where the cubic dot-product shortcut doesn't apply.

Worked example — cubic Si ($a=5.4309$ Å): angle between (100) and (110) is
exactly $45°$; between (100) and (111), $54.7356°$ (the familiar
zone-axis-diagonal angle).

**Reference:** Cullity & Stock, *op. cit.*, Eq. 2-11 (general triclinic
metric-tensor form).

## Bragg's law, orders, and Q-space

$$n\lambda = 2d\sin\theta \iff 2\theta = 2\arcsin\!\Big(\frac{n\lambda}{2d}\Big),
\qquad Q = \frac{4\pi}{\lambda}\sin\theta = \frac{2\pi n}{d}$$

`calc/xray.py` exposes the full $\{2\theta, \theta, d, Q\}$ web with an
explicit diffraction order $n$ (default 1) so a higher-order reflection can
be evaluated directly rather than pre-dividing $d$ by $n$ by hand; $Q$ and
$d$ are reciprocal ($Q=2\pi n/d$), exposed as a direct conversion with no
angle involved (`q_from_d_spacing`/`d_spacing_from_q`) as a cross-check. A
reflection is geometrically inaccessible whenever $n\lambda/(2d) > 1$
(equivalently $Q\lambda > 4\pi$) and raises rather than returning a complex
angle.

Worked example — Cu Kα1 ($\lambda=1.5406$ Å) on Si(111) ($d=3.1356$ Å):
$n{=}1 \to 2\theta{=}28.44°$; $n{=}2\to 58.86°$; $n{=}3\to 94.95°$
($n{=}5$ is inaccessible: $5\lambda > 2d$). $Q(n{=}1) = 2.004$ Å⁻¹.

**Standard laboratory anode lines** (Bearden, J.A., *Rev. Mod. Phys.* **39**,
78 (1967); also tabulated in Cullity & Stock App. 7), used as the default
wavelength presets in the X-ray calculator tab:

| Anode | $\lambda_{K\alpha1}$ (Å) |
|---|---|
| Cu Kα1 | 1.540598 |
| Cu Kα (weighted) | 1.5418 |
| Co Kα1 | 1.788996 |
| Fe Kα1 | 1.936041 |
| Cr Kα1 | 2.289726 |
| Mo Kα1 | 0.709319 |
| Ag Kα1 | 0.559408 |

Photon energy and wavelength convert via $E = hc/(e\lambda)$ (`h`, `c`, `e`
from `calc/constants.py`, never retyped) so a beamline energy can substitute
for a tabulated anode line: Cu Kα1 $\to$ 8.0478 keV.

## Neutron scattering: wavelength ↔ energy ↔ velocity ↔ temperature

For a non-relativistic neutron, the de Broglie relation ($p=h/\lambda=m_nv$)
and kinetic energy give a single web relating all four beam-characterization
quantities:

$$E = \frac{h^2}{2m_n\lambda^2} = \tfrac12 m_n v^2 = k_BT$$

`neutron_calc` takes any one of wavelength (Å) / energy (meV) / velocity
(m/s) / temperature (K) and returns the other three — useful for converting
between a reactor/spallation-source beam specification (often quoted as a
"neutron temperature") and the wavelength a diffractometer actually needs.
**When to use:** planning or interpreting a neutron diffraction or
reflectometry measurement where the source reports flux vs. wavelength but
the sample environment (or a paper you're comparing to) reports temperature.

Worked example — the canonical "thermal neutron" reference point:
$\lambda = 1.8$ Å $\to E = 25.25$ meV, $v = 2198$ m/s, $T = 293.0$ K,
matching the standard $2200$ m/s / $25.3$ meV thermal-neutron convention.

**Reference:** Squires, G.L., *Introduction to the Theory of Thermal Neutron
Scattering*, 3rd ed. (Cambridge, 2012), Ch. 1.

## Reciprocal-space maps: the $(2\theta,\omega)\to(Q_x,Q_z)$ transform

Covers `io/xrdml.py`'s 2-D PANalytical parser and `calc/qspace.py::compute_qspace`,
which together turn every pixel of an area-detector reciprocal-space map (RSM)
from goniometer coordinates — detector angle $2\theta$ and incidence/rocking
angle $\omega$ — into reciprocal space, using the standard coplanar (in-plane)
diffractometer geometry:

$$\theta=\frac{2\theta}{2},\qquad
Q_x=\frac{4\pi}{\lambda}\sin\theta\,\sin(\omega-\theta),\qquad
Q_z=\frac{4\pi}{\lambda}\sin\theta\,\cos(\omega-\theta)$$

with $\lambda$ the source wavelength (Å) and $Q_x,Q_z$ in Å⁻¹. $Q_z$ is the
out-of-plane (surface-normal) reciprocal coordinate, $Q_x$ the in-plane one.
**Convention to state explicitly:** $\omega-\theta$ is the offset of the
incidence angle from the symmetric condition; at $\omega=\theta$ it vanishes
and $Q_x=0$ — the point sits exactly on the $Q_z$ axis (the sanity check the
code's own docstring gives). Moving $\omega$ away from $\theta$ at fixed
$2\theta$ (a rocking curve) rotates $\mathbf Q$ about the origin at
(nearly) fixed $|Q|=\frac{4\pi}{\lambda}\sin\theta$ — the geometric reason an
$\omega$-only scan probes mosaic tilt, not $d$-spacing (see "Radial and
transverse cuts" below).

Worked example (Cu Kα1, $\lambda=1.540598$ Å) — one pixel of
`epytaxy_rsm.xrdml` at $2\theta=68.555°$, $\omega=35.685°$ ($\theta=34.278°$,
offset $1.407°$): $Q_x=0.1128$ Å⁻¹, $Q_z=4.5926$ Å⁻¹, reproducing that
pixel's own `Qx`/`Qz` columns exactly (`compute_qspace` is the literal
function `io/xrdml.py` calls to build them — not an independent check, a
round-trip one). At the symmetric condition for the same $2\theta$
($\omega=\theta=34.278°$): $Q_x=0$, $Q_z=4.8265$ Å⁻¹.

**Reference:** Als-Nielsen, J. & McMorrow, D., *Elements of Modern X-ray
Physics*, 2nd ed. (Wiley, 2011) (the Ewald-sphere / scattering-triangle
construction this geometry implements).

## Why the reciprocal-space grid is curvilinear

An area-detector RSM is measured on a rectangular *angular* mesh: $N$ evenly
spaced $\omega$ values (frames) $\times$ $M$ evenly spaced $2\theta$ values
(pixels). Because $Q_x$ and $Q_z$ are nonlinear, coupled functions of both
angles (previous section), that rectangular mesh maps to a **curved fan** in
$(Q_x,Q_z)$, not a rectangle — a single detector row (constant $\omega$)
sweeps a $Q_z$ range that is almost the whole map's, because both $2\theta$
(hence $|Q|$) and $\omega-\theta$ (hence the azimuth) change across the row.
Measured on the real corpus (row $Q_z$ span as a fraction of the whole map's
$Q_z$ range):

| File | Row $Q_z$ span / map $Q_z$ range |
|---|---|
| `epytaxy_rsm.xrdml` | 98.1% |
| `xrayutilities_rsm_pixcel.xrdml` | 98.8% |
| `test_area_panalytical.xrdml` | ~79% |

**Consequence — not a curiosity, a methodological trap:** picking the
detector row whose *mean* $Q_z$ is nearest a target value and calling it a
"fixed-$Q_z$ cut" does not return a fixed-$Q_z$ line; it returns a profile
whose points sweep nearly the whole map, mislabelled. This was
`calc/linecut.py::line_cut`'s `space="q"` behaviour before the fix documented
in that module's docstring — the whole-row/column shortcut is correct in
`space="angular"` (rows genuinely are constant-$\omega$) but silently wrong
in `space="q"`. The sibling MATLAB `+bosonPlotter/extract2DLineCut.m` has the
identical defect and has not been fixed (reported, not silently patched, per
the sibling-repo-first convention — see `plans/PORT_CHECKLIST.md`). The
correct treatment, and the reason `calc/boxcut.py`'s Q-space path and
`calc/sectorcut.py` never take a grid shortcut at all: mask the scattered
$(Q_x,Q_z,I)$ point cloud (a perpendicular band for a fixed-$Q$ cut, a
rectangle for a box, an annulus/sector for a polar profile), then bin the
surviving points along the free coordinate — never select a whole
row/column by proximity in Q. The same curvature is why a Q-space map shows
NaN gaps outside the fan the rectangular angular scan actually swept; that
is the correct picture of a curved fan on a rectangular mesh, not a defect
to interpolate away.

**Reference:** Als-Nielsen & McMorrow, *op. cit.* (the Ewald-sphere
construction underlying why a fixed-angle scan is not a fixed-$Q$ line);
Bowen, D.K. & Tanner, B.K., *High Resolution X-ray Diffractometry and
Topography* (Taylor & Francis, 1998) (RSM instrumentation and the resulting
curved coverage).

## Sector (arc) and azimuthal (chi) profiles

`calc/sectorcut.py` defines polar coordinates about the reciprocal-space
origin from the scattered $(Q_x,Q_z,I)$ cloud:

$$|Q|=\sqrt{Q_x^2+Q_z^2},\qquad\varphi=\operatorname{atan2}(Q_z,Q_x)\in[-180°,180°]$$

**Convention to flag explicitly:** $\varphi=0°$ is along $+Q_x$ (in-plane),
**not** the specular ($+Q_z$) direction most epitaxial users default to
picturing as "straight up" — specular is $\varphi=90°$. This is MATLAB
`atan2d`'s convention, kept for parity with
`+bosonPlotter/extract2DArcIntegral.m`; offset $\varphi$ by 90° for a
"0°=specular" convention.

`sector_profile(ds, q_min, q_max, n_bins=100, phi_min=-180, phi_max=180,
mode="sum")` bins $|Q|$ over `n_bins` bins in $[q_{min},q_{max}]$, counting
only points inside the (rebased) sector $[\varphi_{min},\varphi_{max})$ —
full circle by default. `mode="sum"` totals intensity per bin (a radial
trace — the direct analogue of a powder pattern restricted to one wedge of
reciprocal space); `mode="mean"` divides by the per-bin point count.
**When to use it:** isolating the radial ($|Q|$) profile of one reflection
from others at a different azimuth but similar $|Q|$ (e.g. separating a
single-crystal spot from a powder-like ring near the same $|Q|$), or reading
a radial trace through a textured region of the map.

The sector mask, and the pole-figure periodic axis below, share one rebase
formula (`calc/_rsm_grid.py::wrap_mask`), replacing MATLAB's three-branch
full-circle / non-wrapping / wrapping mask:

$$\mathrm{span}=\big[(\varphi_{max}-\varphi_{min})\bmod 360\big]\ \text{or}\ 360\ (\text{if }0),\qquad
\varphi'=(\varphi-\varphi_{min})\bmod 360\in[0,360),\qquad\text{mask}=\varphi'<\mathrm{span}$$

Worked example — full-circle sector profile on `epytaxy_rsm.xrdml`,
$|Q|\in[4.580,4.868]$ Å⁻¹ (the map's own range), defaults ($n_{bins}=100$,
`mode="sum"`): peaks at $|Q|=4.826$ Å⁻¹ — within one bin ($\approx0.003$
Å⁻¹) of the raw brightest pixel's own $|Q|=4.827$ Å⁻¹.

`chi_profile(ds, q_min, q_max, n_bins=90, phi_min=-180, phi_max=180,
mode="mean")` is the transpose: masks the $[q_{min},q_{max}]$ annulus (no
radial binning) and bins the **rebased** azimuth over $[0,\mathrm{span})$ so
a wrapping sector stays monotonic across the $\pm180°$ seam. New relative to
the MATLAB reference, which only integrates over $\varphi$ to get a radial
trace, never the reverse. `mode="mean"` is the default here (an azimuthal
*intensity distribution*, not a sum). **What it shows:** intensity vs
azimuth at fixed $|Q|$ is the direct readout of texture/mosaicity — a
single-crystal reflection gives one narrow azimuthal peak (its width is the
mosaic spread, see below); a fibre-textured or powder ring gives a broad or
flat azimuthal profile; several discrete azimuthal peaks at the same $|Q|$
indicate a small number of crystallographic domains/variants.

Worked example — same file, full circle, defaults ($n_{bins}=90$,
`mode="mean"`): peaks at $\varphi=90°$, matching the raw brightest pixel's
own $\varphi=90.0°$ almost exactly — along $+Q_z$ (specular), as expected
for the near-symmetric substrate reflection in this file.

**Pole figures** (`mesh_kind="pole"`, e.g. `xrayutilities_polefig_point.xrdml`:
$\Phi$ swept $-180°$ to $180°$ within each scan, a tilt axis $\Psi$ stepped
$0°$–$90°$ across scans) are the *native-polar* case: a fixed-$2\theta$
texture measurement around one reflection with an azimuthal axis already in
the schema and no $Q_x/Q_z$ at all. `sector_profile`/`chi_profile` are
unavailable there (no reciprocal-space origin); the azimuthal profile is
instead `box_cut`'s periodic axis (`wrap="x"` on $\Phi$, collapsing onto
$\Phi$ within a $\Psi$ band) — verified on the real pole-figure file to
return a $\Phi$ profile spanning the full swept range ($-177.5°$ to
$177.5°$ for a 72-bin collapse).

**Reference:** Fewster, P.F., "Reciprocal Space Mapping," in *X-ray and
Neutron Dynamical Diffraction: Theory and Applications*, NATO ASI Series B:
Physics Vol. 357 (Springer, 1997), pp. 269–283; Fewster, P.F., *X-Ray
Scattering from Semiconductors and Other Materials*, 3rd ed. (World
Scientific, 2015); Bunge, H.-J., *Texture Analysis in Materials Science:
Mathematical Methods* (Butterworths, 1982) (pole figures and texture
representation).

## Radial and transverse cuts through a reciprocal-lattice point

For a substrate/film pair, the standard epitaxial measurement is a pair of
line profiles through each reciprocal-lattice point, along and perpendicular
to the scattering vector $\mathbf Q$:

- **Radial** (along $\hat{\mathbf Q}$, varying $|Q|$ at fixed azimuth):
  reports the $d$-spacing / vertical-strain distribution. Since
  $|Q|=2\pi n/d$ (Bragg's-law section above), a radial width maps directly to
  a fractional $d$-spacing spread:
  $$\frac{\Delta d}{d}=\frac{\Delta Q_{\rm radial}}{|Q|}$$
  This mixes size and strain broadening exactly as the Williamson-Hall
  section above does for a powder pattern; a single reflection cannot
  separate them without a second, independent order/reflection.
- **Transverse** (perpendicular to $\hat{\mathbf Q}$, an arc at fixed $|Q|$):
  reports the mosaic spread / tilt distribution. A crystallite region whose
  lattice planes are rotated by a small angle $\delta$ relative to the
  reference orientation displaces its reciprocal-lattice point by $|Q|\,
  \delta$ perpendicular to $\mathbf Q$, so:
  $$\Delta\beta_{\rm mosaic}=\frac{\Delta Q_{\rm transverse}}{|Q|}\quad(\text{radians})$$

For a symmetric or near-symmetric reflection ($Q_x\approx0$), radial is (to
good approximation) the $Q_z$ axis and transverse the $Q_x$ axis, so
`box_cut`'s plain `collapse="y"` (vs $Q_z$) / `collapse="x"` (vs $Q_x$)
already give the radial/transverse pair with no rotation. For a genuinely
**asymmetric** reflection (substantial $Q_x$), radial/transverse tilt
relative to $Q_x$/$Q_z$ by the reflection's own azimuth $\varphi$;
`box_cut`'s `angle` parameter (the cut-ruler backend — rotate the ROI about
its own centre, then mask+bin verbatim) is the tool: `angle =
atan2d(Qz, Qx)` for radial, `+90°` for transverse.

Worked example — the substrate/film peak pair in `epytaxy_rsm.xrdml`, fit
with `calc/rsm_analyze.py::rsm_analyze` (2D Gaussian, refit on the
$Q_x/Q_z$ grids). This reflection is nearly symmetric
($Q_x\approx8\times10^{-4}$ Å⁻¹ against $|Q|\approx4.83$ Å⁻¹), so the
fitted $Q_x/Q_z$ widths are themselves a good radial/transverse proxy
without rotating:

| | $\lvert Q\rvert$ (Å⁻¹) | radial FWHM (Å⁻¹) | $\Delta d/d$ | transverse FWHM (Å⁻¹) | mosaic spread |
|---|---|---|---|---|---|
| Substrate | 4.827 | 0.00148 | 0.031% | 0.00107 | 45.5″ (0.0126°) |
| Film | 4.640 | 0.01879 | 0.405% | 0.00708 | 314.6″ (0.087°) |

The film's radial and transverse widths are both roughly an order of
magnitude larger than the substrate's — the expected signature of a thin,
imperfect epitaxial layer measured against its bulk single-crystal
substrate: a larger $d$-spacing spread from strain/thickness broadening, a
larger mosaic spread from imperfect nucleation and threading dislocations.

**Reference:** Fewster (1997, 2015), *op. cit.* (the radial/transverse
decomposition as an epitaxial-quality diagnostic); Bowen & Tanner, *op.
cit.*

## Strain and relaxation from an RSM peak pair

Once the substrate and film peak centres $(Q_x,Q_z)_{\rm sub}$,
$(Q_x,Q_z)_{\rm film}$ are known (from `rsm_analyze`, or a radial/transverse
cut pair fit by hand), `calc/rsm.py::rsm_strain` converts them to
in-plane/out-of-plane strain and, given an optional bulk (relaxed) film
position, the relaxation — see that function's own docstring for the
formulas ($\varepsilon_\parallel=Q_{x,\rm sub}/Q_{x,\rm film}-1$,
$\varepsilon_\perp=Q_{z,\rm sub}/Q_{z,\rm film}-1$,
$R=(Q_{x,\rm film}-Q_{x,\rm sub})/(Q_{x,\rm bulk}-Q_{x,\rm sub})$), not
repeated here.

**Degeneracy guard (RSM_CUTS_PLAN #23):** $\varepsilon_\parallel$ needs a
reflection with a meaningfully nonzero $Q_x$ — an asymmetric reflection.
Naively running $Q_{x,\rm sub}/Q_{x,\rm film}-1$ on the near-symmetric
substrate/film pair above ($Q_x\approx4$–$8\times10^{-4}$ Å⁻¹ for both)
gives $\approx0.81$ (81%), which is not a physical strain — it is the ratio
of two numbers each barely distinguishable from zero, dominated by fit
noise in the vanishing in-plane component. `rsm_strain` guards against
this: it treats $Q_x$ as degenerate (indistinguishable from zero) whenever
$\lvert Q_x\rvert/\lvert Q_z\rvert$ falls below $\tan(0.1°)\approx1.7\times
10^{-3}$ for *either* peak — about $10\times$ above the fit-noise floor
observed on this file ($\lvert Q_x\rvert/\lvert Q_z\rvert\sim10^{-4}$) and
about $5$–$7\times$ below a deliberately asymmetric reflection (typically
offset from the surface normal by several tenths of a degree or more).
Below that threshold `eps_parallel` is `NaN` and a plain-language reason is
appended to the result's `warnings` list — the exact case above returns
`eps_parallel = NaN`, not $0.81$. $\varepsilon_\perp$ from the same pair is
unaffected and well-conditioned (4.03%, both $Q_z$ values $\mathcal
O(1)$) — only the in-plane strain needs the asymmetric measurement.
**When to use:** a full strain+relaxation determination needs at least one
genuinely asymmetric reflection (e.g. an off-normal $\{hkl\}$ reachable in
grazing-incidence/grazing-exit geometry); a symmetric-reflection RSM alone
constrains only $\varepsilon_\perp$.

**Reference:** Fewster (1997), *op. cit.* (the strain/relaxation triangle
construction from an asymmetric RSM); Pietsch, U., Holý, V. & Baumbach, T.,
*High-Resolution X-Ray Scattering: From Thin Films to Lateral
Nanostructures*, 2nd ed. (Springer, 2004) (strain and relaxation of
epitaxial layers from RSM).

## Uncertainty in binned RSM profiles: what "N points" is (and isn't)

`sector_profile`, `chi_profile`, and `box_cut` all return a two-column
result, `labels=["Intensity", "N points"]`. **"N points" is not a
$\sqrt N$ error bar.** For summed raw counts, the Poisson uncertainty is
$$\sigma=\sqrt{\textstyle\sum I}$$
computed from the `Intensity` column alone — valid **only** when the
intensity unit is raw counts. "N points" is the per-bin sample count: the
divisor `mode="mean"`/`reduce="mean"` uses, and a flag for under-sampled
bins (small $N$ is unreliable; $N=0$ already reports NaN). It is not itself
a standalone uncertainty.

This matters concretely for PANalytical XRDML data: `import_xrdml`'s
**default** intensity unit is `cps` (counts per second), not raw counts
(pass `intensity="counts"` for raw). `epytaxy_rsm.xrdml` itself reports
`cps` with `counting_time = 29.07` s per point — so $\sqrt{\sum I}$ on that
file's `Intensity` column is not a valid Poisson error until the summed
intensity is scaled back to raw counts first
($\text{raw}\approx I_{\rm cps}\times t$, valid when the counting time is
uniform across the summed points — check `ds.metadata["counting_time"]`,
and note the parser's own caveat that a file with *mixed* counting times
normalises `cps` using only the first scan's value). Always check
`ds.units`/`ds.metadata` before treating a summed-intensity column as raw
counts.

**Reference:** Bevington, P.R. & Robinson, D.K., *Data Reduction and Error
Analysis for the Physical Sciences*, 3rd ed. (McGraw-Hill, 2003) (Poisson
counting statistics).
