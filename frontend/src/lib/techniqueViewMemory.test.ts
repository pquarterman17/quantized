// PLOT_WORKFLOW_PLAN item 5: per-technique view memory — the pure
// capture/apply/sanitize core. Integration with `store/windows.ts`'s
// `datasetViewDefaults` (the store-facing precedence: memory > technique
// defaults > density heuristic) is covered separately in windows.test.ts.

import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import {
  applyTechniqueMemory,
  captureTechniqueView,
  sanitizeTechniqueViewMemory,
  type LiveViewSource,
  type TechniqueViewMemoryMap,
} from "./techniqueViewMemory";

/** The field names `LiveViewSource` declares, read out of the module's own
 *  source — the `PlotView` precedent in `architecture.test.ts`, for the same
 *  reason: a hand-maintained copy of an interface's key list silently stops
 *  matching the interface. */
const techniqueViewMemorySrc = Object.values(
  import.meta.glob("./techniqueViewMemory.ts", { query: "?raw", import: "default", eager: true }),
)[0] as string;

function liveViewSourceFields(): string[] {
  const body = /export interface LiveViewSource\s*{([\s\S]*?)^}/m.exec(techniqueViewMemorySrc)?.[1] ?? "";
  const fields = [...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map((m) => m[1]);
  // Guard the guard: a parse that degrades to nothing would make the key-set
  // assertion below vacuously weak instead of failing loudly.
  if (fields.length < 9) throw new Error("LiveViewSource parse degraded — guard would silently weaken");
  return fields;
}

function ds(id: string, technique: string, labels: string[]): Dataset {
  return {
    id,
    name: id,
    data: {
      time: [0, 1, 2],
      values: labels.map(() => [0, 1, 2]),
      labels,
      units: labels.map(() => ""),
      metadata: { technique },
    },
  };
}

/** A minimal fully-default live view, overridden field by field per test. */
function view(overrides: Partial<LiveViewSource> = {}): LiveViewSource {
  return {
    xKey: null,
    yKeys: null,
    yScale: "linear",
    xScale: "linear",
    seriesStyles: {},
    seriesLabels: {},
    seriesOrder: null,
    errKeys: {},
    hiddenChannels: [],
    ...overrides,
  };
}

describe("captureTechniqueView", () => {
  it("no-ops (identity) with no outgoing dataset", () => {
    const memory: TechniqueViewMemoryMap = {};
    expect(captureTechniqueView(undefined, view(), memory)).toBe(memory);
  });

  it("no-ops for a generic outgoing dataset (owner decision: no memory for generic)", () => {
    const memory: TechniqueViewMemoryMap = {};
    const generic = ds("d1", "generic", ["Time", "Y"]);
    expect(captureTechniqueView(generic, view({ yKeys: [1] }), memory)).toBe(memory);
  });

  it("captures the outgoing view keyed by its technique, plus the referenced channels' labels", () => {
    const xrd = ds("d1", "xrd.powder", ["2theta", "Intensity"]);
    const v = view({ xKey: 0, yKeys: [1], yScale: "log", seriesStyles: { 1: { color: "red" } } });
    const memory = captureTechniqueView(xrd, v, {});
    const entry = memory["xrd.powder"];
    expect(entry?.yKeys).toEqual([1]);
    expect(entry?.yScale).toBe("log");
    expect(entry?.seriesStyles).toEqual({ 1: { color: "red" } });
    expect(entry?.labels).toEqual({ 0: "2theta", 1: "Intensity" });
  });

  // BUG-019. `LiveViewSource` is satisfied structurally, so both real call
  // sites hand in something far wider than it: `store/windows.ts`'s
  // `focusedRebindPatch` and `store/workspaceIO.ts`'s save path both pass the
  // WHOLE `AppState` (which carries `datasets`, `plotWindows` and the
  // previous `techniqueViewMemory`), and the background-window rebind passes
  // a full `PlotView`. A `{ ...liveView }` spread copied all of it, so every
  // capture nested the previous map inside the new one and the serialized
  // size compounded per dataset switch. The entry must hold the nine declared
  // fields plus `labels` and NOTHING else.
  it("stores only the nine declared view fields, never the wider object handed in", () => {
    const xrd = ds("d1", "xrd.powder", ["2theta", "Intensity"]);
    const wide = {
      ...view({ xKey: 0, yKeys: [1] }),
      // The AppState fields that made this unbounded.
      datasets: [ds("bulk", "xrd.powder", ["2theta", "Intensity"])],
      plotWindows: [{ id: "win-1" }],
      techniqueViewMemory: { "xrd.rsm": { nested: true } },
      addDataset: () => undefined,
    } as unknown as LiveViewSource;

    const entry = captureTechniqueView(xrd, wide, {})["xrd.powder"];
    // The expected key list is PARSED from the `LiveViewSource` interface
    // rather than hardcoded, following `architecture.test.ts`'s `PlotView`
    // precedent: a hardcoded list rots the moment the interface gains a
    // field, and this test's whole job is to notice a mismatch between what
    // the interface declares and what the capture stores.
    expect(Object.keys(entry ?? {}).sort()).toEqual([...liveViewSourceFields(), "labels"].sort());
  });

  // The measurable consequence, at this layer: feeding each capture's OWN
  // output back in as part of the next source (exactly what the store does —
  // `captureTechniqueView(prevDs, s, s.techniqueViewMemory)` where
  // `s.techniqueViewMemory` is the previous result) must not compound.
  it("repeated captures that re-feed the previous map do not grow it", () => {
    const a = ds("d1", "xrd.powder", ["2theta", "Intensity"]);
    const b = ds("d2", "xrd.rsm", ["2theta", "Intensity"]);
    let memory: TechniqueViewMemoryMap = {};
    const sizes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const source = { ...view({ yKeys: [1] }), techniqueViewMemory: memory } as unknown as LiveViewSource;
      memory = captureTechniqueView(i % 2 === 0 ? a : b, source, memory);
      sizes.push(JSON.stringify(memory).length);
    }
    // Both techniques are present from the second capture on, and the size
    // never moves after that — no nesting, no compounding.
    expect(new Set(sizes.slice(1)).size).toBe(1);
    expect(sizes[sizes.length - 1]).toBeLessThan(1000);
  });
});

