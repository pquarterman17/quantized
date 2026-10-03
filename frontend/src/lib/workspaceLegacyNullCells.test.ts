// A `.dwk` (or autosave) written before PR #527 holds JSON `null` where a
// DataStruct cell was NaN, ±Infinity or missing. Owner ruling 2026-10-03: such
// a cell is read as a missing value (NaN) with ONE migration warning, and the
// workspace opens; structural corruption is still refused.

import { beforeEach, describe, expect, it } from "vitest";

import legacy from "./__fixtures__/workspace/legacy-null-cells.dwk.json";
import { loadAutosave, setAutosaveBackend } from "./autosave";
import { memoryBackend } from "./autosaveBackend";
import { sanitizeReports } from "./report";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { parseWorkspaceDataset } from "./workspaceDatasetParse";

const TEXT = JSON.stringify(legacy);
const WARNING =
  '3 cells saved as blank by an older version were read as missing values in "run-a.csv", "run-b.xy".';

/** The fixture with one dataset field replaced, as JSON text. */
function withData(patch: Record<string, unknown>, index = 0): string {
  const doc = JSON.parse(TEXT) as { datasets: { data: Record<string, unknown> }[] };
  doc.datasets[index].data = { ...doc.datasets[index].data, ...patch };
  return JSON.stringify(doc);
}

beforeEach(() => {
  setAutosaveBackend(memoryBackend());
});

describe("a legacy null cell is read as a missing value", () => {
  it("opens the fixture, reading each null as NaN and keeping every other cell", () => {
    const loaded = parseWorkspace(TEXT);
    const [a, b] = loaded.datasets;
    expect(a.data.values[1][1]).toBeNaN();
    expect(a.data.values[3][0]).toBeNaN();
    expect(a.data.values[1][0]).toBe(20);
    expect(a.data.values[3][1]).toBe(400);
    expect(b.data.time[2]).toBeNaN();
    expect(b.data.time.slice(0, 2)).toEqual([0, 1]);
    // `raw` is read the same way rather than silently dropped.
    expect(a.raw?.values[1][1]).toBeNaN();
  });

  it("reports ONE warning, counting data cells across datasets (raw is not double-counted)", () => {
    expect(parseWorkspace(TEXT).migrationWarnings).toEqual([WARNING]);
  });

  it("drops the names when they are not short, and says 'cell' for one", () => {
    const doc = JSON.parse(TEXT) as { datasets: { name: string }[] };
    doc.datasets[0].name = "x".repeat(80);
    expect(parseWorkspace(JSON.stringify(doc)).migrationWarnings).toEqual([
      "3 cells saved as blank by an older version were read as missing values.",
    ]);
    const one = withData({ values: [[10, 100], [20, 200], [30, 300], [40, null]] });
    const solo = JSON.parse(one) as { datasets: unknown[] };
    solo.datasets = solo.datasets.slice(0, 1);
    expect(parseWorkspace(JSON.stringify(solo)).migrationWarnings).toEqual([
      '1 cell saved as blank by an older version was read as a missing value in "run-a.csv".',
    ]);
  });

  it("writes NaN sentinels on the next save, so a load-save round trip holds no null", () => {
    const saved = serializeWorkspace(parseWorkspace(TEXT));
    const doc = JSON.parse(saved) as { datasets: { data: { time: unknown[]; values: unknown[][] }; raw?: { values: unknown[][] } }[] };
    const cells = doc.datasets.flatMap((d) => [...d.data.time, ...d.data.values.flat(), ...(d.raw?.values.flat() ?? [])]);
    expect(cells).not.toContain(null);
    expect(doc.datasets[0].data.values[1][1]).toBe("NaN");
    expect(doc.datasets[1].data.time[2]).toBe("NaN");
    // Reopening the re-saved file is clean: nothing legacy left to warn about.
    expect(parseWorkspace(saved).migrationWarnings).toEqual([]);
  });

  it("restores an autosave generation holding legacy nulls, with the warning", async () => {
    setAutosaveBackend(memoryBackend([{ at: 1, text: TEXT }]));
    const restored = await loadAutosave();
    expect(restored?.datasets[0].data.values[1][1]).toBeNaN();
    expect(restored?.migrationWarnings).toEqual([WARNING]);
  });

  it("reads a legacy null in a report figure's embedded dataset as NaN, beside a real sentinel", () => {
    const warnings: string[] = [];
    const entry = {
      id: "r1",
      name: "Figs",
      datasetId: null,
      report: {
        title: "Figs",
        sections: [{
          title: "F",
          blocks: [{
            type: "figure",
            name: "f1",
            spec: { dataset: { time: [0, null], values: [["NaN", null]], labels: ["y"], units: [""], metadata: {} } },
          }],
        }],
      },
    };
    const tally = { cells: 0, names: [] as string[] };
    const block = sanitizeReports([entry], new Set(), warnings, tally)[0].report.sections[0].blocks[0];
    if (block.type !== "figure") throw new Error("expected figure block");
    const dataset = block.spec?.dataset as { time: number[]; values: number[][] };
    expect(dataset.time[1]).toBeNaN();
    expect(dataset.values[0][0]).toBeNaN();
    expect(dataset.values[0][1]).toBeNaN();
    expect(tally).toEqual({ cells: 2, names: ['report "Figs"'] });
    expect(warnings).toEqual([]);
  });
});

describe("structural corruption is still refused", () => {
  const refuses = (text: string, index = 0, name = "run-a.csv") =>
    expect(() => parseWorkspace(text)).toThrow(`dataset ${index} ("${name}") has an invalid data structure`);

  it("a string cell that is not one of the four sentinels", () => {
    refuses(withData({ values: [[10, "nan"], [20, 200], [30, 300], [40, 400]] }));
    refuses(withData({ time: [0, "", 2, 3] }));
  });

  it("a null ROW, or null time/values themselves (only a cell may be null)", () => {
    refuses(withData({ values: [[10, 100], null, [30, 300], [40, 400]] }));
    refuses(withData({ time: null }));
    refuses(withData({ values: null }));
  });

  it("non-array time/values and non-string labels", () => {
    refuses(withData({ time: { 0: 1 } }));
    refuses(withData({ values: "1,2" }));
    refuses(withData({ labels: ["Field", null] }));
  });

  it("an explicit undefined cell (never a missing value)", () => {
    const entry = { id: "d", name: "u", data: { time: [0, undefined], values: [[1], [2]], labels: ["A"], units: [""], metadata: {} } };
    expect(() => parseWorkspaceDataset(entry, 0)).toThrow('dataset 0 ("u") has an invalid data structure');
  });

  it("a truncated file", () => {
    expect(() => parseWorkspace(TEXT.slice(0, TEXT.length / 2))).toThrow("not a valid workspace file (bad JSON)");
  });

  it("a null beside a bad cell refuses rather than half-reading the row", () => {
    refuses(withData({ values: [[null, "oops"], [20, 200], [30, 300], [40, 400]] }));
  });
});
