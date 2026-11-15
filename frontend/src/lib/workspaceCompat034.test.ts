// Backward compatibility with files written by the RELEASED v0.34.0.
//
// Unlike the v1-v4 fixtures (built by this tree's serializer, then downgraded
// field by field), the four `*-0.34.0.*` fixtures were written by v0.34.0's
// OWN code: `tools/compat/gen_v034_fixtures.test.ts` run against a
// `git archive v0.34.0` copy of `frontend/` (see the fixtures README). They
// hold a workspace with an Origin-style workbook, a plot window with a Y axis
// break, a second Y axis, error bars and series styles, an editable figure
// with an axis break, a saved (legacy) figure, a pipeline fit step, a plot
// recipe, a graph template exactly as v0.34.0 kept it in localStorage, and a
// standalone recipe file.
//
// `v4-0.34.0.expected.json` is what v0.34.0 itself READ BACK from those
// files. The contract pinned here: everything v0.34.0 showed, this build
// shows too, unchanged. New fields may be ADDED (defaults for features 0.34
// did not have); no field v0.34.0 produced may change or disappear.
import { afterEach, describe, expect, it } from "vitest";

import expected from "./__fixtures__/workspace/v4-0.34.0.expected.json";
import graphTemplates034 from "./__fixtures__/workspace/graphTemplates-0.34.0.json";
import recipe034 from "./__fixtures__/workspace/plotRecipe-0.34.0.json";
import dwk034 from "./__fixtures__/workspace/v4-0.34.0.dwk.json";
import { loadGraphTemplates } from "./figuredoc";
import { parseRecipe } from "./plotRecipeIO";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const VIEWPORT = { width: 1600, height: 900 };

/** Pipeline step ids are minted fresh on every parse (the fixtures README's
 *  "known, deliberate non-determinism"), so they are not compared. */
function withoutStepIds<T>(ws: T): T {
  const o = JSON.parse(JSON.stringify(ws)) as { macroSteps?: { id?: string }[] };
  o.macroSteps?.forEach((s) => delete s.id);
  return o as T;
}

/** Every path where `want` (what v0.34.0 read) is not reproduced in `got`.
 *  Objects: each key of `want` must be present in `got` and match (extra keys
 *  in `got` are new features, allowed). Arrays: same length, element-wise. */
function missing(want: unknown, got: unknown, path = "$"): string[] {
  if (want === null || typeof want !== "object") {
    return Object.is(want, got) ? [] : [`${path}: 0.34 had ${JSON.stringify(want)}, now ${JSON.stringify(got)}`];
  }
  if (Array.isArray(want)) {
    if (!Array.isArray(got)) return [`${path}: 0.34 had an array, now ${JSON.stringify(got)}`];
    if (got.length !== want.length) return [`${path}: 0.34 had ${want.length} items, now ${got.length}`];
    return want.flatMap((w, i) => missing(w, got[i], `${path}[${i}]`));
  }
  if (got === null || typeof got !== "object") return [`${path}: 0.34 had an object, now ${JSON.stringify(got)}`];
  // Through JSON, as the expected file went, so a `undefined` field compares as absent.
  const g = JSON.parse(JSON.stringify(got)) as Record<string, unknown>;
  return Object.entries(want as Record<string, unknown>).flatMap(([k, w]) =>
    k in g ? missing(w, g[k], `${path}.${k}`) : [`${path}.${k}: present in 0.34, missing now`],
  );
}

describe("a workspace written by v0.34.0", () => {
  const text = JSON.stringify(dwk034);

  it("is the v4 format, no migration warnings", () => {
    expect(dwk034.version).toBe(4);
    expect(parseWorkspace(text, VIEWPORT).migrationWarnings).toEqual([]);
  });

  it("loads with everything v0.34.0 showed, unchanged", () => {
    expect(missing(withoutStepIds(expected.workspace), withoutStepIds(parseWorkspace(text, VIEWPORT)))).toEqual([]);
  });

  it("keeps the visible pieces this fixture exists for", () => {
    const ws = parseWorkspace(text, VIEWPORT);
    const win = ws.plotWindows?.find((w) => w.id === "w-034");
    expect(win?.view.yFmt.breaks).toEqual([[2.6, 3.4]]);
    expect(win?.view.y2Keys).toEqual([1]);
    expect(win?.view.seriesStyles[0]).toMatchObject({ color: "#d62728", markerShape: "square" });
    expect(ws.editableFigures?.find((f) => f.id === "figure-034")?.plot.axisBreaks.y).toEqual([[2.6, 3.4]]);
    expect(ws.figureDocs?.map((f) => f.id)).toEqual(["fd-034"]);
    expect(ws.macroSteps?.map((s) => s.kind)).toEqual(["expression", "fit"]);
    expect(ws.datasets.find((d) => d.id === "c")?.errorRoles).toEqual([{ channel: 2, target: 0, axis: "y", side: "both" }]);
  });

  it("survives a save and reload in this build with nothing lost", () => {
    const once = parseWorkspace(serializeWorkspace(parseWorkspace(text, VIEWPORT)), VIEWPORT);
    expect(missing(withoutStepIds(expected.workspace), withoutStepIds(once))).toEqual([]);
  });

  it("re-saves as v4, so v0.34.0 can still open it", () => {
    const saved = JSON.parse(serializeWorkspace(parseWorkspace(text, VIEWPORT))) as { version: number };
    expect(saved.version).toBe(4);
  });
});

describe("a graph template stored by v0.34.0", () => {
  afterEach(() => localStorage.removeItem("qz.graphTemplates"));

  it("loads with everything v0.34.0 showed", () => {
    localStorage.setItem("qz.graphTemplates", JSON.stringify(graphTemplates034));
    const got = loadGraphTemplates();
    expect(got.map((t) => t.name)).toEqual(["Book1 style (0.34)"]);
    expect(missing(expected.graphTemplates, got)).toEqual([]);
  });
});

describe("a plot recipe file exported by v0.34.0", () => {
  it("imports with everything v0.34.0 read", () => {
    expect(missing(expected.recipe, parseRecipe(JSON.stringify(recipe034)))).toEqual([]);
  });
});
