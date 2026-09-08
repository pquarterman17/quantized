// P1.7 PR 5 audit item 2 — cross-language parity for the bundle-relative
// path containment rule.
//
// `isBundleRelativePath` here and `quantized.portable.layout.is_bundle_relative`
// (src/quantized/portable/layout.py) are two independently hand-maintained
// ports of the SAME rule — nothing in the toolchain enforces that they agree.
// This suite and its pytest counterpart
// (tests/test_portable_bundle_paths_fixture.py) both consume the single
// shared fixture tests/fixtures/portable/bundle_paths.json, so a change to
// one side that is not mirrored on the other fails on ITS OWN suite instead
// of only being caught by memory or a reviewer manually diffing two
// hand-written test files. (bundlePath.test.ts, which predates this fixture,
// stays as the richer behavioral suite for resolveBundlePath/
// deriveBundleRelativePath — this file is purely the parity pin.)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isBundleRelativePath } from "./bundlePath";

const here = dirname(fileURLToPath(import.meta.url));
// frontend/src/lib -> repo root is three levels up.
const FIXTURE_PATH = join(here, "../../../tests/fixtures/portable/bundle_paths.json");

interface FixtureCase {
  path: string;
  accept: boolean;
  note: string;
}

function loadCases(): FixtureCase[] {
  const data = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  const cases = data.cases as FixtureCase[];
  expect(Array.isArray(cases) && cases.length > 0).toBe(true);
  return cases;
}

describe("isBundleRelativePath matches the shared bundle_paths.json fixture", () => {
  const cases = loadCases();

  it("fixture carries both accepted and rejected cases", () => {
    expect(cases.some((c) => c.accept === true)).toBe(true);
    expect(cases.some((c) => c.accept === false)).toBe(true);
  });

  for (const { path, accept, note } of cases) {
    it(`${accept ? "accepts" : "rejects"}: ${note} (${JSON.stringify(path)})`, () => {
      expect(isBundleRelativePath(path)).toBe(accept);
    });
  }
});
