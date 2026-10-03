# Primary Workflow Roadmap

Last updated: 2026-10-03

This roadmap tracks three large workflow improvements in the agreed order. It is intentionally outcome-based: completing a checkbox means the behavior is implemented and tested, not merely that a control exists.

## 1. Technique-aware analysis workspace

Goal: turn an imported worksheet into an understandable path from inspection through analysis, figure creation, and reuse without hiding the underlying tools or making scientific guesses.

- [x] Add a full-stage **Workflow** view that follows the active worksheet.
- [x] Cover the complete technique vocabulary: SIMS, powder XRD, XRD RSM, reflectometry, M-vs-H, M-vs-T, transport, spectroscopy, and generic data.
- [x] Show the recorded technique, dimensions, x-axis metadata, parser provenance, lazy/full-data state, and existing result artifacts.
- [x] Keep generic data honest: offer general tools and explicitly state that the technique was not identified.
- [x] Reuse canonical command labels and launch paths rather than duplicating analysis implementations.
- [x] Add SIMS deep links for Process, Compare, and Region instead of always opening the first tab.
- [x] Resolve lazy Origin books before plotting or analysis; cancel if the active worksheet changes during the load.
- [x] Make the loading placeholder and loaded workspace obey the shared Escape ordering.
- [x] Keep the workflow lazy and within the eager bundle budget.
- [x] Add a worksheet context action and preserve explicit plot-intent routing back to Plot/Map.
- [ ] Manual sign-off with representative SIMS, XRD, reflectometry, magnetometry, and generic files.
- [ ] Revisit the action order and stage descriptions after several real analysis sessions.

Acceptance: a user can select a worksheet, understand why a workflow was chosen, reach the appropriate existing tools in one click, and never run an analysis on a lazy preview or a newly selected replacement dataset.

## 2. Origin Project Migration Cockpit

Goal: replace the current “large imported tree plus unresolved graph controls” experience with a guided project-level review that distinguishes recovered, approximate, unresolved, and non-actionable content.

- [x] Define a project-level migration summary from the existing Origin fidelity manifest, book families, graph records, saved previews, omissions, and lazy-book inventory.
- [x] Present a compact first screen: recovered worksheets/graphs, items needing review, unsupported items, and safe recommended next actions.
- [x] Group unresolved graphs by cause and source workbook rather than showing repeated flat “Choose source…” rows.
- [ ] Add bulk resolution where one source choice can safely resolve repeated graph/layer references; always preview scope before applying.
- [x] Distinguish an empty graph from a failed graph and explain the reason inline.
- [x] Provide direct routes to the relevant workbook, worksheet, reconstructed graph, saved Origin preview, or fidelity details.
- [x] Preserve lazy-loading guarantees: inventory is cheap; opening or converting a book resolves full data through the canonical resolver.
- [x] Add “review later” state without discarding unresolved records.
- [ ] Add real-corpus characterization tests for small, large, partially decoded, and offline/missing-source projects.
- [ ] Run the cockpit against the local Origin test-data corpus and at least one representative user project.

Acceptance: after opening an Origin project, the user can tell what imported successfully, what needs a decision, what cannot yet be reproduced, and how to reach the important work without parsing a crowded tree.

## 3. Pipeline Studio 2.0

Goal: make reproducible transformations understandable and editable as a workflow, while preserving raw data and failing closed when dependencies or schemas no longer match.

- [x] Audit the current recorded-step and recalculation model; document which operations are replayable, partially replayable, or display-only.
- [x] Add an overview that shows inputs, ordered steps, outputs, stale/broken state, and downstream impact.
- [x] Make each step inspectable and editable with a human-readable summary plus exact parameters.
- [x] Add safe enable/disable, reorder, duplicate, and remove operations with dependency validation and undo.
- [ ] Preview the result and warnings before committing a structural pipeline edit.
- [ ] Explain broken inputs, missing datasets, changed columns, and incompatible units at the affected step.
- [ ] Support saved pipeline templates with explicit compatibility checks and no automatic overwrite of customized plots or data.
- [ ] Connect pipeline outputs to the Workflow view, Recipe Library, and report/figure provenance.
- [ ] Add deterministic replay, serialization, migration, cancellation, and large-data tests.

Progress — 2026-10-03, Pipeline Studio 2.0 pass:

- The panel now distinguishes runnable, input/script-only, disabled, invalid, and downstream-blocked steps before a run. It shows the active input shape, ordered human-readable summaries, exact editable parameters, the output and created worksheets from the last run, and per-step/run outcomes.
- Structural enable/disable, reorder, duplicate, remove, add-expression, parameter edit, and template-load operations are session-undoable. Operations that can change downstream input show an explicit impact confirmation first; duplicate parameters are deep-copied.
- Preflight fails closed on absent inputs, missing referenced worksheets/backgrounds, invalid expressions/models, malformed transform settings, and stale column indices. It deliberately defers schema checks after a shape-changing transform rather than comparing them with the wrong original schema.
- Remaining for the two partial boxes above: compute a bounded data/result preview before a structural edit (the current preview explains dependency impact, not numeric output), and add unit-compatibility diagnostics where they can be determined without executing an expensive transform. Cancellation and representative large-data replay coverage also remain open.

Acceptance: a user can understand and safely modify how a derived dataset was produced, rerun it deterministically, and recover from changed inputs without touching the original raw data.

## Review discipline for every section

- [ ] Add characterization tests before changing an established workflow.
- [ ] Test stale selection, deleted/reused ids, lazy Origin data, cancellation, and repeated clicks.
- [ ] Verify opening/cancelling does not mutate raw or scientific state.
- [ ] Run typecheck, lint, focused tests, architecture ratchets, production build, and bundle-size gate.
- [ ] Exercise representative files from the sibling `test-data` corpus where the feature touches import or technique behavior.
- [ ] Perform a second adversarial review before requesting external review.
