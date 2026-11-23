// The `.dwk` `windowLayout` key (WORKSPACE_LAYOUT_PLAN P0): written only in
// windows mode (v8), never by a classic save (byte-identical to v0.41.0's own
// serializer), and read fail-closed (a bad layout never blocks the project).
//
// Measured against the released v0.41.0 (`git archive v0.41.0 frontend`, the
// procedure in __fixtures__/workspace/README.md, run with this tree's vitest):
// its parseWorkspace + serializeWorkspace DROPPED a top-level `windowLayout`
// from a v4 and from a v7 file (the re-save had no key and was v4), it REFUSED
// `v8-window-layout.dwk.json` ("unsupported workspace version: 8"), it OPENED
// this build's classic save of the same state, and its re-save of
// `v4.dwk.json` is `v4-resave-0.41.0.dwk.json`, byte for byte.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import v4 from "./__fixtures__/workspace/v4.dwk.json";
import v8 from "./__fixtures__/workspace/v8-window-layout.dwk.json";
import { dock, emptyLayout, float } from "./windowLayout/ops";
import type { WindowLayoutV1 } from "./windowLayout/types";
import { parseWorkspace, serializeWorkspace, WORKSPACE_VERSION_POST_041, type WorkspaceState } from "./workspace";
import { featuresV041WouldDrop } from "./workspaceForwardCompat";

const VIEWPORT = { width: 1600, height: 900 };
/** v0.41.0's parseWorkspace version gate (`git show v0.41.0:frontend/src/lib/workspace.ts`). */
const V041_ACCEPTS = [1, 2, 3, 4, 5, 6, 7];

const fixture = (name: string): string => readFileSync(join(__dirname, "__fixtures__", "workspace", name), "utf8");
/** `savedAt` is the clock and a pipeline step's id is minted fresh on every
 *  parse (README "A known, deliberate non-determinism"): everything else is compared byte for byte. */
const normalise = (text: string): string =>
  text.replace(/"savedAt": "[^"]*"/, '"savedAt": ""').replace(/"id": "step-[^"]*"/g, '"id": "step-"');

const loadV4 = () => parseWorkspace(JSON.stringify(v4), VIEWPORT);
const layout = (): WindowLayoutV1 => float(dock(dock(emptyLayout(), "data", "right"), "style", "right"), "tool:curvefit");
const save = (ws: WorkspaceState): Record<string, unknown> => JSON.parse(serializeWorkspace(ws));

describe("saving the window layout", () => {
  it("a classic save is byte-identical to v0.41.0's own re-save, with a layout in state or without", () => {
    const want = normalise(fixture("v4-resave-0.41.0.dwk.json").trimEnd());
    const ws = loadV4();
    expect(normalise(serializeWorkspace(ws))).toBe(want);
    expect(normalise(serializeWorkspace({ ...ws, layoutMode: "classic", windowLayout: layout() }))).toBe(want);
  });

  it("windows mode with no layout yet writes no key either (still v4)", () => {
    const doc = save({ ...loadV4(), layoutMode: "windows", windowLayout: null });
    expect("windowLayout" in doc).toBe(false);
    expect(doc.version).toBe(4);
  });

  it("windows mode writes the layout as v8, which v0.39-v0.41 refuse", () => {
    const doc = save({ ...loadV4(), layoutMode: "windows", windowLayout: layout() });
    expect(doc.windowLayout).toEqual(layout());
    expect(doc.version).toBe(WORKSPACE_VERSION_POST_041);
    expect(featuresV041WouldDrop(doc)).toEqual(["Workspace.windowLayout"]);
    expect(V041_ACCEPTS).not.toContain(doc.version);
  });

  it("a closed plot window's placement and a pin to a removed dataset are not saved (no warning on reopen)", () => {
    const stale = { ...dock(layout(), "plot:win-closed-1", "centre"), data: { pinned: "gone", follow: "plot" as const } };
    const text = serializeWorkspace({ ...loadV4(), layoutMode: "windows", windowLayout: stale });
    const doc = JSON.parse(text) as { windowLayout: WindowLayoutV1 };
    expect(doc.windowLayout).toEqual(layout());
    expect(parseWorkspace(text, VIEWPORT).migrationWarnings).toEqual([]);
  });

  it("round trip: the parsed layout equals the saved one, with no warnings", () => {
    const text = serializeWorkspace({ ...loadV4(), layoutMode: "windows", windowLayout: layout() });
    const back = parseWorkspace(text, VIEWPORT);
    expect(back.windowLayout).toEqual(layout());
    expect(back.migrationWarnings).toEqual([]);
  });
});

describe("reading the window layout", () => {
  it("the frozen v8 fixture opens here with its layout whole (and is outside what v0.41.0 accepts)", () => {
    expect(v8.version).toBe(8);
    expect(V041_ACCEPTS).not.toContain(v8.version);
    const ws = parseWorkspace(JSON.stringify(v8), VIEWPORT);
    expect(ws.migrationWarnings).toEqual([]);
    expect(ws.windowLayout).toEqual(v8.windowLayout);
    expect(ws.datasets.map((d) => d.name)).toEqual(loadV4().datasets.map((d) => d.name));
  });

  it("a file without the key (every older one) loads with no layout", () => {
    expect(loadV4().windowLayout).toBeNull();
    expect(parseWorkspace(JSON.stringify({ ...v8, windowLayout: null }), VIEWPORT).windowLayout).toBeNull();
  });

  it("a layout from a newer version is dropped with one note; the project still opens", () => {
    const ws = parseWorkspace(JSON.stringify({ ...v8, windowLayout: { ...v8.windowLayout, v: 2 } }), VIEWPORT);
    expect(ws.windowLayout).toBeNull();
    expect(ws.datasets.length).toBe(2);
    expect(ws.migrationWarnings).toEqual(["Window layout not restored: the saved window layout is version 2, from a newer Quantized; it was reset."]);
  });

  it.each([["a string", "big"], ["a number", 3], ["an array", [1]]])("a malformed layout (%s) is dropped with a note, never thrown", (_why, bad) => {
    const ws = parseWorkspace(JSON.stringify({ ...v8, windowLayout: bad }), VIEWPORT);
    expect(ws.windowLayout).toBeNull();
    expect(ws.migrationWarnings).toHaveLength(1);
  });

  it("a placement for a plot window the file does not have, or an unknown kind, is dropped and named", () => {
    const placements = { ...v8.windowLayout.placements, "plot:win-gone-1": v8.windowLayout.placements.data, "panel:x": v8.windowLayout.placements.data };
    const ws = parseWorkspace(JSON.stringify({ ...v8, windowLayout: { ...v8.windowLayout, placements } }), VIEWPORT);
    expect(Object.keys(ws.windowLayout!.placements).sort()).toEqual(Object.keys(v8.windowLayout.placements).sort());
    expect(ws.migrationWarnings).toEqual([
      'Window layout: 2 windows not restored ("plot:win-gone-1": that plot window is not in the project; "panel:x": not a window this version knows).',
    ]);
  });

  it("a Data pin to a dataset that is not in the file is cleared", () => {
    const ws = parseWorkspace(JSON.stringify({ ...v8, windowLayout: { ...v8.windowLayout, data: { pinned: "nope", follow: "plot" } } }), VIEWPORT);
    expect(ws.windowLayout!.data.pinned).toBeNull();
  });

  it("a version outside 1-8 is still refused", () => {
    expect(() => parseWorkspace(JSON.stringify({ ...v8, version: 9 }))).toThrow(/unsupported workspace version: 9/);
  });
});
