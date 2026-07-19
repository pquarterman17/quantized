// Tests for the Graph Builder store slice (GUI_INTERACTION_PLAN #11 —
// "Graph Builder → durable artifact"), composed into useApp — see
// store/graphBuilder.ts's header for why it's a standalone slice (store-size
// ratchet headroom) and why it also owns the pre-existing open/seed
// handshake (relocated verbatim from useApp.ts).

import { beforeEach, describe, expect, it } from "vitest";

import { emptySpec, type PlotSpec } from "../lib/plotspec";
import { useApp } from "./useApp";

const spec = (channel: number): PlotSpec => ({
  version: 1,
  zones: { x: null, y: [{ datasetId: "d1", channel }], group: null, facet: null },
  mark: "scatter",
});

beforeEach(() => {
  useApp.setState({
    savedPlotSpecs: [],
    activePlotSpecId: null,
    graphBuilderSeed: null,
    graphBuilderOpen: false,
    history: [],
    future: [],
  });
});

describe("initial state", () => {
  it("starts with no saved specs and nothing active", () => {
    expect(useApp.getState().savedPlotSpecs).toEqual([]);
    expect(useApp.getState().activePlotSpecId).toBeNull();
  });
});

describe("saveAsPlotSpec", () => {
  it("creates a new entry, trims the name, and makes it active", () => {
    const id = useApp.getState().saveAsPlotSpec("  My graph  ", spec(1));
    const saved = useApp.getState().savedPlotSpecs;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id, name: "My graph", spec: spec(1) });
    expect(saved[0].createdAt).toBe(saved[0].modifiedAt);
    expect(useApp.getState().activePlotSpecId).toBe(id);
  });

  it("falls back to 'Untitled graph' for a blank name", () => {
    useApp.getState().saveAsPlotSpec("   ", spec(1));
    expect(useApp.getState().savedPlotSpecs[0].name).toBe("Untitled graph");
  });

  it("issues distinct ids for two saves", () => {
    const a = useApp.getState().saveAsPlotSpec("A", spec(1));
    const b = useApp.getState().saveAsPlotSpec("B", spec(2));
    expect(a).not.toBe(b);
    expect(useApp.getState().savedPlotSpecs).toHaveLength(2);
  });
});

