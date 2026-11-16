// PRIMARY_SOFTWARE_AUDIT_PLAN — "Migration fixtures for supported
// contract/workspace versions". Exercises the FROZEN v1 fixture in
// `./__fixtures__/figureDocument/` (see that directory's README for
// provenance) through the REAL public load path (`sanitizeFigureDocument`)
// rather than an inline object built fresh in the test file — a genuinely
// OLD saved figure is what this proves survives, not today's writer
// describing itself back.

import { describe, expect, it } from "vitest";

import v1 from "./__fixtures__/figureDocument/v1.json";
import v2Overlays from "./__fixtures__/figureDocument/v2-overlays.json";
import {
  FIGURE_DOCUMENT_VERSION,
  sanitizeFigureDocument,
  serializeFigureDocument,
} from "./figureDocument";
import { fitFromDocument, overlayRowsKey } from "./figureOverlays";
import type { Dataset } from "./types";

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

  it("no overlay section is invented for a v1 document (gap audit 5 lane C)", () => {
    expect(sanitizeFigureDocument(v1)).not.toHaveProperty("overlays");
  });
});

// Gap audit 5 lane C: a saved figure keeps its fit curve.
describe("figureDocument migration — frozen v2 fixture with a saved fit", () => {
  /** The dataset `v2-overlays.json`'s section was saved against (no excluded
   *  rows, no designations). Its `rows` key is FROZEN: a change to
   *  lib/dataFingerprint or lib/figureOverlays.overlayRowsKey would orphan
   *  every saved fit. */
  const LOOP: Dataset = {
    id: "loop-a", name: "loop.csv",
    data: { time: [-1000, 0, 1000], values: [[-2.1], [0.05], [2.2]], labels: ["M"], units: ["emu"], metadata: {} },
  };

  it("loads the fit with its band verbatim", () => {
    const doc = sanitizeFigureDocument(v2Overlays)!;
    expect(doc.overlays?.fit?.y).toEqual([-2.05, 0, 2.05]);
    expect(doc.overlays?.fit?.band?.map((edge) => edge.label)).toEqual(["95% CI low", "95% CI high"]);
  });

  it("its rows key still matches the dataset it was saved against, so it is drawn", () => {
    const doc = sanitizeFigureDocument(v2Overlays)!;
    expect(overlayRowsKey(LOOP)).toBe(doc.overlays!.rows);
    expect(fitFromDocument(doc.overlays, LOOP)?.y).toEqual([-2.05, 0, 2.05]);
  });

  it("re-saving then reloading is idempotent", () => {
    const once = serializeFigureDocument(sanitizeFigureDocument(v2Overlays)!);
    expect(serializeFigureDocument(sanitizeFigureDocument(JSON.parse(once))!)).toBe(once);
  });

  it("a malformed section never breaks the load and is never drawn", () => {
    const broken = { ...(v2Overlays as Record<string, unknown>), overlays: { rows: "2e5d5110f8f878b1.c0a4ad40", fit: { binding: {}, y: "nope" } } };
    const doc = sanitizeFigureDocument(broken);
    expect(doc?.name).toBe("Hysteresis with tanh fit");
    // The eager load path only shape-checks it; the curve is validated where drawn.
    expect(fitFromDocument(doc!.overlays, LOOP)).toBeNull();
    expect(sanitizeFigureDocument({ ...(v2Overlays as Record<string, unknown>), overlays: "nope" })).not.toHaveProperty("overlays");
  });
});
