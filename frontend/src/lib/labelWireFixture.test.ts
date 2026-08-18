// P1.6 review round, P3(a): a SECOND shared wire fixture, alongside
// `categoricalWireFixture.test.ts` (P1.4's `cat_levels` key-parity pin) —
// this one pins the Import Wizard's own path (`io/import_preview.parse_import`,
// verified byte-for-byte against this SAME fixture by
// tests/test_wire_fixtures.py::test_label_import_payload_matches_wire_fixture):
// a `label_line` override replacing the header-derived channel labels, and
// the 2-line preamble surviving as `metadata.comments` — both P1.6-only
// behavior `import_csv`'s fixture never exercises. Feeds the ACTUAL wire
// payload the backend produces (not a hand-built TS object) through the
// REAL `parseWorkspace`/`serializeWorkspace` pipeline (`lib/workspace.ts`,
// PINNED — untouched), so a regression here (labels reverting to
// header-derived text, or `comments` silently dropped across the boundary)
// fails HERE, not just in a backend-only probe. Keep this fixture in sync
// with `tests/fixtures/wire/label_import.csv` by hand; a drift between the
// backend's actual output and the committed JSON is exactly what
// test_wire_fixtures.py's byte-for-byte assertion catches.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { DataStruct } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const here = dirname(fileURLToPath(import.meta.url));
// frontend/src/lib -> repo root is three levels up.
const FIXTURE_PATH = join(here, "../../../tests/fixtures/wire/label_import_payload.json");

function loadFixtureAsRealDataset(): DataStruct {
  const payload = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  // Round-trip through the REAL .dwk pipeline (serializeWorkspace/parseWorkspace,
  // which internally runs workspace.ts's private isDataStruct) rather than
  // trusting the raw JSON.parse result — this is what a genuine import ->
  // save -> reload does, and it's the only way to exercise that structural
  // check without touching the pinned workspace.ts to export it.
  const text = serializeWorkspace({ datasets: [{ id: "w1", name: "wire-fixture", data: payload }] });
  const { datasets } = parseWorkspace(text);
  expect(datasets).toHaveLength(1); // parseWorkspace would have thrown on an invalid DataStruct
  return datasets[0].data;
}

describe("label wire fixture (P1.6 review P3(a): label_line + comments backend/frontend parity)", () => {
  it("the backend's actual parse_import() output validates as a DataStruct through the real workspace pipeline", () => {
    expect(() => loadFixtureAsRealDataset()).not.toThrow();
  });

  it("label_line's resolved text landed as the real channel labels, not the header-derived names", () => {
    const data = loadFixtureAsRealDataset();
    expect(data.labels).toEqual(["NbAu-Alpha", "NbAu-Beta"]);
  });

  it("units_line's resolved units survive untouched by label_line", () => {
    const data = loadFixtureAsRealDataset();
    expect(data.units).toEqual(["emu", "emu"]);
  });

  it("the 2-line preamble survives across the wire as metadata.comments", () => {
    const data = loadFixtureAsRealDataset();
    expect(data.metadata.comments).toEqual(["# Sample: NbAu bilayer", "# Operator: pq"]);
  });
});
