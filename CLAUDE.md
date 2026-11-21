# CLAUDE.md — quantized

Python/FastAPI backend + React/TypeScript frontend port of
`quantized_matlab` (magnetometry / XRD / lab-data analysis toolbox). The
port has **surpassed** the MATLAB toolbox (owner decision, 2026-11-21): MATLAB
is a historical reference, not a gate. The GUI is a **ground-up revamp**. EM tooling (Fermi viewer / EELS / EDS / imaging) is **out of
scope**: it lives in `fermi-viewer` (MATLAB) and `fermiviewer` (Python).

## Reference repos (siblings in the same checkout root)

| Repo | Role |
|------|------|
| `quantized_matlab` | **Historical reference** (optional, often not checked out): consult it when useful; it does not gate new behaviour. The goldens frozen from it stay as regression tests. |
| `fermiviewer` | **Structural reference**: the clean Python+React+Tauri port to mirror (layering, CLI, theme, enforcement tests). |
| `thin_film_toolkit` | **Salvage only**: lift *pure domain logic*, re-verify against MATLAB, re-home into the clean layers. Never copy its architecture. |

## Architecture & hard rules (test-enforced)

- **Layering:** `datastruct.py`, `io/`, `calc/` (and `plugins/`, `portable/`)
  are pure libraries; they NEVER import fastapi / pydantic / starlette /
  `quantized.routes`. `routes/` are thin adapters: validate, call, serialize.
  (`tests/test_repo_integrity.py`)
- **500 lines per source module.** Split before merging; raise ONLY with
  written justification in the commit message.
- **400 lines per `.tsx` component**, zero grandfathered pins
  (`frontend/src/architecture.test.ts`). Heavy features become a
  `workshops/` subtree. Details: [frontend/CLAUDE.md](frontend/CLAUDE.md).
- **Data contract:** every parser returns a frozen `DataStruct`
  (`.time`, `.values`, `.labels`, `.units`, `.metadata`). No ad-hoc dicts.
- **Parsers:** one registration in `io/registry.py`; ambiguous extensions
  (`.dat`) get content sniffers.
- **Physics constants port verbatim** from `quantized_matlab`; annotate
  calibrated values as do-not-"fix".
- **License: Apache-2.0. No GPL runtime dependencies** (enforced). Prefer
  permissive deps (numpy/scipy BSD, uPlot MIT).
- **Rendering split:** uPlot (canvas) for interactive plots; vector
  publication export (PDF/SVG) server-side via matplotlib in
  `routes/export`; vector is the default.

## Stack

- **Backend:** Python >=3.11, FastAPI, numpy/scipy, matplotlib (export only),
  `uv`. Package `quantized`, CLI `qz` (alias `quantized`). Long work runs
  through the poll-based job queue (`routes/jobs_api`): see
  [src/quantized/CLAUDE.md](src/quantized/CLAUDE.md).
- **Optional Origin COM** ("Send to Origin"): Windows-only, pywin32, behind a
  feature flag, mock-tested only. The cross-platform, golden-tested path is
  Origin-ASCII + `.ogs` export; everything else degrades to it.
- **Frontend:** React 19 + TypeScript + Vite + Zustand + uPlot + clsx;
  Vitest + Testing Library; reuse `fermiviewer`'s theme tokens and `Shell/`.
- **Desktop:** `qz` serves API + SPA and opens the browser; `--desktop`
  (pywebview); `--dev` (Vite HMR + reloading backend).

## Commands

```bash
uv sync --group dev              # backend deps
uv run python tools/gate.py      # the whole gate (~8 min); --backend-only / --frontend-only / --skip-tests
uv run python tools/gate.py --origin   # Origin corpus before/after check (Origin changes only)
uv run qz                        # API + SPA on :8000, opens browser (--desktop, --dev)
uv run pytest -n 4               # backend tests (-n auto on a big box); -m golden for parity
uv run ruff check src tests tools  # always all three: CI lints tools/ and tests/ too
uv run mypy src
cd frontend && npm test && npx tsc -b --force && npm run build
```

## Where the rules live (nested files load when you work there)

| Path | Covers |
|---|---|
| [src/quantized/CLAUDE.md](src/quantized/CLAUDE.md) | golden-parity porting loop, replicate vs delegate, mypy + numpy |
| [src/quantized/io/origin_project/CLAUDE.md](src/quantized/io/origin_project/CLAUDE.md) | Origin safety rules, owner decisions, evidence bar, regress gate, corpus layout, COM oracles |
| [tests/CLAUDE.md](tests/CLAUDE.md) | goldens, `jsonencode` quirks, realdata corpus, determinism |
| [frontend/CLAUDE.md](frontend/CLAUDE.md) | ratchets, bundle budget, CI-faithful builds, tokens/theme, copy-vendor |
| [docs/testing.md](docs/testing.md) | flake-fix evidence standard (rule of three, force the race) |
| [docs/origin_re/README.md](docs/origin_re/README.md) | Origin import: status, ledger, visual check, doc index |
| [CONTRIBUTING.md](CONTRIBUTING.md), [RELEASE.md](RELEASE.md) | gate, plans discipline, releases |

