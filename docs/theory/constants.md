# Physical constants across unit systems

Covers `calc/constants.py::constants_by_system`. `constants()` is the
CODATA-2018 SI dict every other `calc/` module imports from (do not retype
these values — see the module docstring). `constants_by_system()` is
additive: it *derives* CGS-Gaussian and eV-based representations of the same
constants from the SI values, via exact conversion factors computed in code,
never a second set of hand-typed literals — so a non-SI value can only drift
out of parity with SI through a bug in the factor, not a mistyped number.

## SI → CGS-Gaussian

Length/mass/energy convert by simple powers of ten
($1\,\mathrm{m}=10^2\,\mathrm{cm}$, $1\,\mathrm{kg}=10^3\,\mathrm{g}$,
$1\,\mathrm{J}=10^7\,\mathrm{erg}$). Charge, field, and flux need an extra
factor because Gaussian electromagnetism is built on a *different*
formulation of Coulomb's law: $F = q_1q_2/r^2$ with no $4\pi\varepsilon_0$
prefactor. The Coulomb→statcoulomb bridge follows directly from that choice:

$$1\,\mathrm{C} = \frac{c\,[\mathrm{cm/s}]}{10}\;\mathrm{statC}$$

(with $c$ the speed of light), and similarly $1\,\mathrm{T}=10^4\,\mathrm{G}$,
$1\,\mathrm{Wb}=10^8\,\mathrm{Mx}$. **The vacuum permittivity and
permeability are excluded from the CGS table entirely** — not converted, but
*absent* — because Gaussian units don't carry them as free parameters at
all: the convention that produces the simplified Coulomb's law above is
equivalent to setting $4\pi\varepsilon_0 = \mu_0 = 1$ (dimensionless) by
construction, with factors of $c$ appearing explicitly in Maxwell's
equations instead (e.g. Ampère's law gains a $1/c$). An "SI-derived CGS
value" for either constant is therefore not a meaningful question, not a
missing computation.

Worked example: $e = 1.602176634\times10^{-19}\,\mathrm{C}
\times (c\,[\mathrm{cm/s}]/10) = 4.8032\times10^{-10}\,\mathrm{statC}$ — the
standard tabulated electron-charge-in-esu value.

## SI → eV-based

Because the 2019 SI redefinition fixes the elementary charge $e$ exactly,
the joule↔eV bridge is exact too: $1\,\mathrm{eV} \equiv e\,\mathrm{J}$, so
$\mathrm{eV} = J/e$. Mass constants convert via mass-energy equivalence,
$E=mc^2$, into MeV/c² (the conventional particle-physics unit); constants
with no natural per-particle-energy form (charge, field, per-mole
quantities) are excluded from this table, same reasoning as above. A
synthetic combination, $\hbar c$, is included because it is the standard
eV·length "natural units" bridge, not because it is a standalone SI entry.

Worked examples: $m_e c^2 = 0.510999\,\mathrm{MeV}$;
$\hbar c = 197.327\,\mathrm{eV\cdot nm}$ (equivalently the more commonly
quoted $197.327\,\mathrm{MeV\cdot fm}$ — the two are numerically identical
since $\mathrm{MeV\cdot fm} \equiv \mathrm{eV\cdot nm}$ dimensionally).

**Reference:** CODATA 2018 recommended values (Tiesinga, E. et al., *Rev.
Mod. Phys.* **93**, 025010 (2021)); Jackson, J.D., *Classical
Electrodynamics*, 3rd ed. (Wiley, 1999), App. — SI/Gaussian unit conversion
table.
