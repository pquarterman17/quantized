// The error roles a new dataset gets on import (`seedErrorRoles`) — pinned for
// the headless port, `quantized.io.error_seed.seed_error_roles`, which `qz run`
// and the exported pipeline script use so a correction leaves a bound error
// column un-offset exactly as the app does (gap audit 5 #6 review).
// tests/test_error_seed.py replays every case.
// Rewrite with `QZ_WRITE_FIXTURES=1 npx vitest run src/store/errorRoleSeed.parity.test.ts`.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { DataStruct } from "../lib/types";
import { seedErrorRoles } from "./importErrorRoles";

const FIXTURE = join(__dirname, "..", "lib", "__fixtures__", "errorRoleSeed.json");

const ds = (labels: string[], units: string[], metadata: Record<string, unknown> = {}): DataStruct => ({
  time: [0, 1],
  values: [labels.map(() => 1), labels.map(() => 2)],
  labels,
  units,
  metadata,
});

const CASES: Record<string, DataStruct> = {
  "label guess": ds(["M", "M_err"], ["emu", "emu"]),
  "label guess, unit mismatch": ds(["M", "M_err"], ["emu", "Oe"]),
  "several values": ds(["R", "dR", "Q", "dQ"], ["", "", "1/A", "1/A"]),
  "x error": ds(["signal", "x_err"], ["", "K"], { xUnit: "K" }),
  "x error, unit mismatch": ds(["signal", "x_err"], ["", "s"], { xUnit: "K" }),
  "nothing to guess": ds(["a", "b"], ["", ""]),
  "parser declared": ds(["R", "col2", "col3"], ["", "", ""], {
    error_roles: [
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 2, target: 2, axis: "y", side: "both" },
      { channel: 9, target: 0, axis: "y", side: "both" },
      { channel: 2, target: -1, axis: "x", side: "+" },
    ],
  }),
  "parser declared, none valid": ds(["M", "M_err"], ["emu", "emu"], { error_roles: [{ channel: 5 }] }),
  "origin designations": ds(["A", "B", "C"], ["", "", ""], {
    origin_column_names: ["A", "B", "C", "D"],
    column_designations: { A: "X", B: "Y", C: "Y-error", D: "X-error" },
  }),
  "origin, no error column": ds(["M", "M_err"], ["emu", "emu"], {
    origin_column_names: ["T", "M", "M_err"],
    column_designations: { T: "X", M: "Y", M_err: "Y" },
  }),
  "origin, names only": ds(["M", "M_err"], ["emu", "emu"], {
    origin_column_names: ["T", "M", "M_err"],
    column_designations: {},
  }),
};

describe("seedErrorRoles, pinned for the headless port", () => {
  it("matches the committed fixture", () => {
    const cases = Object.entries(CASES).map(([name, data]) => ({ name, data, roles: seedErrorRoles(data).errorRoles ?? null }));
    const text = JSON.stringify({ cases }, null, 1) + "\n";
    if (process.env.QZ_WRITE_FIXTURES === "1") writeFileSync(FIXTURE, text);
    expect(text).toBe(readFileSync(FIXTURE, "utf8"));
    expect(cases.find((c) => c.name === "label guess")!.roles).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
  });
});
