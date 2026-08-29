# DiraCulator Calculator Audit Plan

**Status:** COMPLETE — merged audit + frozen campaign; final follow-ups implemented 2026-08-28
**Created:** 2026-08-15  
**Updated:** 2026-08-28 — 94-case campaign; exact history input snapshots, Scherrer Card 6, and MATLAB-parity critical thickness close the remaining follow-ups
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

- [x] Define one calculator-result provenance contract: every displayed result
  is either current for the visible inputs or visibly marked stale.
- [x] Invalidate the relevant result and error whenever a calculation input,
  unit, mode, preset, or material selection changes.
- [x] Add a monotonically increasing request ID or equivalent latest-request
  guard to shared asynchronous calculation paths.
- [x] Prevent an older request from overwriting a newer result or recording a
  misleading history entry.
- [x] Decide whether editable inputs remain enabled while a request is pending.
  If they do, input changes must invalidate the pending result; if they do not,
  apply the disabled state consistently and accessibly.
- [x] Add deferred-promise tests proving that out-of-order completions cannot
  replace the latest result.
- [x] Add per-domain representative tests proving that changing an input clears
  or marks the prior result stale.
- [x] History entries describe the exact literal input snapshot used. New
  records require an `inputs` description at compile time; every calculator
  call site supplies it, while legacy persisted records remain readable.

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

- [x] Inventory every checked W4 calculator domain and map each operation to
  its `DiraCulator.m` or `+calc` source location.
- [x] Classify each operation as already golden-frozen, reference-only, new
  Python behavior with no MATLAB counterpart, or an intentional MATLAB bug fix.
- [x] Add inline cases (in the new `tools/matlab/freeze_diraculator_values.m` — same style, campaign-scoped) for every
  reference-only MATLAB-backed operation.
- [x] Freeze outputs from the authoritative `../quantized_matlab` commit and
  record that commit plus tolerances in the golden manifest. The 93-case
  campaign was frozen from
  `aee70d12ddd13024a33ac8d29fafbd3245442c7e` by
  `tools/matlab/freeze_diraculator_values.m`; its provenance is recorded in
  `tests/golden/manifest.json`, and `uv run pytest -m golden` passes all 248
  golden tests with zero skips. Applicable PORT_CHECKLIST entries are restored
  to `[x]`; Thin Film and Substrates remain `[~]` only for their explicitly
  tracked feature/formula follow-ups.
- [x] Add `@pytest.mark.golden` coverage that calls the same pure functions used
  by the routes.
- [x] For intentional departures from MATLAB bugs, freeze and document the
  intended behavior explicitly rather than silently treating a textbook value
  as parity evidence.
- [x] Mark Python-only calculators such as the neutron multi-quantity helper as
  extensions, not MATLAB-parity claims.
- [x] Temporarily change unsupported `[x]` checklist entries to `[~]`, or add a
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

- [x] Derive `needsWavelength` from the selected mode in the calculation hook,
  not only in the view.
- [x] Validate wavelength and diffraction order only for Bragg/Q modes.
- [x] Send neutral or omitted values for unused parameters, with the API
  contract made explicit.
- [x] Add tests that place invalid text in wavelength/order, switch to each
  energy-only mode, and successfully calculate.
- [x] Retain tests that invalid wavelength/order is rejected for modes that use
  those fields.

#### Acceptance gate

No hidden field can prevent a valid calculation, while every visible required
field is still validated.

### P2 — Keep display formatting out of chained scientific inputs

The X-ray "from E" helper currently stores `fmtNum(r.result)` into the
wavelength input. `fmtNum` honors the global 1–12 significant-figure display
preference, so a presentation setting can alter subsequent Bragg/Q results.

#### Required work

- [x] Store the full returned value with `String(r.result)` or an equivalent
  lossless numeric representation.
- [x] Apply `fmtNum` only when rendering result text.
- [x] Audit all calculator cross-panel and helper-to-input handoffs for the same
  formatted-value-as-data pattern.
- [x] Add a regression test using a low significant-figure preference and prove
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

- [x] Move `SubstrateInfo` into `frontend/src/lib/api/substrates.ts`, shared API
  types, or another presentation-independent contract module.
- [x] Move the substrate endpoint wrappers out of the shrink-only `lib/api.ts`
  module and re-export them through the established API facade.
- [x] Split `useCalculators.ts` into bounded domain hooks/modules, with shared
  cross-panel orchestration kept explicit.
- [x] Keep `CalcTab`/navigation metadata separate from calculation state.
- [x] Add or extend the frontend architecture test so transport modules cannot
  import calculator components and calculator workshop source files respect the
  agreed size ceiling.

#### Acceptance gate

No `lib/` transport module imports from `components/`; calculator source files
are within the documented frontend ceiling or carry a written, reviewed
exception.

## Follow-ups

- [x] **History input-snapshot capture** — exact invocation-time text is stored
  separately from the formatted result and shown in History/Favorites.
- [x] **`substrates.critical_thickness` parity** — resolved in favor of the
  repository's behavioral authority: the MATLAB method and API contract are
  ported exactly, and both pre-existing frozen cases now assert parity.
