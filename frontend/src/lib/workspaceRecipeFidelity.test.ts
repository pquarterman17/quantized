// P3.5 — did the open project's recipe lists load WHOLE?
//
// The bug this closes is metadata loss: `collectRecipes`' `complete` flag is
// the gate on pruning sidecar favorites/tags, and until now the two
// workspace-backed recipe kinds were sanitized at load with no signal exposed,
// so a project whose records were dropped still read as complete.
//
// The bug it must NOT reintroduce is the false alarm: dropping a template
// whose workbook the user deleted is a DECISION on a file that was read
// perfectly, not a fidelity failure. An earlier attempt measured after that
// prune and made deleting a workbook announce that recipe sources could not be
// read.
import { beforeEach, describe, expect, it } from "vitest";

import type { QuickPlotTemplate } from "./quickPlotTemplates";
import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace, WORKSPACE_FORMAT } from "./workspace";
import { mergeWorkspace } from "./workspaceMerge";
import { useApp } from "../store/useApp";

const dataset = (id: string): Dataset => ({
  id,
  name: `Book ${id}`,
  data: {
    time: [0, 1],
    values: [[1], [2]],
    labels: ["A"],
    units: ["emu"],
    metadata: { technique: "magnetometry.mvsh" },
  },
});

/** A template `sanitizeQuickPlotTemplates` accepts in FULL — every field it
 *  checks is present and well formed (id, name, createdAt, modifiedAt, a valid
 *  technique, a scope, a signature whose every channel has label/unit/
 *  errorRole, and a mapping). That completeness is the whole point: with a
 *  workbook scope pointing at a workbook that does not exist, the dangling
 *  prune is then provably the ONLY thing that can remove it. A fixture missing
 *  `modifiedAt` or `mapping` is dropped at SANITIZE instead and would confirm
 *  the regression for the wrong reason. */
const template = (overrides: Partial<QuickPlotTemplate> = {}): QuickPlotTemplate => ({
  id: "qpt-1",
  name: "Loop",
  createdAt: "2026-01-01T00:00:00.000Z",
  modifiedAt: "2026-01-01T00:00:00.000Z",
  scope: { kind: "schema" },
  technique: "magnetometry.mvsh",
  signature: { channels: [{ label: "A", unit: "emu", errorRole: "value" }] },
  mapping: { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [] },
  style: "line",
  labels: {},
  ...overrides,
});

/** A .dwk whose recipe fields are whatever the test wants to put there —
 *  including values a real save would never write, which is the point: the
 *  file can be hand-edited, truncated, or written by an older build. */
function docWith(fields: Record<string, unknown>): string {
  const base = JSON.parse(serializeWorkspace({ datasets: [dataset("d1")] })) as Record<string, unknown>;
  return JSON.stringify({ ...base, format: WORKSPACE_FORMAT, ...fields });
}