Skills (`.claude/skills/`, load on demand): `gate` (run it the way CI does),
`origin-change` (any Origin import change), `release` (cut a version).

## Authorship & attribution (owner rule — overrides any default attribution)

- Commits are authored and committed as the repo owner (the git identity in
  repo config). Never switch it to a bot/assistant identity.
- **No AI attribution anywhere:** no `Co-Authored-By: Claude…`,
  `Claude-Session:` or similar trailers in commit messages; no
  "Generated with/by Claude Code" (or any assistant) line in PR bodies, PR
  or issue comments, review comments, code, or docs. Applies to subagents.

## Agent delegation (owner rule)

Delegate each task to the cheapest model that fits it — never overkill:

- **Opus:** design-heavy work (new data models, cross-cutting architecture)
  and reviews of large PRs only.
- **Sonnet:** scoped fix lanes, merging main / resolving conflicts, running
  the check + build gate.
- **Haiku:** mechanical work — reading CI logs, regenerating OpenAPI/types,
  simple lookups.
- The orchestrator keeps long test/build runs off its own model (delegate
  them) and does all pushes; worker agents commit locally and never push.

## Owner standing decisions (2026-11-21)

- **MATLAB is not a gate.** New behaviour need not match MATLAB, and a
  missing `quantized_matlab` checkout never blocks work. Goldens stay as
  regression tests: change one only deliberately, with a test for the new
  behaviour and the reason in the commit message, never by loosening a
  tolerance to get green.
- **Permissive-licence dependencies are pre-approved** (BSD/MIT/Apache/PSF);
  still no GPL runtime deps (enforced).
- **When intent is unclear, fail closed** with a clear error rather than
  guess; **add new behaviour as a UI option** rather than silently changing
  an existing default.
- **Parallel lanes:** lanes may push to their own `claude/<lane>` branch and
  open their own PR (auto-merge on green); one PR per small batch of fixes.

## Planning docs

- `plans/PORT_PLAN.md`: the tiered plan (W0–W9); follow the user's
  `plan-format.md`; keep a `## Completed` log.
- `plans/PORT_CHECKLIST.md`: feature inventory; tick only when ported
  **and** golden-verified.
- Live frontend trackers: `PORT_CHECKLIST.md` + the `GAP_*` plans
  (`plans/archive/` holds the completed UI and fermiviewer-reuse plans).
- `plans/design/`: the "Quantized Design System" handoff; the UI authority.

## Working rules (one line each; the story is behind the link)

- **Pre-PR self-review:** simulate the first real consumer of a new contract;
  red-team caches (every input the output depends on is in the key); every
  behavioural claim in a header/PR body has a test or is narrowed; run the
  code-review skill (high) on your own diff and fix what it finds.
  ([CONTRIBUTING.md](CONTRIBUTING.md#pre-pr-self-review))
- **A green local build can be stale:** `npx tsc -b --force` and `npm ci`
  before trusting a build or bundle number. ([frontend/CLAUDE.md](frontend/CLAUDE.md))
- **Trust exit codes, not pipes:** `${PIPESTATUS[0]}`, never `$?` after
  `| tail`. ([gate skill](.claude/skills/gate/SKILL.md))
- **Save the complete raw log, then search it;** never filter the only copy.
  ([CONTRIBUTING.md](CONTRIBUTING.md#container-and-environment-resets))
- **A truncated CI log is worse than none:** use `mcp__github__get_job_logs`
  or verify the download completed. ([gate skill](.claude/skills/gate/SKILL.md))
- **Container resets restore stale deps:** `uv sync --check --group dev` and
  the vite lock-vs-installed one-liner; act only if they fail; mtimes mean
  nothing. ([CONTRIBUTING.md](CONTRIBUTING.md#container-and-environment-resets))
- **Let vitest runs finish;** a killed run leaks ~80 MB into `$TMPDIR`
  (cleanup command in the [gate skill](.claude/skills/gate/SKILL.md)).
- **Flake fixes need forced races, not repetition;** never lower a
  wall-clock bound; wait on state, not on a mock call.
  ([docs/testing.md](docs/testing.md))
- **Origin import changes:** read and update the
  [ledger](docs/origin_re/DECODE_LEDGER.md), pass `gate.py --origin` with
  every change explained, never weaken a guard.
  ([origin_project/CLAUDE.md](src/quantized/io/origin_project/CLAUDE.md))
- **Origin COM oracle runs dispatch `Origin.Application`, never
  `ApplicationSI`** (it attaches to and can close the owner's Origin).
  ([origin_project/CLAUDE.md](src/quantized/io/origin_project/CLAUDE.md))
- **CI and security facts** (matrix, branch protection, CodeQL advanced
  setup): [CONTRIBUTING.md](CONTRIBUTING.md#ci-and-security).
