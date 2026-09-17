// Regenerate the P4.2 regression-matrix goldens under
// `src/lib/__fixtures__/regressionMatrix/` from the TS fixture builders.
//
//   cd frontend && node scripts/freeze-regression-matrix.mjs
//   cd frontend && node scripts/freeze-regression-matrix.mjs --check
//
// WHY A COMMITTED SCRIPT (review 2026-09-14). The goldens follow
// `roiMath.golden.json`'s precedent for frozen frontend fixtures — and that
// precedent ships a committed generator (`tools/freeze_roi_preview_fixture.py`,
// named in `roiMath.golden.test.ts`). This file's predecessor was a paragraph
// of prose telling the next person to "temporarily add a test that writes the
// projection, run it, delete it": unreviewed, easy to get wrong, and sitting on
// exactly the spot where "just refresh the golden" is most tempting. `--check`
// regenerates in memory and diffs against the committed bytes without writing,
// which is what the reviewer of a golden change should run.
//
// WHY IT RE-ENTERS THROUGH VITEST. The projection is TypeScript that imports
// half of `src/lib` and needs a DOM (`installSeriesPalette` writes the
// `--series-N` custom properties on `document.documentElement`, and `buildOpts`
// reads them back through `getComputedStyle`). Plain `node` can neither resolve
// the extensionless TS imports nor supply that DOM, and vitest refuses a file
// filter outside its configured `include` (`src/**/*.test.{ts,tsx}`) — measured,
// it prints "No test files found". So the entry point starts vitest through its
// Node API with `include` pointed back at THIS file, and the `VITEST` branch
// below is the body that then runs inside jsdom. One file, no throwaway test,
// no second config.
//
// WHY `--check` TRAVELS AS AN ENV VAR, NOT `process.argv` (bug found
// 2026-09-15: `--check` re-froze the goldens and exited 0 every time). The
// test BODY below does not run in this process — `startVitest` runs it in a
// separate forked/threaded worker from its pool, with the worker's OWN
// `argv` (vitest's, not ours), so `process.argv.includes("--check")` inside
// the `VITEST` branch always read false and silently took the WRITE path.
// A Node worker (fork or `worker_threads`) inherits a COPY of `process.env`
// taken at spawn time, so setting `FREEZE_CHECK` here, before `startVitest`
// spawns the pool, is what actually crosses that boundary.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");
// `FREEZE_REGRESSION_MATRIX_FIXTURE_DIR` is a test-only escape hatch (see
// `src/lib/freezeRegressionMatrixCheck.test.ts`) so the --check/write guard
// can run against a throwaway directory instead of the real committed
// goldens; unset in every normal invocation. It reaches the worker the same
// way `FREEZE_CHECK` does — inherited at fork time, computed identically in
// both processes — so no separate threading is needed here.
const FIXTURE_DIR =
  process.env.FREEZE_REGRESSION_MATRIX_FIXTURE_DIR ??
  join(FRONTEND, "src", "lib", "__fixtures__", "regressionMatrix");
const SELF = "scripts/freeze-regression-matrix.mjs";
// Inside the vitest worker (`process.env.VITEST`), trust ONLY the env var the
// entry point threaded through — that worker's `process.argv` cannot carry
// `--check` (see the comment block above). Outside it, `process.argv` is the
// one true source.
const CHECK = process.env.VITEST ? process.env.FREEZE_CHECK === "1" : process.argv.includes("--check");

/** The exact on-disk form of every golden: 2-space JSON, one trailing LF. */
function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

if (process.env.VITEST) {
  const { it, expect } = await import("vitest");
  const { installSeriesPalette } = await import("../src/lib/regressionMatrix.testkit.ts");
  const { MATRIX_FIXTURES, matrixDataset, matrixFixture, pageFigures, pageFixture } = await import(
    "../src/lib/regressionMatrixFixtures.testkit.ts"
  );
  const { projectScreen } = await import("../src/lib/regressionMatrixLegs.testkit.ts");
  const { projectScreenPage } = await import("../src/lib/regressionMatrixPage.testkit.ts");

  it(CHECK ? "regression-matrix goldens are up to date" : "freezes the regression-matrix goldens", () => {
    const restore = installSeriesPalette();
    let written = 0;
    const stale = [];
    try {
      const dataset = matrixDataset();
      const figures = pageFigures();
      const frozen = new Map();
      for (const name of MATRIX_FIXTURES) {
        frozen.set(name, serialize(projectScreen(matrixFixture(name), dataset)));
      }
      frozen.set("page", serialize(projectScreenPage(pageFixture(figures), figures)));

      if (!CHECK) {
        // Write mode may target a fixture dir that doesn't exist yet (a
        // brand-new checkout, or the guard test's throwaway directory).
        mkdirSync(FIXTURE_DIR, { recursive: true });
      }
      for (const [name, text] of frozen) {
        const path = join(FIXTURE_DIR, `${name}.json`);
        let current = null;
        try {
          current = readFileSync(path, "utf8");
        } catch {
          current = null;
        }
        if (current === text) continue;
        if (CHECK) {
          stale.push(name);
          continue;
        }
        writeFileSync(path, text);
        written += 1;
        console.log(`wrote ${name}.json`);
      }
      if (!CHECK && written === 0) {
        console.log(`all ${frozen.size} goldens already byte-identical`);
      }
    } finally {
      restore();
    }
    // In --check mode a stale golden is a FAILURE, so the script's exit code
    // means something to CI or to a reviewer. Name every stale file BEFORE
    // the assertion throws, so the list survives even if a caller only reads
    // stdout/stderr rather than the (also non-zero) exit code.
    if (CHECK && stale.length > 0) {
      console.error(`stale golden(s): ${stale.map((name) => `${name}.json`).join(", ")}`);
    }
    expect(stale).toEqual([]);
  });
} else {
  const { startVitest } = await import("vitest/node");
  // Thread `--check` to the worker that will actually run the `VITEST`
  // branch above — see the module-scope comment on `CHECK` for why this,
  // and not argv, is what the worker can see.
  if (CHECK) {
    process.env.FREEZE_CHECK = "1";
  }
  const vitest = await startVitest("test", [], {
    watch: false,
    root: FRONTEND,
    include: [SELF],
    // This entry point always drives exactly one spec file (`SELF`) with one
    // test in it — a full thread/fork worker pool (vitest's default) spins up
    // and tears down parallel workers it will never use. `forks` + a single
    // worker + no isolation cuts that startup overhead, which matters because
    // this can run 4x back-to-back inside the --check guard test
    // (`freezeRegressionMatrixCheck.test.ts`). Read-only-ness and the exit
    // code (the actual --check contract) come from the script body above and
    // are unaffected by how the runner schedules its one worker.
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    isolate: false,
    coverage: { enabled: false },
  });
  await vitest?.close();
  const failed = vitest?.state.getCountOfFailedTests() ?? 1;
  if (failed > 0) {
    console.error(
      CHECK
        ? "goldens are STALE — run `node scripts/freeze-regression-matrix.mjs` and review the diff"
        : "freeze failed",
    );
  }
  process.exit(failed > 0 ? 1 : 0);
}
