// PRIMARY_SOFTWARE_AUDIT_PLAN — "Migration fixtures for supported
// contract/workspace versions", guard half. Every persisted-format version
// constant this app still claims to LOAD (not just write) must have a
// committed, frozen fixture for each older version below it — so a future
// version bump that forgets to freeze the version it just left behind fails
// HERE, immediately, rather than silently losing migration coverage.
//
// Sabotage-verifiable: bump any of the version constants below by one
// without adding the matching `v<old>.json`/`v<old>.dwk.json` fixture file,
// and the matching case fails.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FIGURE_DOCUMENT_VERSION } from "./figureDocument";
import { CUSTOM_FIT_MODEL_VERSION } from "./fitmodels";
import { PAGE_DOCUMENT_VERSION } from "./pageDocument";
import { PEAK_RECIPE_VERSION } from "./peakwizard";
import { WORKSPACE_VERSION_TRANSFORM_STEPS } from "./workspace";

const fixturesRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

interface VersionedFormat {
  name: string;
  /** The highest version this build still reads (not necessarily what it writes). */
  currentVersion: number;
  /** Directory under __fixtures__ holding one committed fixture per older version. */
  dir: string;
  fileFor: (version: number) => string;
}

const FORMATS: VersionedFormat[] = [
  { name: "FigureDocument", currentVersion: FIGURE_DOCUMENT_VERSION, dir: "figureDocument", fileFor: (v) => `v${v}.json` },
  { name: "PageDocument", currentVersion: PAGE_DOCUMENT_VERSION, dir: "pageDocument", fileFor: (v) => `v${v}.json` },
  { name: "CustomFitModel", currentVersion: CUSTOM_FIT_MODEL_VERSION, dir: "fitModels", fileFor: (v) => `v${v}.json` },
  { name: "PeakRecipe", currentVersion: PEAK_RECIPE_VERSION, dir: "peakRecipes", fileFor: (v) => `v${v}.json` },
  { name: "Workspace (.dwk)", currentVersion: WORKSPACE_VERSION_TRANSFORM_STEPS, dir: "workspace", fileFor: (v) => `v${v}.dwk.json` },
];

describe("version-bump guard — a committed fixture exists for every older supported version", () => {
  for (const format of FORMATS) {
    it(`${format.name}: v1..v${format.currentVersion - 1} each have a fixture (current version is ${format.currentVersion})`, () => {
      expect(format.currentVersion).toBeGreaterThanOrEqual(1);
      for (let v = 1; v < format.currentVersion; v++) {
        const path = join(fixturesRoot, format.dir, format.fileFor(v));
        expect(
          existsSync(path),
          `missing fixture ${path} — bumping ${format.name} past v${v} without freezing a fixture for it ` +
            "leaves that version's migration path untested",
        ).toBe(true);
      }
    });
  }
});