describe("applyTechniqueMemory — capture-on-switch + apply-on-return round trip", () => {
  it("a later same-technique dataset gets the captured view back", () => {
    const first = ds("d1", "xrd.powder", ["2theta", "Intensity"]);
    const outgoingView = view({ xKey: 0, yKeys: [1], yScale: "log", hiddenChannels: [] });
    const memory = captureTechniqueView(first, outgoingView, {});

    // A different XRD dataset, same column labels (the common case) — the
    // remembered view resolves verbatim.
    const second = ds("d2", "xrd.powder", ["2theta", "Intensity"]);
    const resolved = applyTechniqueMemory(second, memory);
    expect(resolved).not.toBeNull();
    expect(resolved?.xKey).toBe(0);
    expect(resolved?.yKeys).toEqual([1]);
    expect(resolved?.yScale).toBe("log");
  });

  // BOTH axis scales are in the remembered field set, and `xScale` is the one
  // that had no coverage at all: replacing `xScale: v.xScale` with a literal
  // `"linear"` in `projectLiveView` passed the entire 11,592-test suite
  // (review of `f8d72f43`). A log x-axis is the normal view for a
  // reflectometry or SIMS depth profile, so silently forgetting it per
  // technique is a real regression with no other guard.
  it("remembers a log X axis, not just a log Y", () => {
    const first = ds("d1", "reflectometry", ["Q", "R"]);
    const memory = captureTechniqueView(first, view({ yKeys: [1], xScale: "log", yScale: "log" }), {});
    expect(memory["reflectometry"]?.xScale).toBe("log");

    const resolved = applyTechniqueMemory(ds("d2", "reflectometry", ["Q", "R"]), memory);
    expect(resolved?.xScale).toBe("log");
    expect(resolved?.yScale).toBe("log");
  });

  it("returns null (no memory) for a technique that was never captured", () => {
    const vsm = ds("d1", "magnetometry.mvsh", ["Field", "Moment"]);
    expect(applyTechniqueMemory(vsm, {})).toBeNull();
  });
});

