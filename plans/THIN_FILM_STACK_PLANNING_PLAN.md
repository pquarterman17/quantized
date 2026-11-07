# Thin-Film Stack Planning Plan (DiraCulator)

**Status:** ACTIVE — G3 ported (MATLAB golden freeze pending); G1, G2, G4–G6 open
**Created:** 2026-11-07
**Updated:** 2026-11-07 — G3 parity ports (six cards, routes, freeze cases)
**Audited baseline:** `main` @ `9da2bb6` (2026-11-06)
**Scope:** `calc/substrates.py`, `calc/crystallography.py`, `calc/thin_film.py`,
`io/cif.py` + `routes/structures.py`, `frontend/src/components/workshops/calculators/`,
and a proposed `workshops/epitaxy/` subtree
**Parent:** `plans/PORT_PLAN.md` W4 / `plans/PORT_CHECKLIST.md` W4; follows
`plans/DIRACULATOR_AUDIT_PLAN.md` (complete)
**Out of scope (deferred):** literature and paper search. Also out of scope:
computing surface or interface energies with DFT or ML potentials.

## Purpose

Make the DiraCulator able to plan an epitaxial stack:

1. choose a substrate and orientation for a film;
2. find the in-plane epitaxial relationship and the strain it implies;
3. carry the strain through every layer of a multilayer, including critical
   thickness and thermal strain on cool-down;
4. predict where the strained film's peaks should appear in XRD and RSM data,
   so the plan can be checked against measurements Quantized already analyses;
5. give a first-order wetting versus islanding call from surface energies.

## Audited baseline — what already exists

| Capability | Where | Evidence |
|---|---|---|
| Substrate table, 14 rows (name, formula, orientation label, a, c, CTE, ε_r, density, type) | `calc/substrates.py`, `/api/substrates`, `SubstratesTab.tsx` | golden |
| Lattice mismatch, scalar: `f = (a_film − a_sub)/a_sub` | `substrates.lattice_mismatch` | golden |
| Matthews–Blakeslee critical thickness (MATLAB fixed point, `b = a_film/√2`, 60° dislocation) | `substrates.critical_thickness` | golden |
| Thermal-mismatch strain `ε = (α_f − α_s)ΔT`, optional biaxial stress | `thin_film.thermal_mismatch_strain`, `thinfilm/FilmCards.tsx` | golden |
| Stoney stress, Kiessig thickness, Scherrer size, deposition and sputter rates, LSS range, multilayer thermal conductivity, Sauerbrey | `calc/thin_film.py`, `thinfilm/*Cards.tsx` | golden; Sauerbrey is an extension |
| d-spacing (all 7 systems), cell volume, X-ray density, interplanar angle, bond angle, Miller–Bravais | `calc/crystallography.py`, `calc/bond_geometry.py`, `CrystalTab.tsx` | golden or reference-tested |
| `plane_spacings` (hkl enumeration, centering absences, multiplicities) | `calc/crystallography.py` / `calc/plane_spacings.py` | golden; **no calculator UI** (used only by Pawley) |
| CIF import (cell, space group, formula, asymmetric-unit atom sites) | `io/cif.py`, `/api/structures/*`, `store/crystalStructures.ts` | golden; session-only presets that reach the Crystal tab and Pawley, **not** Substrates |
| RSM strain and relaxation from measured peaks | `calc/rsm.py`, `calc/rsm_analyze.py`, RSM workshop | golden |
| Headless calculator catalog (89 ops) | `calc/registry.py`, `/api/calc/*` | tested |

The building blocks for single numbers are solid. Planning is not possible yet,
because every calculation takes scalars and ignores orientation, and there is no
model of the stack as a whole.

## Findings and priorities

### P1 — G1: Mismatch ignores orientation

`lattice_mismatch(a_film, a_sub)` takes two scalars, and `SubstratesTab` always
passes `selected.a`. The orientation column is only a text label. Consequences:

- Si(100) and Si(111) return the same mismatch, but the Si(111) surface net is
  hexagonal with a = a_Si/√2 = 3.840 Å.
- On Al2O3(0001), GaN reads as −33.0% (3.189 Å vs 4.758 Å). In practice GaN grows
  with a 30° in-plane rotation, which gives the commonly quoted ~+16.1% against
  a_sap/√3.