- [x] **Scherrer grain-size port** — calc, route, card, and MATLAB GUI-formula
  golden case completed.

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
- 2026-08-15 — **Implementation pass (branch `claude/diraculator-audit`).**
  - **P2 both shipped**: `xrayCompute` derives `needsWavelength` in the hook and
    sends neutral `w=0, n=1` for the energy-only modes (hidden fields never
    validated); the `→ λ` helper and the Substrates mismatch→Matthews-Blakeslee
    chain hand off `String(raw)` — regression tests cover poisoned hidden
    fields and a 3-sig-fig display preference.
  - **P1 provenance shipped**: `makeCardRunner` replaced by `useCard(domain)`
    (per-card monotonic request id; `run` drops superseded completions,
    success and error alike; `touch` wired into every input; side-effects
    gated via `isCurrent()`); all 13 card files + SubstratesTab converted;
    the four shared-state hooks got per-family seq guards with field-aware
    invalidation on the crystal form. Decision point resolved as: inputs
    stay editable while pending — editing invalidates. Deferred-promise race
    suites: `shared.test.tsx` + `useCalculatorsProvenance.test.ts`.
    *Honest partial on the acceptance gate*: history can no longer record a
    misleading entry (only the owning completion records), but most card
    summaries still do not embed the full input snapshot text — enriching
    `record()` with an inputs description is a follow-up sweep, not claimed.
  - **P3 shipped**: `useCalculators.ts` (681-line pin, now graduated) split
    into `useUnitsCalc`/`useXrayCalc`/`useCrystalCalc`/`useSldCalc` behind an
    unchanged facade; `SubstrateInfo` + all `/api/substrates/*` wrappers moved
    to `lib/api/substrates.ts`; architecture guard added (hard ban on
    `lib/api*` importing `components/`, shrink-only grandfather ratchet for
    the 11 pre-existing command-glue importers).
  - **P1 parity campaign staged** (MATLAB unavailable in the container — the
    freeze run itself is the one remaining owner step): all 12 domains
    inventoried and classified against upstream `quantized_matlab@aee70d12`;
    93 freeze cases assembled into `tools/matlab/freeze_diraculator_values.m`
    in exact bijection with 93 staged `@pytest.mark.golden` tests across 12
    new `tests/test_calc_*_golden.py` files (all skip via `load_golden` until
    frozen); extensions labeled (van_der_pauw, sauerbrey, bcs_gap, c_profile,
    neutron_calc, energy↔λ standalone modes, periodictable-backed SLD);
    intentional divergences staged transparently (Curie-Weiss μ_eff ×100,
    domain-wall ×10); PORT_CHECKLIST W4 flipped `[x]`→`[~]` for the twelve
    domains.
  - **New findings surfaced by the campaign**: (1) MATLAB Thin Film Card 6
    Scherrer grain size was never ported (new PORT_CHECKLIST item);
    (2) `substrates.critical_thickness` disagrees with MATLAB
    `+calc/+crystal/criticalThickness.m` four independent ways (~17.5× where
    both compute; ValueError on MATLAB's own docstring example) — owner
    decision needed on the intended formula before freezing that op;
    (3) the sputterYield "bug" is confined to the MATLAB GUI call site — the
    `+calc` function was always correct.
- 2026-08-16 — **Review round 2 (ChatGPT-Sol, on PR #143), verified-then-fixed.**
  - CONFIRMED: `XrayTab.tsx`'s local Energy→λ helper sat outside the
    provenance guard — no request identity, unconditional `setWavelength` on
    resolve, `finally` cleared busy regardless of ownership. Reproduced
    red-first with two deferred-request component tests (edit-while-pending;
    overlapping helper requests resolving out of order), then fixed with the
    cards' contract: monotonic request id, energy edits disown pending
    requests (and re-arm the button), disowned completions write nothing —
    value, error, and busy alike.
  - Documentation reconciliation: the twelve staged golden-test docstrings
    now all point to `tools/matlab/freeze_diraculator_values.m` (they
    described the pre-assembly scratchpad snippets); the plan Status line and
    the new "Open follow-ups" section state explicitly that the 93 cases are
    staged scaffolding until the owner freeze, and the history
    input-snapshot remainder is an unchecked acceptance-gate item rather
    than a Completed-log footnote.
- 2026-08-16 — **Merged** as PR #143 (`ebe06c3`) on the owner's instruction,
  after review round 2 (Energy→λ helper provenance + doc reconciliation) was
  verified-then-fixed and CI-green (run 918). The stacked PR #144 (D2)
  merged immediately after (`565bf08`).
- 2026-08-21 — **MATLAB freeze completed** (`5f9054b1`). All 93 DiraCulator
  cases were frozen from
  `quantized_matlab@aee70d12ddd13024a33ac8d29fafbd3245442c7e`; the repository
  golden suite now passes 248 tests with zero skips.
- 2026-08-22 — **Post-sprint critical review remediation.** Protected both
  directions of the Optics n,k↔epsilon card from stale response side effects,
  added deferred-request regressions, recorded the freeze campaign's source
  commit/tolerances in the golden manifest with a coverage guard, and
  reconciled this plan, the W4 checklist, and all twelve campaign test
  docstrings. History input snapshots, the critical-thickness formula decision,
  and the Scherrer port remain explicitly open.
- 2026-08-28 — **Final follow-ups complete.** Required exact invocation-time
  input descriptions across all calculator history producers and surfaced them
  in History/Favorites; ported Thin Film Card 6 Scherrer grain size through the
  pure calc, thin route, React card, and a newly frozen MATLAB GUI-formula case
  (campaign 93→94); resolved `critical_thickness` using the repository's
  behavioral authority and converted both existing divergence fixtures into
  passing method-parity tests. No release was cut.
