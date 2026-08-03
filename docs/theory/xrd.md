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