- 45° cube-on-cube rotations are impossible. For example Fe(001)[110] ∥
  MgO(001)[100] gives √2·a_Fe vs a_MgO = −3.8%.
- Supercell relationships are impossible. For example a perovskite on
  MgAl2O4(001) needs a_MAO/2, and STO then gives −3.4%.
- Anisotropic in-plane strain cannot be expressed at all: orthorhombic
  substrates, a-plane or r-plane sapphire, and hexagonal-on-cubic pairs. The
  hexagonal `c` in the substrate table is never used.

#### Required work

- [ ] **Surface-net calculator** (pure numpy, `calc/`): from (a, b, c, α, β, γ)
  and (hkl) or (hkil), return the reduced 2D in-plane cell: |u|, |v|, angle,
  area, and the 3D directions they correspond to.
- [ ] **Orientation-aware mismatch**: from a film plane and direction and a
  substrate plane and direction, return ε along both in-plane axes, the shear,
  and the area mismatch. Keep the scalar `lattice_mismatch` unchanged: it is a
  golden MATLAB-parity function.
- [ ] **Coincidence-lattice search** (Zur–McGill style): enumerate film and
  substrate supercells up to a maximum area across in-plane rotations. Rank the
  matches by strain, area and rotation, returning ε₁, ε₂, shear, the supercell
  matrices and the rotation angle.
- [ ] **Domain-matching mode** (m·a_f ≈ n·a_s, e.g. TiN/Si(001) 4:3) for
  large-mismatch systems, as a 1D special case of the same search.
- [ ] Reference tests against published epitaxial relationships: GaN/c-sapphire
  30°, Fe/MgO 45°, cube-on-cube perovskites on STO/LSAT/LAO, Si(111)
  hexagonal net. Add invariant tests: identical lattices give zero strain;
  results don't change when the inputs are swapped or rotated by a symmetry
  operation; supercell area ratios are integers.

#### Acceptance gate

Given a film, a substrate and their orientations, the tool reports the
relationship and strain a grower would quote, including rotated and supercell
cases. Si(100) and Si(111) give different answers.

### P1 — G2: Materials data is too thin for planning

- The substrate table has 14 rows, no `b`, no elastic constants or Poisson
  ratio, and its orientations are labels, not Miller indices. There are no
  orthorhombic substrates: none of the scandates (DyScO3, GdScO3), NdGaO3 or
  similar substrates commonly used to tune strain.
- Films have **no presets at all**: `a_film` is typed by hand.
- The MATLAB `calc.crystal.phaseDatabase` (**52 phases**: substrates, metals,
  simple oxides, perovskites, semiconductors and others, with the full cell,
  centering, system, ICSD number and, for many, a basis) is **not ported** and
  not listed in `PORT_CHECKLIST.md`.
- CIF presets are session-only and reach only the Crystal tab and Pawley, not
  Substrates.

#### Required work

- [ ] Port `phaseDatabase` verbatim as a JSON data file plus a loader (the same
  pattern as `element_data.json`, to stay under the 500-line ceiling). Golden
  freeze of the table. Add it to `PORT_CHECKLIST.md`.
- [ ] Define one material record: full cell, system, centering, CTE, optional
  elastic constants (C11/C12/C13/C33/C44, or E and ν), and source/citation.
  Values ported from MATLAB stay verbatim. New fields and rows are marked as
  extensions and must carry a citation.
- [ ] Add orientation as Miller indices (hkl/hkil) alongside the existing label,
  so the surface net is computed, not implied.
- [ ] Add common substrates missing from the table (scandates, NdGaO3, KTaO3,
  YAlO3, ZnO, …) as cited extensions, without editing the MATLAB rows.
- [ ] Let phase-database entries and imported CIF presets fill both the film and
  the substrate inputs.

### P2 — G3: Unported MATLAB DiraCulator cards relevant to growth

These cards are in MATLAB `DiraCulator.m` but have no Python counterpart, and
`PORT_CHECKLIST.md` does not list them:

| MATLAB card (tab) | Source | Python |
|---|---|---|
| Tetragonal Distortion (Crystal) | `+calc/+crystal/tetragonalDistortion.m` | missing |
| Strain from Poisson Ratio (Crystal) | `+calc/+crystal/strainFromPoisson.m` | missing |
| Atomic Density (Crystal) | `+calc/+crystal/atomicDensity.m` | missing |
| Plane Spacing Table (Crystal) | `planeSpacings` | calc ported, **card missing** |
| Weight% / Atomic% Conversion (X-ray/Neutron) | `+calc/+xrayNeutron/atomicToWeightPercent.m`, `weightToAtomicPercent.m` | missing |
| Co-deposition Flux Ratio (X-ray/Neutron) | `+calc/+xrayNeutron/coDepositionRatio.m` | missing |

