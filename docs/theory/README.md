# Theory reference

Short, citable reference entries for the physics behind `src/quantized/calc/`
— one file per domain, one section per formula family. These are **not**
tutorials (see `plans/` for workflow docs when they exist); each entry states
the formula, the convention/sign choice the code uses, units, and a worked
example with realistic numbers, plus a textbook or paper citation. Match this
concise style when adding new entries — the sibling `quantized_matlab` repo's
`docs/theory/` covers the same domains in long derivation form; this repo's
version is intentionally the terser companion, not a duplicate.

| File | Domain |
|---|---|
| [`xrd.md`](xrd.md) | X-ray/neutron diffraction: Miller-Bravais indices, interplanar angles, Bragg's law, Q-space, neutron wavelength/energy/velocity/temperature, reciprocal-space maps (angular↔Q geometry, sector/chi/box cuts, radial vs. transverse, strain/relaxation, counting statistics) |
| [`transport.md`](transport.md) | Electrical transport: van der Pauw sheet resistance, Hall-effect carrier analysis |
| [`thin_films.md`](thin_films.md) | Thin-film growth & epitaxy: QCM (Sauerbrey), Matthews-Blakeslee critical thickness, dopant in-diffusion |
| [`constants.md`](constants.md) | Fundamental constants across unit systems (SI / CGS-Gaussian / eV-based) |

Each entry names the `calc/` module + function it documents so the two stay
in sync; when a formula changes, update both.
