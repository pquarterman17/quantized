// Regression (worksheet-ops review #15): a bundle-budget commit shortened
// the Row statistics / Frequency count palette entries, losing what they
// compute and the words an Origin user searches for. The full text is the
// contract; bytes are found by moving code to lazy chunks, never by
// trimming user-facing strings.

import { describe, expect, it } from "vitest";

import { buildDataCommands } from "./dataCommands";
import { useApp } from "../store/useApp";

function command(id: string) {
  const c = buildDataCommands(useApp.getState).find((a) => a.id === id);
  expect(c).toBeDefined();
  return c!;
}

describe("data commands keep their full palette text", () => {
  it("Row statistics names what it computes and is findable by Origin's words", () => {
    const c = command("row-statistics");
    expect(c.label).toBe("Row statistics (mean, SD, min, max, sum, N across columns)…");
    expect(c.description).toMatch(/mean, standard deviation, minimum, maximum, sum or count/);
    expect(c.keywords).toMatch(/per row/);
    expect(c.keywords).toMatch(/average/);
  });

  it("Frequency count names its table and is findable as a histogram", () => {
    const c = command("frequency-count");
    expect(c.label).toBe("Frequency count (bin a column into a table)…");
    expect(c.description).toMatch(/bin edges and centers, counts, cumulative counts and percentages/);
    expect(c.keywords).toMatch(/histogram/);
    expect(c.keywords).toMatch(/cumulative percent/);
  });

  it("Recalculate now says what it does in mode None", () => {
    const c = command("recalc-now");
    expect(c.description).toMatch(/recalc mode None/);
    expect(c.description).toMatch(/every derived worksheet and fit/);
  });
});