Also unported, outside the calculator: `+calc/+crystal/matchPhases.m` (matching
peaks to phases against `phaseDatabase`), which BosonPlotter's peak tools use.

#### Required work

- [x] Port each function to `calc/`, add a thin route and a card, add the
  golden freeze cases, and add a `PORT_CHECKLIST.md` entry. Follow the existing
  parity loop in `CLAUDE.md`.
- [ ] Run `tools/matlab/freeze_diraculator_values.m` against `../quantized_matlab`
  to write the 13 G3 fixtures (`calc_dira_crystal_*`,
  `calc_dira_xray_{atomic_to_weight,weight_to_atomic,co_deposition}_*`), confirm
  the golden tests pass, extend the `diraculator_w4` campaign entry in
  `tests/golden/manifest.json`, and tick the two `[~]` `PORT_CHECKLIST.md` entries.
- [ ] Wire `tetragonal_distortion` and `strain_from_poisson` into the
  orientation-aware mismatch result (G1), so the predicted out-of-plane strain
  appears next to the in-plane strain.
- [x] Log `matchPhases` as a separate checklist item. It depends on the
  `phaseDatabase` port.

### P2 — G4: No stack model; strain is not carried through layers

Each card stands alone. Missing:

- [ ] **Stack definition**: an ordered list of layers (material, orientation,
  thickness, growth temperature) on a substrate. The reflectivity `LayerTable`
  is a UI precedent.
- [ ] **Per-interface evaluation**: mismatch against the layer below, using
  either a pseudomorphic or a relaxed in-plane reference; a critical-thickness
  check for each layer, flagged when thickness > h_c; accumulated strain.
- [ ] **Elastic response**: ε⊥ from ε∥ using the elastic constants for the
  orientation, e.g. −2·C12/C11·ε∥ for cubic (001), with ν as the fallback.
- [ ] **Thermal step**: strain from cooling from growth temperature to room
  temperature for each layer, plus total-stack curvature and stress (Stoney).
- [ ] **Further critical-thickness models** as labeled extensions: People–Bean,
  and Matthews–Blakeslee with a configurable slip system and Burgers vector.
  The MATLAB-parity `critical_thickness` keeps its fixed 60°, `a/√2`
  assumptions, which do not hold for wurtzite basal slip or perovskite a⟨100⟩
  dislocations.
- [ ] **Predicted diffraction**: for each strained layer, the (00l) 2θ and the
  asymmetric-RSM (Qx, Qz) positions, which can be overlaid in the RSM workshop
  and compared with `rsm_strain`. This links planning to measurement.
- [ ] **Hand-off to Reflectivity**: send the planned thicknesses and SLDs (via
  `sld_formula`) to seed a Parratt model, reusing the existing
  `reflectivitySeed` bridge.

### P2 — G5: Surface energies and growth mode are missing

There is no surface-energy data, no Bauer criterion (γ_s ≥ γ_f + γ_int means
wetting), and no Wulff shape.

#### Required work

- [ ] **Decision D2** (below): choose the data source.
- [ ] Surface-energy lookup by material and (hkl). The value's source must be
  shown next to it.
- [ ] Bauer-criterion card. γ_int is usually unknown, so take it as a user input
  and show the verdict across a range of values. Don't imply more precision
  than the data has.
- [ ] Wulff construction (2D cross-section, optionally 3D) using
  `scipy.spatial` half-space and convex-hull routines. Pure `calc/`.

### P3 — G6: Terminations need the full unit cell

`io/cif.py` returns atom sites for the asymmetric unit only. The symmetry
operations are parsed into `loops` but never applied. Termination-aware
planning (e.g. TiO2- vs SrO-terminated SrTiO3(001), polar-surface checks) needs
the full conventional cell.

- [ ] Apply the CIF symmetry operations to expand the atom sites, with tests
  against known cells.
- [ ] List the possible terminations for a given (hkl) and flag polar stacks.

## Decisions needed

