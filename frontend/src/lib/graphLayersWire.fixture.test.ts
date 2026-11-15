// Origin gap audit 3 #15: the screen <-> export contract for graph layers.
// `tests/fixtures/wire/graph_layers.json` holds layer + dataset inputs and the
// exact export wire they resolve to (curves, axis ranges, tick positions and
// tick text). This side checks `layersWire` produces it; the Python side
// (`tests/test_calc_figure_layers.py`) renders that wire and checks the
// export draws those exact values at those exact frame fractions.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { layersWire } from "./graphLayersWire";
import type { Dataset } from "./types";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "graph_layers.json");
const { cases } = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  cases: { name: string; datasets: Dataset[]; layers: unknown[]; wire: unknown[] }[];
};

describe("graph_layers.json: the wire the screen resolves", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(layersWire(c.layers, c.datasets, (slot) => ["#1f77b4", "#d62728"][slot % 2])).toEqual(c.wire);
    });
  }
});
