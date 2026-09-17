// Guard against the `--check` regression found 2026-09-15:
// `scripts/freeze-regression-matrix.mjs --check` silently REWROTE stale
// goldens and always exited 0. Root cause: `--check` was read from
// `process.argv` at module scope, but the projection actually runs inside a
// forked/threaded vitest worker (`startVitest` re-enters the script through
// its own Node API — see the comment block at the top of the script) whose
// OWN `argv` never carries `--check`, so the worker always took the write
// path and `expect(stale).toEqual([])` passed vacuously on an empty array.
//
// This spawns the REAL script as a subprocess against a throwaway directory
// (never the committed goldens under `__fixtures__/regressionMatrix/`, so
// there is nothing here for a parallel vitest worker running
// `regressionMatrix.test.ts` to race with) and drives exactly the sabotage
// probe that exposed the bug: hand-perturb a golden, then assert `--check`
// (a) is read-only, (b) fails non-zero, and (c) names the stale file — with
// write mode still regenerating byte-identically afterward.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

/** Walk up from the runner's cwd to the directory holding `package.json`.
 *  Not `fileURLToPath(import.meta.url)`: under vitest a test module's URL
 *  comes from vite's module graph and is not a `file:` URL at all (see the
 *  same note in `buildInfo.test.ts`). */
function findUp(marker: string): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, marker))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`no ${marker} above ${process.cwd()}`);
    dir = up;
  }
}

const frontendDir = findUp("package.json");
const scriptPath = join(frontendDir, "scripts", "freeze-regression-matrix.mjs");

interface RunResult {
  status: number;
  output: string;
}

/** Runs the real script against `fixtureDir` (via the test-only
 *  `FREEZE_REGRESSION_MATRIX_FIXTURE_DIR` override) instead of the committed
 *  goldens, returning its exit code and combined stdout+stderr. */
function runScript(fixtureDir: string, args: string[]): RunResult {
  // This test itself runs INSIDE a vitest worker, so `process.env.VITEST` is
  // already set — exactly the condition the script's own top-level `if
  // (process.env.VITEST)` branches on. Naively inheriting it would make the
  // freshly-spawned process skip its entry point (`startVitest`) entirely and
  // try to call `it()` with no suite running. Strip it (and vitest's other
  // worker-identity vars) so the child starts as a real entry process.
  const { VITEST: _vitest, VITEST_POOL_ID: _poolId, VITEST_WORKER_ID: _workerId, ...cleanEnv } =
    process.env;
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd: frontendDir,
      encoding: "utf8",
      env: { ...cleanEnv, FREEZE_REGRESSION_MATRIX_FIXTURE_DIR: fixtureDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const failure = error as { status: number | null; stdout: string; stderr: string };
    return { status: failure.status ?? 1, output: `${failure.stdout}${failure.stderr}` };
  }
}

describe("freeze-regression-matrix.mjs --check", () => {
  it(
    "is read-only and fails on a stale golden, and write mode still regenerates it",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "freeze-regression-matrix-"));
      try {
        // 1. Write mode against an empty directory creates every golden,
        //    `plain.json` included.
        const seeded = runScript(dir, []);
        expect(seeded.status).toBe(0);
        const plainPath = join(dir, "plain.json");
        expect(existsSync(plainPath)).toBe(true);
        const fresh = readFileSync(plainPath, "utf8");

        // 2. The sabotage probe: hand-perturb one number in the golden.
        const perturbed = fresh.replace('"width": 2,', '"width": 999,');
        expect(perturbed).not.toBe(fresh);
        writeFileSync(plainPath, perturbed);

        // 3. --check must be READ-ONLY, exit non-zero, and name the stale file.
        const checked = runScript(dir, ["--check"]);
        expect(checked.status).not.toBe(0);
        expect(checked.output).toContain("plain.json");
        expect(readFileSync(plainPath, "utf8")).toBe(perturbed);

        // 4. Write mode regenerates it byte-identically to the first run.
        const rewritten = runScript(dir, []);
        expect(rewritten.status).toBe(0);
        expect(readFileSync(plainPath, "utf8")).toBe(fresh);

        // 5. --check on the now-clean directory passes without writing.
        const rechecked = runScript(dir, ["--check"]);
        expect(rechecked.status).toBe(0);
        expect(readFileSync(plainPath, "utf8")).toBe(fresh);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    // Each of the 4 `runScript` calls above boots a REAL nested vitest run
    // (see the script's own comment block on why it re-enters through
    // `startVitest`), so this test's actual work is "start a full test
    // runner from cold four times in a row". Alone that is ~15-20s; under a
    // scoped gate with several concurrent agents and 7,700+ other tests
    // competing for the box, measured elapsed climbed to 30-42s and tripped
    // the old 30s bound (`Error: Test timed out in 30000ms.`) even though
    // every assertion above it — read-only-ness, the non-zero exit, the
    // stale-file name, and the byte-identical regenerate — was never in
    // doubt. This bound is a loose wall-clock backstop for a hung process,
    // not a check on load; per docs/testing.md, never lower it.
    180_000,
  );
});
