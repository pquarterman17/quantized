// lib/figuredoc — FigureDoc sanitizers + user graph templates (#12/#15).

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteGraphTemplate,
  docRenderable,
  loadGraphTemplates,
  sanitizeFigureDocs,
  saveGraphTemplate,
  type FigureDoc,
} from "./figuredoc";
import { installSeriesPalette, TEST_SERIES_PALETTE } from "./regressionMatrix.testkit";
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
    xScale: "linear",
    yScale: "log",
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

  it("migrates a pre-MAIN-#12 config (xLog/yLog booleans, no xScale/yScale) to the enum", () => {
    const legacy = doc();
    const legacyConfig = { ...legacy.config, xLog: true, yLog: false } as unknown as Record<
      string,
      unknown
    >;
    delete legacyConfig.xScale;
    delete legacyConfig.yScale;
    const out = sanitizeFigureDocs([{ ...legacy, config: legacyConfig }], new Set(["d1"]));
    expect(out).toHaveLength(1);
    expect(out[0].config.xScale).toBe("log");
    expect(out[0].config.yScale).toBe("linear");
  });

  it("drops a config with NEITHER the new scale fields nor the old log booleans", () => {
    const legacy = doc();
    const badConfig = { ...legacy.config } as unknown as Record<string, unknown>;
    delete badConfig.xScale;
    delete badConfig.yScale;
    const out = sanitizeFigureDocs([{ ...legacy, config: badConfig }], new Set(["d1"]));
    expect(out).toHaveLength(0);
  });
});

describe("docRenderable", () => {
  it("live docs need their dataset; frozen docs need their snapshot", () => {
    expect(docRenderable(doc(), new Set(["d1"]))).toBe(true);
    expect(docRenderable(doc({ datasetId: null }), new Set(["d1"]))).toBe(false);
    expect(docRenderable(doc({ datasetId: "gone" }), new Set(["d1"]))).toBe(false);
    expect(docRenderable(doc({ live: false, dataSnapshot: DATA, datasetId: null }), new Set())).toBe(true);
    expect(docRenderable(doc({ live: false, datasetId: null }), new Set())).toBe(false);
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

  // BUG-016 round 4: the SECOND persistence path for a pinned style array, and
  // the reason it is sanitized at all — a template saved (or Origin-imported)
  // before `colorDerived` existed reaches `docSeriesStyles` via
  // `applyStyleTemplate` and then the export wire. Round 5: the sanitizer
  // records the document's word and infers nothing, so what this path is FOR
  // is dropping a malformed flag and normalizing the field, not deciding
  // provenance.
  describe("pre-provenance seriesStyles are sanitized, never classified", () => {
    let restorePalette: () => void = () => {};
    beforeEach(() => {
      restorePalette = installSeriesPalette();
    });
    afterEach(() => restorePalette());

    it("leaves a flagless stored array flagless, whatever palette is live", () => {
      // A palette IS installed here (`installSeriesPalette`) and entry 0 is
      // literally slot 0's hue — the input round 4 marked `colorDerived: true`.
      // The template does not record which palette it was saved under, so that
      // equality says nothing about the template and everything about the
      // reader; nothing is inferred from it.
      localStorage.setItem("qz.graphTemplates", JSON.stringify([{
        name: "old", style: "aps", overrides: null,
        seriesStyles: [{ color: TEST_SERIES_PALETTE[0], width: 2 }, { color: "#ffe066" }],
      }]));
      expect(loadGraphTemplates()[0]!.seriesStyles).toEqual([
        { color: TEST_SERIES_PALETTE[0], width: 2 },
        { color: "#ffe066" },
      ]);
    });

    it("DROPS a malformed flag — the reason this path is sanitized at all", () => {
      // `"no"` is truthy and `null` falsy, so passing either through would let
      // a hand-edited store flip provenance at the wire (review F3).
      localStorage.setItem("qz.graphTemplates", JSON.stringify([{
        name: "old", style: "aps", overrides: null,
        seriesStyles: [{ color: "#ffe066", colorDerived: "no" }, { color: "#abc", colorDerived: true }],
      }]));
      expect(loadGraphTemplates()[0]!.seriesStyles).toEqual([
        { color: "#ffe066" },
        { color: "#abc", colorDerived: true },
      ]);
    });

    it("keeps the tolerant shape check — a record with no seriesStyles still loads", () => {
      localStorage.setItem("qz.graphTemplates", JSON.stringify([
        { name: "pre15", style: "aps" },
      ]));
      const loaded = loadGraphTemplates();
      expect(loaded.map((t) => t.name)).toEqual(["pre15"]);
      // Normalized to the explicit "this template carries none" sentinel,
      // which is what `applyStyleTemplate` already coerced it to (`?? null`).
      expect(loaded[0]!.seriesStyles).toBeNull();
    });
  });
});
