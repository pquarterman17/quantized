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
- malformed transform parameters;
- missing explicitly referenced worksheets or transform outputs;
- stale recorded column indices while the input schema is knowable; and
- a later step blocked by a disabled or invalid creating transform.

A shape-changing transform makes the following schema unknown until execution.
Pipeline Studio deliberately does not compare those later expressions or
column references with the original input schema. Runtime step failures remain
isolated and are reported per step.

## Structural-edit preview limits

The current confirmation describes **later-step exposure**: how many enabled
steps occur after the edit and may therefore receive different input. It is not
a complete dataflow graph, numeric result preview, or unit-compatibility proof.
Those deeper previews remain tracked in the Primary Workflow Roadmap.

Structural edits are session-undoable. Duplicating a transform deep-copies its
parameters but removes recorded output dataset ids so the copy cannot claim the
original run's outputs.
