---
name: gate
description: Run the quantized check + build gate the way CI does (ruff, mypy, pytest, eslint, vitest, tsc -b, vite build + bundle budget, optional Origin corpus check) and avoid the known false-green traps. Use before claiming a change is green, before a PR, or when CI disagrees with a local run.
---

# Gate (as CI runs it)

`tools/gate.py` is the single source of truth for the steps. CI runs them on
ubuntu/windows/macOS x py3.11/3.13 plus frontend and e2e jobs, from a clean
install.

## 1. Make the environment match the lockfiles (cheap, deterministic)

```bash
uv sync --check --group dev || uv sync --group dev        # exit 1 = drifted
cd frontend && npm ci && cd ..                            # always before a build whose numbers you trust
```

Container resets can restore stale `.venv`/`node_modules`; directory mtimes
mean nothing. `npm ci` also clears vite's transform cache, which once served
stale output for the edited files and under-reported the bundle by 436 bytes.

## 2. Run it, saving the FULL log

```bash
uv run python tools/gate.py 2>&1 | tee <scratch>/gate.log; echo "exit=${PIPESTATUS[0]}"
rg -n 'FAILED|FAIL |Error|error TS' <scratch>/gate.log
```

- `cmd | tail; echo $?` reports TAIL's status. Use `${PIPESTATUS[0]}` or
  redirect to a file and check `$?` directly.
- Never filter the only copy of a log; a `| tail -5` once lost a flaky
  test's name.
- Flags: `--backend-only`, `--frontend-only`, `--skip-tests`; `--origin`
  for Origin import changes (see the `origin-change` skill).

## 3. Memory-safe manual steps (shared or small boxes)

```bash
uv run ruff check src tests tools          # tools too: CI lints all three
uv run mypy src
uv run pytest -q -n 4 -p no:cacheprovider  # -n 4, not -n auto
cd frontend && npm run lint && npx vitest run --maxWorkers=3
npx tsc -b --force                         # tsc -b is incremental; a cached pass means nothing
npm run build                              # includes the bundle-size ratchet
```

`npx tsc --noEmit -p tsconfig.json` is NOT the CI check (misses project
references).

## 4. Leaked vitest temp dirs

A killed or timed-out vitest run leaks ~80 MB into `$TMPDIR/<21-char nanoid>/`
(1,100 dirs / 28 GB once filled the disk and stalled six agents). Let runs
finish. When disk is low:

```bash
find /tmp -maxdepth 1 -type d -regextype posix-extended \
  -regex '/tmp/[A-Za-z0-9_-]{21}' -mmin +30 -exec rm -rf {} +
```

The class must include `_` and `-` (nanoid alphabet), or half are missed.

## 5. When CI disagrees

Read the failing job with `mcp__github__get_job_logs`. A `curl` through the
proxy can die mid-transfer and leave a truncated log describing a different,
stale failure: verify the download completed before diagnosing.
