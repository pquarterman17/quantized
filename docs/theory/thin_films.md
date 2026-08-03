# Thin-film growth, epitaxy, and diffusion

Covers `calc/thin_film.py::sauerbrey`, `calc/substrates.py::critical_thickness`,
and `calc/diffusion.py::c_profile` — the growth-monitoring, strain-relief,
and dopant-transport calculators behind DiraCulator's Thin Film / Substrates
/ Diffusion tabs. Related, already-documented functions in the same modules
(`kiessig_thickness`, `stoney_stress`, `arrhenius`, `diffusion_length`) are
referenced but not re-derived here.

## Sauerbrey equation (QCM mass sensing)

A quartz crystal microbalance's resonant frequency shifts in proportion to
an added rigid mass film, because the added mass is mechanically
indistinguishable (to the shear wave) from a small thickening of the quartz
itself:

$$\Delta f = -\frac{2f_0^2}{\sqrt{\mu_q\rho_q}}\cdot\frac{\Delta m}{A}
= -C_f\cdot\frac{\Delta m}{A}$$

using the standard AT-cut quartz shear modulus $\mu_q=2.947\times10^{11}$
g/(cm·s²) and density $\rho_q = 2.648$ g/cm³. Sign convention: added mass
(film growth, adsorption) decreases the resonant frequency, so $\Delta f<0$
for the ordinary deposition case; the returned areal mass is then positive.
**Valid only in the thin, rigid-film regime** ($|\Delta f|/f_0 \ll 1$,
conventionally up to a few percent of $f_0$) — beyond that a viscoelastic
model (Kanazawa-Gordon, Voinova) is required instead, since the film no
longer moves in lockstep with the crystal surface. **When to use:** real-time
mass-loading readout during PVD/sputter/ALD growth or molecular adsorption,
when the film is thin and stiff relative to the quartz.

Worked example — 5 MHz crystal, $\Delta f=-10$ Hz: sensitivity factor
$C_f = 56.6$ Hz·cm²/µg (the textbook value for this common crystal cut), and
areal mass $= 176.68$ ng/cm².

**Reference:** Sauerbrey, G., "Verwendung von Schwingquarzen zur Wägung
dünner Schichten und zur Mikrowägung," *Z. Phys.* **155**, 206–222 (1959).

## Matthews-Blakeslee critical thickness

A pseudomorphic (coherently strained) epitaxial film is only metastable
below a critical thickness $h_c$; above it, misfit dislocations become
energetically favorable and begin to relax the strain. For the standard
60°-dislocation case (diamond/zincblende (100) growth, e.g. SiGe/Si), $h_c$
solves an implicit equation balancing the misfit-strain energy against the
dislocation line energy:

$$h_c = \frac{b}{8\pi f}\cdot\frac{1-\nu\cos^2 60°}{(1+\nu)\cos 30°}
\cdot\ln\!\Big(\frac{h_c}{b}+1\Big)$$

where $f$ is the (absolute) lattice mismatch (see `lattice_mismatch`), $b$
the Burgers vector magnitude of the misfit dislocation (default 4 Å, typical
for a diamond/zincblende $a/\sqrt2\langle110\rangle$ dislocation), and $\nu$
the film's Poisson ratio. Solved numerically (bracketed root-find); a stable
pseudomorphic thickness exists only when the mismatch is small enough that a
second positive root exists — beyond that, this model reports no metastable
thickness at all (raises rather than returning a meaningless value).
**Limitation to state explicitly:** this is the *equilibrium* model. Real,
kinetically-limited films routinely grow thicker than $h_c$ before
dislocations actually nucleate — the metastable regime has its own, larger
estimate (People & Bean 1985). $b$ and the 60° dislocation geometry are the
standard defaults for diamond/zincblende (100) growth, not universal; a
different lattice or dislocation system needs a re-derived coefficient, not
just different numbers. **When to use:** the natural next step after
`lattice_mismatch` — estimating how thick a strained buffer/channel layer can
grow before misfit dislocations are expected at equilibrium.

Worked example — 1% mismatch, default $b=4$ Å, $\nu=0.3$:
$h_c = 26.61$ Å $\approx 2.66$ nm.

**Reference:** Matthews, J.W. & Blakeslee, A.E., "Defects in epitaxial
multilayers I. Misfit dislocations," *J. Cryst. Growth* **27**, 118–125
(1974); People, R. & Bean, J.C., *Appl. Phys. Lett.* **47**, 322 (1985) for
the metastable-regime alternative.

## Dopant in-diffusion (Fick's second law, constant surface source)

For a species diffusing in from a fixed-concentration boundary held at
$x=0$ (dopant in-diffusion, gettering, or any semi-infinite constant-source
problem), Fick's second law has the complementary-error-function solution:

$$c(x,t) = c_0\,\mathrm{erfc}\!\left(\frac{x}{2\sqrt{Dt}}\right)$$

The argument's length scale, $L=\sqrt{Dt}$, is exactly the characteristic
diffusion length already reported by `diffusion_length` — `c_profile` is the
full spatial profile built on that same scale, and $D$ itself is typically
supplied by `arrhenius` ($D=D_0e^{-E_a/k_BT}$) for a given anneal
temperature. **When to use:** predicting a dopant depth profile from a
constant-concentration diffusion source (as opposed to `dose_to_concentration`,
which models a fixed-*dose* implant's Gaussian profile).

Worked example — $D=10^{-12}$ cm²/s, $t=3600$ s ($L=6\times10^{-5}$ cm =
0.6 µm): at the surface ($x=0$), $c=c_0$ (erfc(0)=1); at $x=L$,
$c/c_0 = \mathrm{erfc}(0.5) = 0.4795$.

**Reference:** Crank, J., *The Mathematics of Diffusion*, 2nd ed. (Oxford,
1975), §2.2 (constant surface concentration in a semi-infinite medium); the
standard semiconductor-processing form appears in Sze, S.M. & Ng, K.K.,
*Physics of Semiconductor Devices*, 3rd ed. (Wiley, 2007), Ch. 1.
