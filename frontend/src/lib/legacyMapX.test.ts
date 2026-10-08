// A `.dwk` (or autosave) saved before PR #532 holds a 2-D map dataset with
// `.time` = row index 0..N-1, so its Plot tab drew Intensity against the row
// index under a "2-Theta" title. On load the map's `.time` becomes the column
// its x title names, with the importer's two plot hints added.

import { beforeEach, describe, expect, it } from "vitest";

import legacy from "./__fixtures__/workspace/legacy-map-index-x.dwk.json";
import { loadAutosave, setAutosaveBackend } from "./autosave";
import { memoryBackend } from "./autosaveBackend";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const TEXT = JSON.stringify(legacy);
const WARNING = "2 maps saved by an older version now plot against their x column instead of the row index.";

beforeEach(() => {
  setAutosaveBackend(memoryBackend());
});

describe("a pre-#532 map's row-index x is migrated on load", () => {
  it("sets .time to the named x column and adds the plot hints", () => {
    const [rsm, pole] = parseWorkspace(TEXT).datasets;
    expect(rsm.data.time).toEqual(rsm.data.values.map((r) => r[0]));
    expect(rsm.data.time.slice(0, 3)).toEqual([33.0, 33.1, 33.2]);
    expect(rsm.data.metadata.default_value_channels).toEqual([2]);
    expect(rsm.data.metadata.default_trace).toBe("Scatter");
    // Pole figure: x title "Phi" names the Phi column.
    expect(pole.data.time).toEqual([0, 90, 0, 90]);
    expect(pole.data.metadata.default_value_channels).toEqual([2]);
    expect(pole.data.metadata.default_trace).toBe("Scatter");
  });

  it("keeps raw consistent with data", () => {
    const [rsm] = parseWorkspace(TEXT).datasets;
    expect(rsm.raw?.time).toEqual(rsm.data.time);
    expect(rsm.raw?.metadata.default_trace).toBe("Scatter");
    expect(rsm.raw?.metadata.default_value_channels).toEqual([2]);
  });

  it("leaves a non-map dataset with an index .time untouched", () => {
    const scan = parseWorkspace(TEXT).datasets[2];
    expect(scan.data.time).toEqual([0, 1, 2]);
    expect(scan.data.metadata.default_trace).toBeUndefined();
    expect(scan.raw?.time).toEqual([0, 1, 2]);
  });

  it("reports ONE short warning", () => {
    expect(parseWorkspace(TEXT).migrationWarnings).toEqual([WARNING]);
  });

  it("is idempotent: a load-save-load round trip changes nothing more and warns nothing", () => {
    const once = parseWorkspace(TEXT);
    const saved = serializeWorkspace(once);
    const twice = parseWorkspace(saved);
    expect(twice.migrationWarnings).toEqual([]);
    expect(twice.datasets.map((d) => d.data)).toEqual(once.datasets.map((d) => d.data));
    const noStamp = (t: string) => t.replace(/"savedAt": "[^"]*"/, "");
    expect(noStamp(serializeWorkspace(twice))).toBe(noStamp(saved));
  });

  it("leaves a map whose .time is not the row index alone, keeping its own hints", () => {
    const doc = JSON.parse(TEXT) as { datasets: { data: { time: number[]; metadata: Record<string, unknown> } }[] };
    doc.datasets[0].data.time = [5, 4, 3, 2, 1, 0];
    doc.datasets[0].data.metadata.default_trace = "Line";
    const [rsm] = parseWorkspace(JSON.stringify(doc)).datasets;
    expect(rsm.data.time).toEqual([5, 4, 3, 2, 1, 0]);
    expect(rsm.data.metadata.default_trace).toBe("Line");
  });

  it("does not overwrite hints a migrated map already carries", () => {
    const doc = JSON.parse(TEXT) as { datasets: { data: { metadata: Record<string, unknown> } }[] };
    doc.datasets[0].data.metadata.default_trace = "Line";
    const [rsm] = parseWorkspace(JSON.stringify(doc)).datasets;
    expect(rsm.data.time[0]).toBe(33.0);
    expect(rsm.data.metadata.default_trace).toBe("Line");
    expect(rsm.data.metadata.default_value_channels).toEqual([2]);
  });

  it("skips a map whose x title names no column", () => {
    const doc = JSON.parse(TEXT) as { datasets: { data: { metadata: Record<string, unknown> } }[] };
    doc.datasets[1].data.metadata.x_column_name = "Chi";
    const [, pole] = parseWorkspace(JSON.stringify(doc)).datasets;
    expect(pole.data.time).toEqual([0, 1, 2, 3]);
    expect(parseWorkspace(JSON.stringify(doc)).migrationWarnings).toEqual([
      "1 map saved by an older version now plots against its x column instead of the row index.",
    ]);
  });

  it("migrates an autosave generation too", async () => {
    setAutosaveBackend(memoryBackend([{ at: 1, text: TEXT }]));
    const restored = await loadAutosave();
    expect(restored?.datasets[0].data.time[1]).toBe(33.1);
    expect(restored?.migrationWarnings).toEqual([WARNING]);
  });
});
