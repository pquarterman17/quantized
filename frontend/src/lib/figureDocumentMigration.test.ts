// PRIMARY_SOFTWARE_AUDIT_PLAN — "Migration fixtures for supported
// contract/workspace versions". Exercises the FROZEN v1 fixture in
// `./__fixtures__/figureDocument/` (see that directory's README for
// provenance) through the REAL public load path (`sanitizeFigureDocument`)
// rather than an inline object built fresh in the test file — a genuinely
// OLD saved figure is what this proves survives, not today's writer
// describing itself back.

import { describe, expect, it } from "vitest";

import v1 from "./__fixtures__/figureDocument/v1.json";
import {
  FIGURE_DOCUMENT_VERSION,
  sanitizeFigureDocument,
  serializeFigureDocument,
} from "./figureDocument";

describe("figureDocument migration — frozen v1 fixture", () => {
  it("parses without throwing and migrates to the current version", () => {
    const doc = sanitizeFigureDocument(v1);
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(FIGURE_DOCUMENT_VERSION);
  });

  it("no publication section is invented for a v1 document that never had one", () => {
    const doc = sanitizeFigureDocument(v1)!;
    expect(doc).not.toHaveProperty("publication");
  });

  it("identity, binding, mark, and view state survive verbatim", () => {
    const doc = sanitizeFigureDocument(v1)!;
    expect(doc.id).toBe("fig-legacy-1");
    expect(doc.name).toBe("Magnetization vs field");
    expect(doc.bindings.datasetId).toBe("run-a");
    expect(doc.bindings.xKey).toBeNull();
    expect(doc.bindings.yKeys).toEqual([0]);
    expect(doc.bindings.errors).toEqual([]);
    expect(doc.data).toEqual({ mode: "live" });
    expect(doc.plot.mark).toBe("line");
    expect(doc.plot.view.yScale).toBe("log");
    expect(doc.plot.view.xScale).toBe("linear");
    expect(doc.plot.view.showGrid).toBe(true);
    expect(doc.plot.view.plotTitle).toBe("M vs H");
    expect(doc.output).toEqual({
      format: "pdf",
      stylePreset: "default",
      dpi: 300,
      transparent: false,
      filename: null,
    });
  });

  it("re-saving then reloading is idempotent (round trip stable)", () => {
    const firstLoad = sanitizeFigureDocument(v1)!;
    const savedOnce = serializeFigureDocument(firstLoad);
    const secondLoad = sanitizeFigureDocument(JSON.parse(savedOnce))!;
    const savedTwice = serializeFigureDocument(secondLoad);
    expect(savedTwice).toBe(savedOnce);
    expect(secondLoad).toEqual(firstLoad);
  });

  it("a future version this build does not understand is rejected outright", () => {
    const future = { ...(v1 as Record<string, unknown>), version: FIGURE_DOCUMENT_VERSION + 1 };
    expect(sanitizeFigureDocument(future)).toBeNull();
  });
});
