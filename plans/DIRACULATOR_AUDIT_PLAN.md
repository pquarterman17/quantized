# DiraCulator Calculator Audit Plan

**Status:** Active — audit complete; implementation not started  
**Created:** 2026-08-15  
**Updated:** 2026-08-15 — initial read-only calculator audit recorded  
**Repository:** `C:\Users\patri\git\quantized`  
**Scope:** `frontend/src/components/workshops/calculators/`, calculator API
contracts, calculator parity evidence, and calculator session history  
**Parent:** `plans/PORT_PLAN.md` W4 / `plans/PORT_CHECKLIST.md` W4

## Purpose

Close the correctness, scientific-traceability, parity-evidence, and
maintainability gaps found in the 2026-08-15 audit of the calculator portion of
Quantized/DiraCulator.

The calculator backend and frontend test suites are broadly healthy. The main
risk is not a known incorrect formula; it is that the UI can display a result
whose relationship to the currently visible inputs is unclear, and that most
completed DiraCulator domains do not yet have the MATLAB-frozen evidence
required by this repository's verification model.

## Audited baseline

Read-only verification on 2026-08-15 found:

- 20 calculator frontend test files passed: **152 tests**.
- Calculator-domain backend and API suites passed: **357 tests**.
- Frontend TypeScript typecheck passed.
- Targeted ESLint over calculators, calculator history, and the API client
  passed.
- The worktree was not modified by the audit.

The green tests do not cover the stale-result, request-ordering, hidden-field,
or chained-precision cases below. Reference-value tests also do not establish
golden parity with `quantized_matlab`.

## Findings and priorities

### P1 — Preserve result provenance

Calculator results remain visible after their inputs change. In addition,
`makeCardRunner` has no pending/request identity, so two overlapping requests
can complete out of order and the older result can overwrite the newer one.
The hook-backed calculators disable repeated submission while busy, but their
inputs remain editable and a response can still land beside changed inputs.

Affected areas include:

- raw setters returned by `useCalculators` for Units, photon energy, X-ray,
  Crystal, and SLD;
- `updCrystal` and `updSld`;
- all self-contained cards using `makeCardRunner`;
- result history, which can record completions in network-completion order
  without preserving an input snapshot.

#### Required work

- [ ] Define one calculator-result provenance contract: every displayed result
  is either current for the visible inputs or visibly marked stale.
- [ ] Invalidate the relevant result and error whenever a calculation input,
  unit, mode, preset, or material selection changes.
- [ ] Add a monotonically increasing request ID or equivalent latest-request
  guard to shared asynchronous calculation paths.
- [ ] Prevent an older request from overwriting a newer result or recording a
  misleading history entry.
- [ ] Decide whether editable inputs remain enabled while a request is pending.
  If they do, input changes must invalidate the pending result; if they do not,
  apply the disabled state consistently and accessibly.
- [ ] Add deferred-promise tests proving that out-of-order completions cannot
  replace the latest result.
- [ ] Add per-domain representative tests proving that changing an input clears
  or marks the prior result stale.

#### Acceptance gate

A result must never appear authoritative beside inputs that did not produce it.
History must describe the exact input snapshot used for the recorded result.

### P1 — Establish the claimed MATLAB parity evidence

`PORT_CHECKLIST.md` says formulas embedded in `DiraCulator.m` require inline
MATLAB extraction and frozen outputs. Nevertheless, Electrical, Semiconductor,
Thin Film, X-ray/Neutron, Superconductor, Magnetic, Optics, Vacuum,
Electrochemistry, Thermal, Diffusion, and Substrates are marked complete using
reference/textbook tests. Several test modules explicitly state that they are
not golden-frozen.

This conflicts with the repository rule that a checklist item is checked only
when it is both ported and golden-verified. Closed-form reference tests remain
valuable, but they do not prove behavioral parity with the authoritative
MATLAB implementation, including intentional quirks and previously corrected
MATLAB bugs.

#### Required work

- [ ] Inventory every checked W4 calculator domain and map each operation to
  its `DiraCulator.m` or `+calc` source location.
- [ ] Classify each operation as already golden-frozen, reference-only, new
  Python behavior with no MATLAB counterpart, or an intentional MATLAB bug fix.
- [ ] Add inline cases to `tools/matlab/freeze_calc_values.m` for every
  reference-only MATLAB-backed operation.
- [ ] Freeze outputs from the current authoritative `../quantized_matlab`
  commit and record that commit plus tolerances in the golden manifest.
- [ ] Add `@pytest.mark.golden` coverage that calls the same pure functions used
  by the routes.
