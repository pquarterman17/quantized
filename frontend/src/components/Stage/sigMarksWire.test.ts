// Significance marks from supplied p-values: screen and export agree through
// `tests/fixtures/wire/sig_marks.json` (the Python half is
// tests/test_sig_marks_wire.py). The layout is computed once, here, and posted
// verbatim (`comparisonWire`), so pinning its output pins both.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveStatMarks } from "../../lib/statMarks";
import { boxStatsClient } from "../../lib/statstage";
import { sigLabel, type SigLevel } from "../../lib/sigMarks";
import type { StatComparisonsResult } from "../../lib/statComparisons";
import { layoutComparisons } from "./statCompareLayout";
import { comparisonWire } from "./statExportDomain";
import type { StatDrawData } from "./statRender";

interface Fixture {
  groups: { label: string; values: number[] }[];
  levels: SigLevel[];
  pairs: [number, number, number][];
  cases: { name: string; showP: boolean; showNs: boolean; brackets: { a: number; b: number; y: number; label: string }[]; tick?: number; top?: number }[];
}
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "../../../../tests/fixtures/wire/sig_marks.json");
const fx = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;

const draw = (): Extract<StatDrawData, { mode: "box" }> => ({
  mode: "box", boxes: fx.groups.map((g) => ({ ...boxStatsClient(g.values), label: g.label })),
  valueLabel: "y", groupLabel: "g", marks: resolveStatMarks("box", {}),
});

describe("sig_marks wire fixture", () => {
  for (const c of fx.cases) {
    it(c.name, () => {
      const sig = { levels: fx.levels, showP: c.showP, showNs: c.showNs };
      const r: StatComparisonsResult = {
        method: "given", display: "brackets", exact: false, letters: null, note: "n",
        pairs: fx.pairs.map(([a, b, p]) => ({ a, b, p })), label: (p) => sigLabel(p, sig),
      };
      const m = layoutComparisons(draw(), r, [0, 1, 2]);
      if (process.env.SIG_WIRE_PRINT) console.log(c.name, JSON.stringify({ brackets: m.brackets, tick: m.tick, top: m.top }));
      expect(m.brackets.map((b) => [b.a, b.b, b.label])).toEqual(c.brackets.map((b) => [b.a, b.b, b.label]));
      m.brackets.forEach((b, i) => expect(b.y).toBeCloseTo(c.brackets[i].y, 9));
      expect(m.tick).toBeCloseTo(c.tick ?? 0, 9);
      expect(m.top).toBeCloseTo(c.top ?? 0, 9);
      // what the export is sent is exactly this layout
      expect(comparisonWire({ ...draw(), comparisons: m })).toEqual({ comparisons: m });
    });
  }
});
