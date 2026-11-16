// Gap audit 5 lane J (L5): saved Recode mappings survive Save -> reopen
// through the REAL serializer and parser, force .dwk v6 (v0.34.0 drops the
// field), and the store installs / clears them on load (no cross-project leak).
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { shouldAutosave } from "../useWorkspaceAutosave";
import type { SavedRecodeMapping } from "./recode";
import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { featuresV034WouldDrop } from "./workspaceForwardCompat";

const saved: SavedRecodeMapping[] = [
  {
    id: "recode-1",
    name: "Pass / Fail",
    mapping: { groups: [{ newLabel: "Passing", from: ["Pass", "OK"] }] },
    sourceLevels: ["Pass", "OK", "Fail"],
    createdAt: "2026-11-16T12:00:00.000Z",
  },
];

const ds: Dataset = {
  id: "d1",
  name: "grades",
  data: { time: [0, 1], values: [[0], [1]], labels: ["Grade"], units: [""], metadata: {}, cat_levels: { 0: ["Pass", "Fail"] } },
};

beforeEach(() => {
  useApp.setState({ savedRecodeMappings: [] });
});

describe("saved Recode mappings in the .dwk", () => {
  it("round-trip exactly", () => {
    const loaded = parseWorkspace(serializeWorkspace({ datasets: [ds], savedRecodeMappings: saved }));
    expect(loaded.savedRecodeMappings).toEqual(saved);
  });

  it("are omitted when empty, so an ordinary project's file does not change", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds], savedRecodeMappings: [] })) as Record<string, unknown>;
    expect("savedRecodeMappings" in doc).toBe(false);
    expect(parseWorkspace(JSON.stringify(doc)).savedRecodeMappings).toEqual([]);
  });

  it("make the file v6 (v0.34.0 would drop them) and an empty list does not", () => {
    const v = (t: string) => (JSON.parse(t) as { version: number }).version;
    expect(v(serializeWorkspace({ datasets: [ds], savedRecodeMappings: saved }))).toBe(6);
    expect(v(serializeWorkspace({ datasets: [ds] }))).toBe(4);
    expect(featuresV034WouldDrop(JSON.parse(serializeWorkspace({ datasets: [ds], savedRecodeMappings: saved })))).toEqual(["Workspace.savedRecodeMappings"]);
  });

  it("drop malformed entries on load, and refuse a mapping with a bad group whole", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds], savedRecodeMappings: saved })) as Record<string, unknown>;
    doc.savedRecodeMappings = [
      ...saved,
      { ...saved[0], id: "dup-name-ok", name: "second" },
      { ...saved[0], id: "recode-1", name: "duplicate id" },
      { ...saved[0], id: "bad-group", mapping: { groups: [{ newLabel: "X", from: ["a"] }, { newLabel: 5, from: ["b"] }] } },
      { ...saved[0], id: "no-name", name: " " },
      { ...saved[0], id: "bad-levels", sourceLevels: [1] },
      3,
      null,
    ];
    const got = parseWorkspace(JSON.stringify(doc)).savedRecodeMappings ?? [];
    expect(got.map((m) => m.id)).toEqual(["recode-1", "dup-name-ok"]);
    doc.savedRecodeMappings = "nope";
    expect(parseWorkspace(JSON.stringify(doc)).savedRecodeMappings).toEqual([]);
  });

  it("are installed by loadWorkspace and cleared by a project without them", () => {
    useApp.getState().loadWorkspace({ datasets: [ds], savedRecodeMappings: saved });
    expect(useApp.getState().savedRecodeMappings).toEqual(saved);
    useApp.getState().loadWorkspace({ datasets: [ds] });
    expect(useApp.getState().savedRecodeMappings).toEqual([]);
  });

  it("a mapping edit schedules an autosave", () => {
    const state = useApp.getState();
    expect(shouldAutosave({ ...state, savedRecodeMappings: saved }, state)).toBe(true);
  });
});