describe("parseWorkspace — recipeSourcesComplete", () => {
  it("is true for a project with no recipe fields at all (v1-v3 docs)", () => {
    const doc = JSON.parse(docWith({})) as Record<string, unknown>;
    delete doc.plotRecipes;
    delete doc.quickPlotTemplates;
    expect(parseWorkspace(JSON.stringify(doc)).recipeSourcesComplete).toBe(true);
  });

  it("is true for empty recipe arrays — an empty system is whole, not lossy", () => {
    const ws = parseWorkspace(docWith({ plotRecipes: [], quickPlotTemplates: [] }));
    expect(ws.recipeSourcesComplete).toBe(true);
  });

  it("is FALSE when a malformed plot recipe is dropped by the sanitizer", () => {
    const ws = parseWorkspace(docWith({ plotRecipes: [{ nope: true }] }));
    expect(ws.plotRecipes).toEqual([]); // the record is gone…
    expect(ws.recipeSourcesComplete).toBe(false); // …and the user is told
  });

  it("is FALSE when a malformed quick-plot template is dropped", () => {
    const ws = parseWorkspace(docWith({ quickPlotTemplates: [{ id: "x" }] }));
    expect(ws.quickPlotTemplates).toEqual([]);
    expect(ws.recipeSourcesComplete).toBe(false);
  });

  it("is FALSE when a recipe field is present but not an array", () => {
    expect(parseWorkspace(docWith({ plotRecipes: "corrupt" })).recipeSourcesComplete).toBe(false);
    expect(parseWorkspace(docWith({ quickPlotTemplates: { a: 1 } })).recipeSourcesComplete).toBe(false);
  });

  it("stays TRUE when a template is pruned for a dangling workbook scope", () => {
    // The regression. `workbooks: []` means the scope's workbook is gone, so
    // `pruneDanglingWorkbookScopeTemplates` drops the template — intended
    // behaviour on a healthy project, and NOT a fidelity failure.
    const ws = parseWorkspace(docWith({
      workbooks: [],
      quickPlotTemplates: [template({ scope: { kind: "workbook", workbookId: "wb-gone" } })],
    }));
    expect(ws.quickPlotTemplates).toEqual([]); // pruned, as designed…
    expect(ws.recipeSourcesComplete).toBe(true); // …with nothing to warn about
  });

  it("still reports a real loss alongside a legitimate prune", () => {
    // The prune must not MASK a fidelity failure either: one good-but-dangling
    // template plus one malformed record is still an incomplete read.
    const ws = parseWorkspace(docWith({
      workbooks: [],
      quickPlotTemplates: [
        template({ scope: { kind: "workbook", workbookId: "wb-gone" } }),
        { id: "broken" },
      ],
    }));
    expect(ws.recipeSourcesComplete).toBe(false);
  });

  it("is never written to a saved project", () => {
    // A persisted transient flag would round-trip a stale verdict into a file.
    const doc = JSON.parse(serializeWorkspace({ ...useApp.getState(), recipeSourcesComplete: false }));
    expect("recipeSourcesComplete" in doc).toBe(false);
  });
});

describe("store — recipeSourcesComplete travels with the project", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [], plotRecipes: [], quickPlotTemplates: [], recipeSourcesComplete: true });
  });

  it("defaults to true in a fresh session — an empty app has lost nothing", () => {
    expect(useApp.getState().recipeSourcesComplete).toBe(true);
  });

  it("Open/Replace carries a lossy load into the store", () => {
    useApp.getState().loadWorkspace(parseWorkspace(docWith({ plotRecipes: [{ nope: true }] })));
    expect(useApp.getState().recipeSourcesComplete).toBe(false);
  });

  it("Open/Replace CLEARS a stale false when the next project is clean", () => {
    // The cross-project-leak class: a `set()` merges a partial state, so a
    // field the load forgets keeps the PREVIOUS project's verdict.
    useApp.setState({ recipeSourcesComplete: false });
    useApp.getState().loadWorkspace(parseWorkspace(docWith({ plotRecipes: [] })));
    expect(useApp.getState().recipeSourcesComplete).toBe(true);
  });

  it("Append Project leaves the flag alone — it brings no recipes in", () => {
    // `mergeWorkspace` returns only datasets/renamed/workbooks, so appending
    // cannot add or lose a recipe and must not restate a verdict it never
    // assessed. (My own round-5 review called this blocking on the assumption
    // append merged recipes; it does not. The test pins the real contract.)
    useApp.setState({ datasets: [dataset("d1")], recipeSourcesComplete: true });
    const incoming = parseWorkspace(docWith({ plotRecipes: [{ nope: true }] }));
    expect(incoming.recipeSourcesComplete).toBe(false);

    let n = 0;
    const merged = mergeWorkspace(
      useApp.getState().datasets, incoming,
      () => `gen-${++n}`, new Set<string>(), () => `wb-${++n}`,
    );
    expect("plotRecipes" in merged).toBe(false);
    expect("recipeSourcesComplete" in merged).toBe(false);

    useApp.getState().appendWorkspace(incoming);
    expect(useApp.getState().recipeSourcesComplete).toBe(true);
    expect(useApp.getState().plotRecipes).toEqual([]);
  });
});
