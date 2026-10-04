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