- **D1 — Where it lives.** Recommendation: small cards (G3, orientation-aware
  mismatch) stay in the Calculators tabs. The coincidence search and the stack
  model go in a new `workshops/epitaxy/` ToolWindow (state hook, view and
  sub-components, as in the reflectivity workshop). That keeps every `.tsx` file
  under the 400-line ceiling.
- **D2 — Surface-energy source.** (a) A bundled, curated table of published
  computed values, e.g. Tran et al., *Sci. Data* 2016 / Materials Project.
  Check the data licence and attribution terms first. (b) An optional online
  Materials Project lookup: needs the user's API key, uses the network, and must
  fail closed when offline. (c) User-entered values only. Recommendation: (a)
  plus (c) now; (b) later as an optional extra.
- **D3 — Dependencies.** Recommendation: implement the surface net, the
  coincidence search and Wulff in pure numpy/scipy in `calc/`; these are small,
  published algorithms. Use pymatgen (MIT) only as a **dev-group oracle** in
  tests to cross-check matches, not as a runtime dependency. ASE is LGPL and
  must not become a runtime dependency under the repo's no-GPL rule. Note that
  `test_repo_integrity`'s GPL list does not name ASE, so the test would not catch
  it.
- **D4 — Elastic constants source** for the ε⊥ predictions: a curated, cited
  table, user entry, or both.

## Verification model

G1, G2 (new fields), G4, G5 and G6 have **no MATLAB counterpart**. Following the
bond-angle, Sauerbrey and van der Pauw precedent, label them as Python
extensions and make no golden-parity claim. Test them with:

- reference values from published epitaxial relationships and textbook strain
  results;
- invariants (symmetry, round-trips, identical lattices give zero strain);
- the optional pymatgen oracle (D3), run in tests only.

The G2 `phaseDatabase` port and every G3 port follow the golden-freeze loop.

## Recommended implementation order (to-do)

1. [x] **G3 parity ports**: tetragonal distortion, strain from Poisson, atomic
   density, Plane Spacing Table card, wt%↔at%, co-deposition flux ratio.
   Low risk, golden-backed, and useful right away. (MATLAB freeze still to run.)
2. [ ] **G2 data**: port `phaseDatabase`, define the material record, add Miller
   indices for orientation, feed film/substrate inputs from the database and
   CIF presets.
3. [ ] **G1 core**: surface-net calculator, orientation-aware mismatch,
   reference and invariant tests. Show the result in the Substrates tab.
4. [ ] **G1 search**: coincidence and domain-matching search, plus the
   `workshops/epitaxy/` UI (D1).
5. [ ] **G4 stack**: stack model, per-layer h_c and thermal step, ε⊥ (D4),
   predicted 2θ/RSM positions, hand-off to Reflectivity.
6. [ ] **G5 growth mode**: surface-energy data (D2), Bauer card, Wulff.
7. [ ] **G6 terminations**: CIF symmetry expansion, termination listing.
8. [ ] Register the new operations in `calc/registry.py` so they can be scripted
   headlessly. Reconcile `PORT_CHECKLIST.md` W4 and this plan.

## Verification gate

For each slice:

```bash
uv run python tools/gate.py
uv run pytest -m golden
uv run ruff check src tests tools
uv run mypy src
cd frontend && npm test
cd frontend && npx tsc -b --force
cd frontend && npm run build
```

## Completed

- 2026-11-07 — Read-only audit of the calculator stack against `main` @
  `9da2bb6` and `quantized_matlab` (`DiraCulator.m`, `+calc/+crystal`,
  `+calc/+xrayNeutron`, `+calc/+substrates`). Gaps G1–G6 identified; no code
  changes.
- 2026-11-07 — **G3 parity ports.** `calc/epitaxial_strain.py`
  (tetragonal distortion, Poisson strain), `calc.crystallography.atomic_density`,
  `calc/composition.py` (wt%↔at%, co-deposition), routes under
  `/api/crystallography/*` and `/api/composition/*`, registry ops, and five
  cards: Plane Spacing Table and three film cards on the Crystal tab, two
  composition cards on the X-ray / Neutron tab. Reference-value and API tests
  added. 13 MATLAB freeze cases added; their golden tests skip until frozen (no
  MATLAB in the porting session). Found while porting: the MATLAB docstring
  examples for `coDepositionRatio` and `weightToAtomicPercent` do not match the
  MATLAB code; the code is what is ported and frozen.
