// lib/figuredoc — FigureDoc sanitizers + user graph templates (#12/#15).

import { beforeEach, describe, expect, it } from "vitest";

import {
  deleteGraphTemplate,
  docRenderable,
  loadGraphTemplates,
  sanitizeFigureDocs,
  saveGraphTemplate,
  type FigureDoc,
} from "./figuredoc";
import type { DataStruct } from "./types";

const DATA: DataStruct = { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} };

const doc = (over: Partial<FigureDoc> = {}): FigureDoc => ({
  id: "figd-1",
  name: "MH loop",
  datasetId: "d1",
  live: true,
  config: {
    xKey: null,
    yKeys: [0],
    xLog: false,
    yLog: true,
    title: "M vs H",
    xLabel: "",
    yLabel: "",
    style: "aps",
    fmt: "pdf",
    dpi: 300,
    overrides: { font_size: 9 },
    seriesStyles: null,
  },
  ...over,
});

describe("sanitizeFigureDocs", () => {
  it("round-trips valid docs and clamps dead dataset refs", () => {
    const out = sanitizeFigureDocs(
      [doc(), doc({ id: "figd-2", datasetId: "gone" })],
      new Set(["d1"]),
    );
    expect(out).toHaveLength(2);
    expect(out[0].datasetId).toBe("d1");
    expect(out[1].datasetId).toBeNull();
  });

  it("keeps a frozen doc's data snapshot and drops malformed entries", () => {
    const frozen = doc({ live: false, dataSnapshot: DATA });
    const out = sanitizeFigureDocs(
      [frozen, { id: "bad", name: "x", config: { nope: 1 } }, null],
      new Set(["d1"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].live).toBe(false);
    expect(out[0].dataSnapshot).toEqual(DATA);
  });
});

describe("docRenderable", () => {
  it("live docs need their dataset; frozen docs need their snapshot", () => {
    expect(docRenderable(doc())).toBe(true);
    expect(docRenderable(doc({ datasetId: null }))).toBe(false);
    expect(docRenderable(doc({ live: false, dataSnapshot: DATA, datasetId: null }))).toBe(true);
    expect(docRenderable(doc({ live: false, datasetId: null }))).toBe(false);
  });
});

describe("graph templates (#15)", () => {
  beforeEach(() => localStorage.clear());

  it("saves, upserts by name, deletes, and survives corrupt storage", () => {
    saveGraphTemplate({ name: "aps-tight", style: "aps", overrides: { font_size: 8 }, seriesStyles: null });
    saveGraphTemplate({ name: "web", style: "web", overrides: null, seriesStyles: null });
    expect(loadGraphTemplates().map((t) => t.name)).toEqual(["aps-tight", "web"]);
    saveGraphTemplate({ name: "web", style: "poster", overrides: null, seriesStyles: null });
    expect(loadGraphTemplates().find((t) => t.name === "web")?.style).toBe("poster");
    expect(deleteGraphTemplate("web").map((t) => t.name)).toEqual(["aps-tight"]);
    localStorage.setItem("qz.graphTemplates", "garbage");
    expect(loadGraphTemplates()).toEqual([]);
  });
});
