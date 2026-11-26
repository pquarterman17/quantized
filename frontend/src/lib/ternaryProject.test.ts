// The ternary workshop's per-dataset settings (plan item 21): sanitizer rules,
// and the save / reopen round trip through the real .dwk codec. Old projects
// (no `ternaryFigures`) must open unchanged and re-save byte-identically.
import { beforeEach, describe, expect, it } from "vitest";

import v4 from "./__fixtures__/workspace/v4.dwk.json";
import { buildTernaryRequest } from "../components/workshops/ternary/ternaryRequest";
import { useTernaryFigures } from "../store/ternaryFigures";
import { sanitizeTernaryFigures, ternaryFiguresForSave, DEFAULT_TERNARY_FIELD, type TernarySaved } from "./ternaryProject";
import type { DataStruct } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const VIEWPORT = { width: 1600, height: 900 };
const SAVED: TernarySaved = {
  picks: { a: 0, b: 1, c: 2, colorBy: 3 },
  field: { kind: "contour", cmap: "magma", levels: 12, lines: false, labels: true },
};

beforeEach(() => useTernaryFigures.setState({ byDataset: {} }));

describe("sanitizeTernaryFigures", () => {
  it("keeps a valid entry, drops unknown datasets and malformed entries", () => {
    const raw = {
      d1: SAVED,
      gone: SAVED,
      bad1: { picks: { a: 0, b: 1 }, field: {} },
      bad2: "x",
      bad3: { picks: { a: 0.5, b: 1, c: 2 } },
    };
    const out = sanitizeTernaryFigures(raw, new Set(["d1", "bad1", "bad2", "bad3"]));
    expect(Object.keys(out)).toEqual(["d1"]);
    expect(out.d1).toEqual(SAVED);
  });

  it("repairs a bad field value to its default rather than dropping the entry", () => {
    const out = sanitizeTernaryFigures(
      { d1: { picks: { a: 0, b: 1, c: 2, colorBy: null }, field: { kind: "surface", cmap: "jet", levels: 999, lines: "y" } } },
      new Set(["d1"]),
    );
    expect(out.d1.field).toEqual({ ...DEFAULT_TERNARY_FIELD, levels: 64 });
    expect(out.d1.picks.colorBy).toBeNull();
  });

  it("anything that is not an object is no settings", () => {
    for (const raw of [undefined, null, 3, "s", []]) expect(sanitizeTernaryFigures(raw, new Set(["d1"]))).toEqual({});
  });
});

describe("ternaryFiguresForSave", () => {
  it("writes only datasets still in the project, and nothing at all when none", () => {
    expect(ternaryFiguresForSave({ a: SAVED, b: SAVED }, ["a"])).toEqual({ a: SAVED });
    expect(ternaryFiguresForSave({ a: SAVED }, ["z"])).toBeUndefined();
    expect(ternaryFiguresForSave({}, ["a"])).toBeUndefined();
  });
});

describe("the .dwk round trip", () => {
  it("an older project opens with no settings and re-saves without the key", () => {
    const loaded = parseWorkspace(JSON.stringify(v4), VIEWPORT);
    expect(loaded.ternaryFigures).toEqual({});
    expect(JSON.parse(serializeWorkspace(loaded)).ternaryFigures).toBeUndefined();
  });

  it("chosen settings survive save and reopen, keyed to their dataset", () => {
    const loaded = parseWorkspace(JSON.stringify(v4), VIEWPORT);
    const id = loaded.datasets[0].id;
    useTernaryFigures.getState().save(id, SAVED);
    useTernaryFigures.getState().save("not-in-project", SAVED);
    const text = serializeWorkspace(loaded);
    expect(Object.keys(JSON.parse(text).ternaryFigures)).toEqual([id]);
    const again = parseWorkspace(text, VIEWPORT);
    expect(again.ternaryFigures).toEqual({ [id]: SAVED });
    // Reopen = the store adopts it, and the request it builds is the saved map.
    useTernaryFigures.setState({ byDataset: {} });
    useTernaryFigures.getState().adopt(again.ternaryFigures!);
    expect(useTernaryFigures.getState().byDataset[id]).toEqual(SAVED);
  });

  it("the saved field drives the request: a map, with the saved colormap and levels", () => {
    const data: DataStruct = {
      time: [1, 2, 3],
      values: [[0.2, 0.3, 0.5, 1], [0.5, 0.25, 0.25, 2], [0.1, 0.1, 0.8, 3]],
      labels: ["a", "b", "c", "z"],
      units: ["", "", "", "K"],
      metadata: {},
    };
    const spec = buildTernaryRequest(data, SAVED.picks, { title: "", filename: "t", field: SAVED.field }).spec;
    expect(spec).toMatchObject({ kind: "contour", cmap: "magma", levels: 12, contour_lines: false, contour_labels: true, z_label: "z (K)" });
  });
});