describe("applyTechniqueMemory — label re-key on a reordered-columns dataset", () => {
  it("re-keys yKeys/seriesStyles/seriesLabels/seriesOrder/hiddenChannels/errKeys by column label", () => {
    const first = ds("d1", "xrd.powder", ["2theta", "Intensity", "Bg"]);
    const outgoingView = view({
      xKey: 0,
      yKeys: [1],
      seriesStyles: { 1: { color: "red" } },
      seriesLabels: { 1: "Peak" },
      seriesOrder: [1],
      hiddenChannels: [2],
      errKeys: { 1: 2 }, // Intensity's error is Bg, say
    });
    const memory = captureTechniqueView(first, outgoingView, {});

    // Columns shuffled: Intensity moved from index 1 -> 2, Bg from 2 -> 1.
    const reordered = ds("d2", "xrd.powder", ["2theta", "Bg", "Intensity"]);
    const resolved = applyTechniqueMemory(reordered, memory);
    expect(resolved?.xKey).toBe(0); // "2theta" stayed at 0
    expect(resolved?.yKeys).toEqual([2]); // "Intensity" is now at 2
    expect(resolved?.seriesStyles).toEqual({ 2: { color: "red" } });
    expect(resolved?.seriesLabels).toEqual({ 2: "Peak" });
    expect(resolved?.seriesOrder).toEqual([2]);
    expect(resolved?.hiddenChannels).toEqual([1]); // "Bg" is now at 1
    expect(resolved?.errKeys).toEqual({ 2: 1 }); // Intensity(2) -> Bg(1)
  });
});

describe("applyTechniqueMemory — resolution failure falls through (the shape-mismatch reset rule)", () => {
  it("yKeys resolving to NOTHING returns null (caller falls back to technique defaults)", () => {
    const first = ds("d1", "xrd.powder", ["2theta", "Intensity"]);
    const memory = captureTechniqueView(first, view({ yKeys: [1] }), {});

    // A totally different-shaped XRD dataset — none of the captured labels exist.
    const mismatched = ds("d2", "xrd.powder", ["Time", "Counts"]);
    expect(applyTechniqueMemory(mismatched, memory)).toBeNull();
  });

  it("a PARTIAL resolution (some channels resolve, others don't) is not a mismatch", () => {
    const first = ds("d1", "xrd.powder", ["2theta", "Intensity", "Bg"]);
    const memory = captureTechniqueView(
      first,
      view({ yKeys: [1, 2], hiddenChannels: [2] }),
      {},
    );
    // "Bg" is gone on the new dataset; "Intensity" survives.
    const partial = ds("d2", "xrd.powder", ["2theta", "Intensity"]);
    const resolved = applyTechniqueMemory(partial, memory);
    expect(resolved).not.toBeNull();
    expect(resolved?.yKeys).toEqual([1]); // only "Intensity" resolved
    expect(resolved?.hiddenChannels).toEqual([]); // "Bg" dropped, not defaulted
  });
});

describe("applyTechniqueMemory — generic gets no memory", () => {
  it("never applies, even if the memory map happens to carry a 'generic' entry", () => {
    const generic = ds("d1", "generic", ["A", "B"]);
    // Bypassing captureTechniqueView (which never writes "generic") to prove
    // applyTechniqueMemory itself enforces the rule, not just the writer side.
    const memory: TechniqueViewMemoryMap = {
      generic: { ...view({ yKeys: [1] }), labels: { 1: "B" } },
    };
    expect(applyTechniqueMemory(generic, memory)).toBeNull();
  });
});

describe("captureTechniqueView — memory does not leak across techniques", () => {
  it("capturing a VSM view leaves a previously-captured XRD slot untouched", () => {
    const xrd = ds("d1", "xrd.powder", ["2theta", "Intensity"]);
    let memory = captureTechniqueView(xrd, view({ yKeys: [1], yScale: "log" }), {});
    const xrdEntry = memory["xrd.powder"];

    const vsm = ds("d2", "magnetometry.mvsh", ["Field", "Moment"]);
    memory = captureTechniqueView(vsm, view({ yKeys: [1], yScale: "linear" }), memory);

    expect(memory["xrd.powder"]).toEqual(xrdEntry); // untouched by the VSM capture
    expect(memory["magnetometry.mvsh"]?.yScale).toBe("linear");
    expect(memory["magnetometry.mvsh"]).not.toEqual(memory["xrd.powder"]);
  });
});

