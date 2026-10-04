# Pipeline Studio replay contract

Pipeline Studio edits and replays the same `macroSteps` list used by recording,
saved analysis templates, and folder/file batches. It does not execute exported
script text. The structured `kind` and `params` fields are authoritative.

## Replay classification

| Step kind | Interactive replay | Notes |
| --- | --- | --- |
| `expression` | Replayable | Adds a calculated column. With propagated uncertainty it adds both the value and sigma columns. |
| `correction` | Replayable | Applies the recorded correction settings. Referenced background worksheets must already be loaded. |
| `reset` | Replayable | Removes corrections from the current pipeline dataset. |
| `fit` | Replayable with fallbacks | Missing recorded X, Y, or uncertainty columns use the executor's documented current-selection, worksheet-X, or unweighted fallback. |
| `transform` | Replayable | May create one or more datasets and move later steps onto a new output. Recorded output ids are remapped during each run. |
| `import` | Input marker | Documents the recorded input; Pipeline Studio runs against the currently active worksheet. |
| `ui` | Display/script only | Preserved for exported scripts but skipped during interactive replay. |

Unknown or malformed kinds are removed by the established workspace/template
sanitizers before they reach the Studio.

## Preflight guarantees

Before an interactive, saved-template, or folder/file batch run, Quantized
fails closed on conditions it can determine without executing scientific work:

- no target worksheet;
- invalid expression syntax or a missing expression output name;
- missing fit model;
- missing correction background worksheet;
- correction/reset steps aimed at a source-owned derived worksheet;
- malformed transform parameters;
- missing explicitly referenced worksheets or transform outputs;
- stale recorded column indices while the input schema is knowable; and
- a later step blocked by a disabled or invalid creating transform.

A shape-changing transform makes the following schema unknown until execution.
Pipeline Studio deliberately does not compare those later expressions or
column references with the original input schema. Runtime step failures remain
isolated and are reported per step.

## Structural-edit result preview

Before a risky enable/disable, reorder, or remove is committed, the confirmation
evaluates the exact proposed step list against bounded clones. It shows the
result shape, the first three rows and four result columns, step-specific
warnings, and whether the result is complete, partial, blocked, or unavailable.
Numeric table materialization uses at most the first 20 matched rows from each
worksheet and at most 50 steps. Purpose-built transform analyzers may scan the
complete loaded inputs for warnings while still bounding their result table.
The preview never resolves a lazy Origin thumbnail as though it were full
data, calls a store action, creates a worksheet, changes selection, or adds an
undo entry. A change to the recipe, input, or loaded dataset list invalidates
the pending result; late async completions are ignored.

Expression, correction, reset, and single-output transform steps are evaluated
numerically. Fit and display/import marker steps do not replace the pipeline
table and are represented without executing their side effects. Multi-output
split, metadata promotion/cleanup, a disabled creating transform, and recipes
beyond the step cap stop with an explicit **partial preview** rather than
inventing an output. This bounded evaluation checks derived-expression units,
uncertainty bindings, saved-fit references, and transform warnings against the
proposed step order. A statically incompatible proposed recipe is blocked. A
backend outage or not-yet-loaded referenced worksheet is reported as preview
unavailable; the structural edit remains session-undoable.

Structural edits are session-undoable. Duplicating a transform deep-copies its
parameters but removes recorded output dataset ids so the copy cannot claim the
original run's outputs.

## Output lineage

A saved transformation recipe stamps each final output with the recipe name and
revision, original input, resolved column bindings, runnable-step count, and
application time in `metadata.transform_recipe`. Quantized validates that
metadata before displaying it; malformed or foreign metadata is not presented
as a Pipeline Studio result.

The active output's lineage is visible in Workflow and links to Recipe Library.
Recipe Library distinguishes an exact saved revision from a newer same-name
recipe, and says when the cited recipe is no longer saved. Editable-figure rows
show the recipe behind their live bound worksheet; frozen figures read the same
lineage from their detached data snapshot. Reports snapshot the lineage of each
referenced transformed worksheet into `report.meta` when they are created or
edited, so a report does not silently change its claimed origin after a source
worksheet changes or is removed. Older reports can display lineage from a still-
loaded referenced worksheet without mutating the saved report.

## Persistence, replay, and cancellation hardening

Template JSON is canonical: object keys, including nested step parameters,
are sorted recursively while array order remains significant. Recipe equality
uses the same canonical form, so two scientifically identical parameter maps
do not become duplicate project recipes merely because their keys were
inserted in another order. The parser accepts the original version-1 shape
with absent recipe fields and `enabled`, remints volatile step ids, trims the
name, and refuses array-valued `params` instead of interpreting their numeric
indices as parameter names.

File batches are cancellable from the shared Status Bar operation. Cancellation
is cooperative between steps and is forwarded to an in-flight upload or fit.
Already completed files and their reports remain; the current file, every
derived worksheet it created, and every undo/redo reference to those partial
worksheets are removed. When at least one file completed, Quantized creates an
explicitly labelled partial summary such as `Recipe summary (3/10, cancelled)`.
Cancellation before the first completion creates no summary. Operations that
do not expose backend cancellation finish their current await and then stop
before the next step; their current file is still rolled back.

Regression coverage includes canonical serialization and definition matching,
version-1 migration defaults, equivalent-input deterministic replay,
cancellation before a later step, exact live/history cleanup of a transformed
in-flight file, preservation of completed batch work, and a 50,000-row replay
that proves execution is not bounded by the structural-preview sample size.
