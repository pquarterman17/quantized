# CLAUDE.md: backend source (`src/quantized/`)

Root rules still apply (see [../../CLAUDE.md](../../CLAUDE.md)): pure
`datastruct.py` / `io/` / `calc/` layers, thin `routes/`, 500-line modules,
frozen `DataStruct`, one parser registry. Tests and goldens:
[../../tests/CLAUDE.md](../../tests/CLAUDE.md). Origin import:
[io/origin_project/CLAUDE.md](io/origin_project/CLAUDE.md).

Why the ceilings exist: MATLAB's `BosonPlotter.m` hit ~7k lines and
`thin_film_toolkit`'s `server.py` 5.5k. The single parser registry exists
because MATLAB's dual registration was a footgun.

## Golden-parity porting

- **Loop:** read the MATLAB source -> port to `calc/`/`io/` -> add a freeze
  case to `tools/matlab/freeze_calc_values.m` -> run MATLAB to freeze -> gate
  (`ruff check src tests tools && mypy src && pytest -q`) -> commit and tick
  `plans/PORT_CHECKLIST.md` (only when ported AND golden-verified).
- **Replicate vs delegate:** replicate MATLAB's *algorithm* for idiosyncratic
  code (its local `betainc` CDFs, `tinv` norminv+Newton, window functions, SG
  edge fits, SNIP): match the method, not just the answer. *Delegate* to
  scipy for standard published algorithms (pchip/spline/makima, `quad`,
  Nelder-Mead). When scipy has **no** equivalent (Sibson natural-neighbour),
  document the gap; never fake it.
- **MEASURE before loosening a tolerance.** Compare port vs golden in a quick
  `uv run python -c` first: `quad` vs `integral` matched ~1e-15, Nelder-Mead
  vs `fminsearch` ~1e-5..1e-16 on clean data. Most fits golden at 1e-9.
- **A golden-freeze ERROR is often a latent MATLAB bug**, not a harness
  problem (found 4: Bruker flatten, confidenceBand `NPoints {mustBePositive}=0`,
  datasetAlgebra positional-vs-named `createDataStruct`, autoGuess toolbox
  `range()`). Surface it (checklist + the `project_matlab_bugs_from_golden`
  memory), freeze the *intended* behaviour inline, port the intent. Fix the
  sibling `quantized_matlab` only deliberately (a branch + headless verify),
  never silently.
- **Physics constants port verbatim**; annotate calibrated/intentional values
  as do-not-"fix".

## mypy `--strict` + numpy

- Wrap any float64-array reassignment from a numpy op (`x**2`,
  `np.convolve`, `np.polyval`, `np.minimum`, `np.clip`, `np.linalg.*`,
  int x float) in `np.asarray(..., dtype=float)`: they infer
  `floating[Any]`/`Any`.
- No untyped lambdas in a typed context (e.g. a bridge table): use `def`s.
- Hoist `Any | None` to a narrowed typed local before numpy calls.
- Do not reuse a return variable's name for a `floating[Any]` loop
  intermediate.

## Jobs and export

- Long-running work goes through the poll-based job queue
  (`routes/jobs_api`, ~1 s GET polling, not WebSocket); only the DREAM/bumps
  fit uses it so far (import/export wiring is plan P3.4). The queue is thin
  transport; the work stays pure in `calc/`.
- Publication export (PDF/SVG) is server-side matplotlib in `routes/export`;
  vector is the default.
