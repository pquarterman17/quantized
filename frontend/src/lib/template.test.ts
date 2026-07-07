// lib/template — template (de)serialization, persistence, batch summary (#2/#3).

import { beforeEach, describe, expect, it } from "vitest";

import { makeStep } from "./pipeline";
import {
  deleteTemplate,
  loadTemplates,
  parseTemplate,
  saveTemplate,
  serializeTemplate,
  summaryDataset,
  toTemplate,
} from "./template";

const STEPS = [
  makeStep("import", "Import a.dat", 'qz.import("a.dat")', { name: "a.dat" }),
  makeStep("expression", "Add column r", 'qz.addColumn("r", "A * 2")', {
    name: "r",
    expr: "A * 2",
  }),
  makeStep("fit", "Fit Linear", 'qz.fit("Linear")', { model: "Linear" }),
];

describe("toTemplate / serialize / parse round-trip", () => {
  it("round-trips steps + outputs and re-mints step ids", () => {
    const t = toTemplate("xrd flow", STEPS, ["slope", "intercept", "R2"]);
    const back = parseTemplate(serializeTemplate(t));
    expect(back.name).toBe("xrd flow");
    expect(back.outputs).toEqual(["slope", "intercept", "R2"]);
    expect(back.steps.map((s) => s.kind)).toEqual(["import", "expression", "fit"]);
    expect(back.steps.map((s) => s.params)).toEqual(STEPS.map((s) => s.params));
    expect(back.steps.every((s) => s.id)).toBe(true); // fresh ids minted
  });

  it("serializes deterministically (diffable JSON with trailing newline)", () => {
    const t = toTemplate("t", STEPS, []);
    const a = serializeTemplate(t);
    expect(a).toBe(serializeTemplate(t));
    expect(a.endsWith("\n")).toBe(true);
    expect(a).toContain('"version": 1');
  });

  it("rejects bad JSON, wrong version, and malformed steps with clear errors", () => {
    expect(() => parseTemplate("nope")).toThrow(/bad JSON/);
    expect(() => parseTemplate('{"version":2,"name":"x","steps":[]}')).toThrow(/version/);
    expect(() =>
      parseTemplate('{"version":1,"name":"x","steps":[{"kind":"alien"}]}'),
    ).toThrow(/malformed/);
  });
});

describe("template persistence", () => {
  beforeEach(() => localStorage.clear());

  it("saves, upserts by name, deletes, and survives corrupt storage", () => {
    saveTemplate(toTemplate("a", STEPS, ["R2"]));
    saveTemplate(toTemplate("b", STEPS, []));
    expect(loadTemplates().map((t) => t.name)).toEqual(["a", "b"]);
    saveTemplate(toTemplate("a", STEPS.slice(0, 1), []));
    expect(loadTemplates().find((t) => t.name === "a")?.steps).toHaveLength(1);
    expect(deleteTemplate("a").map((t) => t.name)).toEqual(["b"]);
    localStorage.setItem("qz.analysisTemplates", "garbage");
    expect(loadTemplates()).toEqual([]);
  });
});

describe("summaryDataset (#3)", () => {
  it("builds one row per file with NaN for failed values and flags failures", () => {
    const ds = summaryDataset("xrd flow", ["slope", "R2"], [
      { file: "a.dat", values: [2.0, 0.99] },
      { file: "bad.dat", values: [Number.NaN, Number.NaN], failed: "fit failed" },
    ]);
    expect(ds.time).toEqual([1, 2]);
    expect(ds.values[0]).toEqual([2.0, 0.99]);
    expect(Number.isNaN(ds.values[1][0])).toBe(true);
    expect(ds.labels).toEqual(["slope", "R2"]);
    expect(ds.metadata.files).toEqual(["a.dat", "bad.dat"]);
    expect(ds.metadata.failures).toEqual(["2: bad.dat — fit failed"]);
  });
});