- [ ] For intentional departures from MATLAB bugs, freeze and document the
  intended behavior explicitly rather than silently treating a textbook value
  as parity evidence.
- [ ] Mark Python-only calculators such as the neutron multi-quantity helper as
  extensions, not MATLAB-parity claims.
- [ ] Temporarily change unsupported `[x]` checklist entries to `[~]`, or add a
  clearly documented verification-policy exception, until the golden gate is
  satisfied.

#### Acceptance gate

Every checked MATLAB-backed W4 calculator operation has a committed frozen
reference, source commit, tolerance, and passing golden test. Extensions and
intentional divergences are labeled honestly.

### P2 — Ignore hidden X-ray fields in standalone energy modes

The X-ray UI hides wavelength and diffraction order for `lambda -> energy` and
`energy -> lambda`, but `xrayCompute` still parses and validates both hidden
fields before calling the backend. Invalid hidden state can therefore block a
mode that does not use it.

#### Required work

- [ ] Derive `needsWavelength` from the selected mode in the calculation hook,
  not only in the view.
- [ ] Validate wavelength and diffraction order only for Bragg/Q modes.
- [ ] Send neutral or omitted values for unused parameters, with the API
  contract made explicit.
- [ ] Add tests that place invalid text in wavelength/order, switch to each
  energy-only mode, and successfully calculate.
- [ ] Retain tests that invalid wavelength/order is rejected for modes that use
  those fields.

#### Acceptance gate

No hidden field can prevent a valid calculation, while every visible required
field is still validated.

### P2 — Keep display formatting out of chained scientific inputs

The X-ray "from E" helper currently stores `fmtNum(r.result)` into the
wavelength input. `fmtNum` honors the global 1–12 significant-figure display
preference, so a presentation setting can alter subsequent Bragg/Q results.

#### Required work

- [ ] Store the full returned value with `String(r.result)` or an equivalent
  lossless numeric representation.
- [ ] Apply `fmtNum` only when rendering result text.
- [ ] Audit all calculator cross-panel and helper-to-input handoffs for the same
  formatted-value-as-data pattern.
- [ ] Add a regression test using a low significant-figure preference and prove
  that the chained wavelength retains backend precision.

#### Acceptance gate

Changing number-display preferences cannot change calculator inputs or
downstream scientific results.

### P3 — Restore frontend dependency direction and workshop size discipline

`frontend/src/lib/api.ts` imports `SubstrateInfo` from
`components/workshops/calculators/SubstratesTab.tsx`, making the transport layer
depend on a presentation component. `useCalculators.ts` is also 680 lines,
above the repository's approximately 400-line frontend convention.

#### Required work

- [ ] Move `SubstrateInfo` into `frontend/src/lib/api/substrates.ts`, shared API
  types, or another presentation-independent contract module.
- [ ] Move the substrate endpoint wrappers out of the shrink-only `lib/api.ts`
  module and re-export them through the established API facade.
- [ ] Split `useCalculators.ts` into bounded domain hooks/modules, with shared
  cross-panel orchestration kept explicit.
- [ ] Keep `CalcTab`/navigation metadata separate from calculation state.
- [ ] Add or extend the frontend architecture test so transport modules cannot
  import calculator components and calculator workshop source files respect the
  agreed size ceiling.

#### Acceptance gate

No `lib/` transport module imports from `components/`; calculator source files
are within the documented frontend ceiling or carry a written, reviewed
exception.

## Recommended implementation order

1. Fix hidden-field validation and precision-preserving handoffs; these are
   narrow changes with direct regression tests.
2. Introduce result provenance and latest-request handling across the shared
   runner and hook-backed calculators.
3. Split the oversized hook and move substrate API types while the state
   contract is already being touched.
4. Run the MATLAB freeze campaign domain by domain, updating the checklist only
   as each golden gate becomes real.
5. Run the full repository guard suite and reconcile this plan, W4 in
   `PORT_CHECKLIST.md`, and the `PORT_PLAN.md` completion summary.

## Verification gate

Before declaring the audit plan complete, run:

```bash
uv run pytest -m golden
uv run pytest
uv run ruff check src tests
uv run mypy src
cd frontend && npm test
cd frontend && npm run typecheck
cd frontend && npm run lint
cd frontend && npm run build
```

Also run the repository `check-guards` workflow so the pure-layer rules, source
line ceilings, dependency policy, and frontend conventions are checked together.

## Completed

- 2026-08-15 — Read-only audit completed. Calculator UI tests (152), targeted
  calculator backend/API tests (357), frontend typecheck, and targeted ESLint
  passed. Four correctness/evidence findings and two architecture debts were
  identified. No implementation changes were made.
