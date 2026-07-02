import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace, WORKSPACE_FORMAT } from "./workspace";

function makeDataset(id: string, name: string): Dataset {
  return {
    id,
    name,
    data: {
      time: [0, 1, 2],
      values: [[10, 100], [20, 200], [30, 300]],
      labels: ["A", "B"],
      units: ["emu", "Oe"],
      metadata: { source: "test" },
    },
  };
}

describe("serializeWorkspace / parseWorkspace round-trip", () => {
  it("restores datasets identically", () => {
    const datasets = [makeDataset("a", "first"), makeDataset("b", "second")];
    const restored = parseWorkspace(serializeWorkspace(datasets));
    expect(restored).toHaveLength(2);
    expect(restored[0].id).toBe("a");
    expect(restored[0].name).toBe("first");
    expect(restored[0].data).toEqual(datasets[0].data);
    expect(restored[1].data).toEqual(datasets[1].data);
  });

  it("preserves raw, corrections, and bgRef when present", () => {
    const ds = makeDataset("a", "corrected");
    ds.raw = makeDataset("a", "raw").data;
    ds.corrections = { xOff: 1.5, smoothEnabled: true, smoothWindow: 5 };
    ds.bgRef = { datasetId: "b", interp: "pchip" };
    const [restored] = parseWorkspace(serializeWorkspace([ds]));
    expect(restored.raw).toEqual(ds.raw);
    expect(restored.corrections).toEqual(ds.corrections);
    expect(restored.bgRef).toEqual(ds.bgRef);
  });

  it("omits optional fields that were absent", () => {
    const [restored] = parseWorkspace(serializeWorkspace([makeDataset("a", "bare")]));
    expect(restored.raw).toBeUndefined();
    expect(restored.corrections).toBeUndefined();
    expect(restored.bgRef).toBeUndefined();
    expect(restored.notes).toBeUndefined();
  });

  it("preserves dataset tags (and drops an empty tag list)", () => {
    const ds = makeDataset("a", "tagged");
    ds.tags = ["MvsH", "sample-A"];
    const [restored] = parseWorkspace(serializeWorkspace([ds]));
    expect(restored.tags).toEqual(["MvsH", "sample-A"]);
    // an empty tag list is omitted on save -> undefined on restore
    const bare = makeDataset("b", "bare");
    bare.tags = [];
    expect(parseWorkspace(serializeWorkspace([bare]))[0].tags).toBeUndefined();
  });

  it("preserves a dataset group (and omits a blank one)", () => {
    const ds = makeDataset("a", "grouped");
    ds.group = "Cooldown 1";
    expect(parseWorkspace(serializeWorkspace([ds]))[0].group).toBe("Cooldown 1");
    const bare = makeDataset("b", "bare");
    bare.group = "   ";
    expect(parseWorkspace(serializeWorkspace([bare]))[0].group).toBeUndefined();
  });

  it("preserves dataset notes", () => {
    const ds = makeDataset("a", "noted");
    ds.notes = "5 K M-vs-H, second cooldown";
    const [restored] = parseWorkspace(serializeWorkspace([ds]));
    expect(restored.notes).toBe(ds.notes);
  });

  it("preserves per-dataset column roles (filtering invalid entries)", () => {
    const ds = makeDataset("a", "roled");
    ds.channelRoles = { 0: "ignore", 1: "label" };
    const [restored] = parseWorkspace(serializeWorkspace([ds]));
    expect(restored.channelRoles).toEqual({ 0: "ignore", 1: "label" });
    // Bad role values are dropped on parse.
    const doc = JSON.parse(serializeWorkspace([ds]));
    doc.datasets[0].channelRoles = { 0: "ignore", 2: "bogus" };
    expect(parseWorkspace(JSON.stringify(doc))[0].channelRoles).toEqual({ 0: "ignore" });
  });

  it("preserves computed-column formulas (and drops malformed entries)", () => {
    const ds = makeDataset("a", "computed");
    ds.formulas = [{ name: "S", expr: "A + B" }];
    const [restored] = parseWorkspace(serializeWorkspace([ds]));
    expect(restored.formulas).toEqual([{ name: "S", expr: "A + B" }]);
    // A document with a malformed formula entry keeps only the valid ones.
    const doc = JSON.parse(serializeWorkspace([ds]));
    doc.datasets[0].formulas = [{ name: "ok", expr: "A" }, { name: 5 }];
    expect(parseWorkspace(JSON.stringify(doc))[0].formulas).toEqual([{ name: "ok", expr: "A" }]);
  });

  it("writes the format tag and version", () => {
    const doc = JSON.parse(serializeWorkspace([makeDataset("a", "x")]));
    expect(doc.format).toBe(WORKSPACE_FORMAT);
    expect(doc.version).toBe(1);
    expect(typeof doc.savedAt).toBe("string");
  });
});

describe("parseWorkspace validation", () => {
  it("rejects non-JSON", () => {
    expect(() => parseWorkspace("not json {{{")).toThrow(/bad JSON/);
  });

  it("rejects a JSON document with the wrong format tag", () => {
    expect(() => parseWorkspace(JSON.stringify({ format: "something-else", version: 1, datasets: [] }))).toThrow(
      /not a quantized workspace/,
    );
  });

  it("rejects an unsupported version", () => {
    expect(() =>
      parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 99, datasets: [] })),
    ).toThrow(/unsupported workspace version/);
  });

  it("rejects when datasets is missing", () => {
    expect(() => parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 1 }))).toThrow(
      /no datasets/,
    );
  });

  it("rejects a dataset with an invalid data structure", () => {
    const bad = {
      format: WORKSPACE_FORMAT,
      version: 1,
      datasets: [{ id: "a", name: "broken", data: { time: "nope", values: [], labels: [], units: [] } }],
    };
    expect(() => parseWorkspace(JSON.stringify(bad))).toThrow(/invalid data structure/);
  });

  it("accepts an empty workspace", () => {
    expect(parseWorkspace(JSON.stringify({ format: WORKSPACE_FORMAT, version: 1, datasets: [] }))).toEqual([]);
  });
});

describe("workspace channel modeling types", () => {
  it("preserves per-dataset type overrides (filtering invalid entries)", () => {
    const ds = makeDataset("a", "typed");
    ds.channelTypes = { 0: "nominal", 1: "ordinal" };
    const [restored] = parseWorkspace(serializeWorkspace([ds]));
    expect(restored.channelTypes).toEqual({ 0: "nominal", 1: "ordinal" });
    // Bad type values are dropped on parse.
    const doc = JSON.parse(serializeWorkspace([ds]));
    doc.datasets[0].channelTypes = { 0: "continuous", 2: "bogus" };
    expect(parseWorkspace(JSON.stringify(doc))[0].channelTypes).toEqual({ 0: "continuous" });
  });
});
