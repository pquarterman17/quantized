// P1.4 review round, P1-1 (the wire-key-mismatch blocker): the backend emits
// `cat_levels` (snake_case, `routes/_payload.datastruct_payload` — verified
// byte-for-byte against this SAME fixture by
// tests/test_wire_fixtures.py::test_categorical_import_payload_matches_wire_fixture)
// while an earlier revision of `types.ts` declared the field in camelCase,
// so nothing translated and every categorical accessor was dead code against
// a REAL imported dataset — only same-language test fixtures (which used the
// wrong key themselves) ever exercised it. This test feeds the ACTUAL wire
// payload the backend produces (not a hand-built TS object) through the
// REAL `parseWorkspace`/`serializeWorkspace` pipeline (`lib/workspace.ts`,
// PINNED — untouched; its private `isDataStruct` structural check is
// exercised exactly as it is for a real import, not reimplemented here) and
// then through `isCategoricalChannel`/`levelLabel`, so a reintroduced key
// mismatch fails HERE, not just in a probe. Keep this fixture in sync with
// `tests/fixtures/wire/categorical_import.csv` by hand; a drift between the
// backend's actual output and the committed JSON is exactly what
// test_wire_fixtures.py's byte-for-byte assertion catches.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isCategoricalChannel, levelLabel } from "./categorical";
import type { DataStruct } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const here = dirname(fileURLToPath(import.meta.url));
// frontend/src/lib -> repo root is three levels up.
const FIXTURE_PATH = join(here, "../../../tests/fixtures/wire/categorical_import_payload.json");

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

describe("categorical wire fixture (P1.4 review P1-1: backend/frontend key parity)", () => {
  it("the backend's actual datastruct_payload() output validates as a DataStruct through the real workspace pipeline", () => {
    expect(() => loadFixtureAsRealDataset()).not.toThrow();
  });

  it("the backend's categorical channel is recognized through the REAL wire payload, not a hand-built fixture", () => {
    const data = loadFixtureAsRealDataset();
    // channel 1 ("Sample") is the categorical channel the fixture's source
    // CSV produces (io/delimited.py's f1 promotion — see the .csv sibling).
    expect(isCategoricalChannel(data, 1)).toBe(true);
    expect(isCategoricalChannel(data, 0)).toBe(false); // "Moment" stays numeric
  });

  it("levelLabel resolves the real string levels from the wire payload", () => {
    const data = loadFixtureAsRealDataset();
    expect(levelLabel(data, 1, 0)).toBe("NbAu-1");
    expect(levelLabel(data, 1, 1)).toBe("NbAu-2");
  });
});