describe("savePlotSpec (update in place)", () => {
  it("returns null and writes nothing when nothing is active", () => {
    const result = useApp.getState().savePlotSpec(spec(1));
    expect(result).toBeNull();
    expect(useApp.getState().savedPlotSpecs).toEqual([]);
  });

  it("overwrites the active entry's spec and bumps modifiedAt, leaving the name alone", () => {
    const id = useApp.getState().saveAsPlotSpec("Mine", spec(1));
    const before = useApp.getState().savedPlotSpecs[0];
    const result = useApp.getState().savePlotSpec(spec(2));
    expect(result).toBe(id);
    const after = useApp.getState().savedPlotSpecs[0];
    expect(after.spec).toEqual(spec(2));
    expect(after.name).toBe("Mine");
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("leaves other entries untouched", () => {
    const a = useApp.getState().saveAsPlotSpec("A", spec(1));
    useApp.getState().saveAsPlotSpec("B", spec(2)); // now active
    useApp.getState().setActivePlotSpecId(a);
    useApp.getState().savePlotSpec(spec(9));
    const saved = useApp.getState().savedPlotSpecs;
    expect(saved.find((p) => p.name === "A")!.spec).toEqual(spec(9));
    expect(saved.find((p) => p.name === "B")!.spec).toEqual(spec(2));
  });
});

describe("duplicatePlotSpec", () => {
  it("copies the entry's STORED spec under an auto-numbered name and activates it", () => {
    const id = useApp.getState().saveAsPlotSpec("Original", spec(1));
    const dupId = useApp.getState().duplicatePlotSpec(id);
    expect(dupId).not.toBeNull();
    expect(dupId).not.toBe(id);
    const saved = useApp.getState().savedPlotSpecs;
    expect(saved).toHaveLength(2);
    const dup = saved.find((p) => p.id === dupId)!;
    expect(dup.name).toBe("Original copy");
    expect(dup.spec).toEqual(spec(1));
    expect(useApp.getState().activePlotSpecId).toBe(dupId);
  });

  it("auto-increments when 'copy' already exists", () => {
    const id = useApp.getState().saveAsPlotSpec("Original", spec(1));
    useApp.getState().duplicatePlotSpec(id);
    const dup2Id = useApp.getState().duplicatePlotSpec(id);
    const dup2 = useApp.getState().savedPlotSpecs.find((p) => p.id === dup2Id)!;
    expect(dup2.name).toBe("Original copy 2");
  });

  it("returns null for an unknown id and writes nothing", () => {
    expect(useApp.getState().duplicatePlotSpec("nope")).toBeNull();
    expect(useApp.getState().savedPlotSpecs).toEqual([]);
  });
});

describe("renamePlotSpec", () => {
  it("renames without touching the spec or timestamps", () => {
    const id = useApp.getState().saveAsPlotSpec("Old name", spec(1));
    const before = useApp.getState().savedPlotSpecs[0];
    useApp.getState().renamePlotSpec(id, "  New name  ");
    const after = useApp.getState().savedPlotSpecs[0];
    expect(after.name).toBe("New name");
    expect(after.spec).toEqual(before.spec);
    expect(after.modifiedAt).toBe(before.modifiedAt);
  });

  it("ignores a blank name (keeps the old one)", () => {
    const id = useApp.getState().saveAsPlotSpec("Keep me", spec(1));
    useApp.getState().renamePlotSpec(id, "   ");
    expect(useApp.getState().savedPlotSpecs[0].name).toBe("Keep me");
  });
});

describe("deletePlotSpec", () => {
  it("removes the entry", () => {
    const id = useApp.getState().saveAsPlotSpec("Gone soon", spec(1));
    useApp.getState().deletePlotSpec(id);
    expect(useApp.getState().savedPlotSpecs).toEqual([]);
  });

  it("clears activePlotSpecId only when it pointed at the deleted entry", () => {
    const a = useApp.getState().saveAsPlotSpec("A", spec(1));
    const b = useApp.getState().saveAsPlotSpec("B", spec(2)); // B active
    useApp.getState().deletePlotSpec(a); // deleting a non-active entry
    expect(useApp.getState().activePlotSpecId).toBe(b);
    useApp.getState().deletePlotSpec(b);
    expect(useApp.getState().activePlotSpecId).toBeNull();
  });
});

describe("edit history", () => {
  it("undoes and redoes a saved graph specification with its active binding", () => {
    const id = useApp.getState().saveAsPlotSpec("Reusable", spec(1));
    expect(useApp.getState().history.at(-1)?.label).toBe("Save graph specification");

    useApp.getState().undo();
    expect(useApp.getState().savedPlotSpecs).toEqual([]);
    expect(useApp.getState().activePlotSpecId).toBeNull();

    useApp.getState().redo();
    expect(useApp.getState().savedPlotSpecs).toHaveLength(1);
    expect(useApp.getState().savedPlotSpecs[0].id).toBe(id);
    expect(useApp.getState().activePlotSpecId).toBe(id);
  });
});

describe("setActivePlotSpecId", () => {
  it("writes the id verbatim (no validation — callers resolve it)", () => {
    useApp.getState().setActivePlotSpecId("whatever");
    expect(useApp.getState().activePlotSpecId).toBe("whatever");
    useApp.getState().setActivePlotSpecId(null);
    expect(useApp.getState().activePlotSpecId).toBeNull();
  });
});

// Relocated verbatim from useApp.ts (store-size ratchet offset) — the public
// API is unchanged, re-asserted here as the slice's own regression coverage.
describe("graphBuilderOpen / graphBuilderSeed (relocated)", () => {
  it("openGraphBuilderSeeded stores the seed and opens the panel", () => {
    const s = spec(1);
    useApp.getState().openGraphBuilderSeeded(s);
    expect(useApp.getState().graphBuilderSeed).toEqual(s);
    expect(useApp.getState().graphBuilderOpen).toBe(true);
  });

  it("clearGraphBuilderSeed drops the seed, leaving the panel open", () => {
    useApp.getState().openGraphBuilderSeeded(emptySpec());
    useApp.getState().clearGraphBuilderSeed();
    expect(useApp.getState().graphBuilderSeed).toBeNull();
    expect(useApp.getState().graphBuilderOpen).toBe(true);
  });

  it("setGraphBuilderOpen toggles independent of the seed", () => {
    useApp.getState().setGraphBuilderOpen(true);
    expect(useApp.getState().graphBuilderOpen).toBe(true);
    useApp.getState().setGraphBuilderOpen(false);
    expect(useApp.getState().graphBuilderOpen).toBe(false);
  });
});