describe("sanitizeTechniqueViewMemory — the .dwk untrusted-boundary parse", () => {
  it("absent/malformed input sanitizes to {}", () => {
    expect(sanitizeTechniqueViewMemory(undefined)).toEqual({});
    expect(sanitizeTechniqueViewMemory(null)).toEqual({});
    expect(sanitizeTechniqueViewMemory("not an object")).toEqual({});
  });

  it("drops a 'generic' key and an unrecognized technique string", () => {
    const raw = {
      generic: { xKey: 0, yKeys: [1], yScale: "log", xScale: "linear" },
      "some.future.tag": { xKey: 0, yKeys: [1], yScale: "log", xScale: "linear" },
      "xrd.powder": { xKey: 0, yKeys: [1], yScale: "log", xScale: "linear" },
    };
    const out = sanitizeTechniqueViewMemory(raw);
    expect(Object.keys(out)).toEqual(["xrd.powder"]);
  });

  it("round-trips a full entry losslessly", () => {
    const raw: TechniqueViewMemoryMap = {
      "xrd.powder": {
        xKey: 0,
        yKeys: [1],
        yScale: "log",
        xScale: "linear",
        seriesStyles: { 1: { color: "red", width: 2 } },
        seriesLabels: { 1: "Peak" },
        seriesOrder: [1],
        errKeys: { 1: 2 },
        hiddenChannels: [2],
        labels: { 0: "2theta", 1: "Intensity", 2: "Bg" },
      },
    };
    expect(sanitizeTechniqueViewMemory(JSON.parse(JSON.stringify(raw)))).toEqual(raw);
  });

  // BUG-014 round 5: every map on this entry is CHANNEL-indexed and read back
  // by numeric index (`remembered.labels[ch]`) or through `Number(key)`, so a
  // hand-edited `"01"` has to normalize onto channel 1 — the behaviour the
  // file's own private `strRecord`/`numRecord` had before the shared
  // sanitizer landed. `lib/plotview.ts`'s map is the one with the opposite
  // (verbatim) policy; see `sanitizeRecord.test.ts`.
  it("normalizes a non-canonical numeric key onto its channel, and drops a non-numeric one", () => {
    const out = sanitizeTechniqueViewMemory({
      "xrd.powder": {
        xKey: 0,
        yKeys: [1],
        yScale: "linear",
        xScale: "linear",
        seriesLabels: { "01": "Peak", abc: "dropped", "2": 42 },
        errKeys: { "01": 2, xyz: 3 },
        labels: { "01": "Intensity" },
      },
    });
    const entry = out["xrd.powder"]!;
    expect(entry.labels).toEqual({ 1: "Intensity" });
    expect(entry.seriesLabels).toEqual({ 1: "Peak" });
    expect(entry.errKeys).toEqual({ 1: 2 });
  });

  // BUG-014 round-5 review F1: `remembered.labels[ch]` is read by NUMERIC
  // index, so a blank key surviving as channel `0` silently renames channel
  // 0 and binds a stray error column to it. A hand-edited or truncated
  // `.dwk` is exactly the untrusted boundary this sanitizer exists for.
  it("drops a blank or whitespace-only key instead of silently renaming channel 0", () => {
    const out = sanitizeTechniqueViewMemory({
      "xrd.powder": {
        xKey: 0,
        yKeys: [1],
        yScale: "linear",
        xScale: "linear",
        seriesLabels: { "": "GHOST2" },
        errKeys: { "": 7 },
        labels: { "": "GHOST", "1": "Real" },
      },
    });
    const entry = out["xrd.powder"]!;
    expect(entry.labels).toEqual({ 1: "Real" });
    expect(entry.seriesLabels).toEqual({});
    expect(entry.errKeys).toEqual({});
  });
});
