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

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");
const FIXTURE_DIR = join(FRONTEND, "src", "lib", "__fixtures__", "regressionMatrix");
const SELF = "scripts/freeze-regression-matrix.mjs";
const CHECK = process.argv.includes("--check");

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
        // eslint-disable-next-line no-console
        console.log(`wrote ${name}.json`);
      }
      if (!CHECK && written === 0) {
        // eslint-disable-next-line no-console
        console.log(`all ${frozen.size} goldens already byte-identical`);
      }
    } finally {
      restore();
    }
    // In --check mode a stale golden is a FAILURE, so the script's exit code
    // means something to CI or to a reviewer.
    expect(stale).toEqual([]);
  });
} else {
  const { startVitest } = await import("vitest/node");
  const vitest = await startVitest("test", [], {
    watch: false,
    root: FRONTEND,
    include: [SELF],
  });
  await vitest?.close();
  const failed = vitest?.state.getCountOfFailedTests() ?? 1;
  if (failed > 0) {
    // eslint-disable-next-line no-console
    console.error(
      CHECK
        ? "goldens are STALE — run `node scripts/freeze-regression-matrix.mjs` and review the diff"
        : "freeze failed",
    );
  }
  process.exit(failed > 0 ? 1 : 0);
}
