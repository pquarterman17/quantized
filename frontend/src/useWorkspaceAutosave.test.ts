import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setAutosaveBackend } from "./lib/autosave";
import { memoryBackend } from "./lib/autosaveBackend";
import { serializeWorkspace } from "./lib/workspace";
import { useRecentProjects } from "./store/recentProjects";
import { useRecoveryChoice } from "./store/recoveryChoice";
import { useApp, type AppState } from "./store/useApp";
import { shouldAutosave, useWorkspaceAutosave, type AutosaveState } from "./useWorkspaceAutosave";

const ds = {
  id: "a",
  name: "a.dat",
  data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
};

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const base: AutosaveState = {
  datasets: [],
  folders: [],
  activeId: null,
  selectedIds: [],
  expandedFolders: [],
  originFigures: [],
  originFidelity: [],
  smartFolders: [],
  reports: [],
  macroSteps: [],
  recalcMode: "auto",
  figureDocs: [],
  editableFigures: [],
  pages: [],
  plotWindows: [],
  focusedWindowId: null,
  toolWindowLayout: {},
  savedPlotSpecs: [],
  quickPlotTemplates: [],
  librarySelection: null,
  workbookLastChild: {},
  expandedWorkbookIds: [],
  workbooks: [],
  savedRois: [],
  collections: [],
  visibleDetailsColumns: [],
  plotRecipes: [],
};

describe("shouldAutosave", () => {
  it("does not save when every persisted workspace field is referentially unchanged", () => {
    expect(shouldAutosave(base, base)).toBe(false);
  });

  // `editableFigures` is here as the F1.4-review regression pin: the field
  // was omitted from the trigger list when the collection first shipped, so
  // deleting/duplicating a saved figure never scheduled an autosave.
  //
  // `librarySelection`/`workbookLastChild`/`expandedWorkbookIds`
  // (LIBRARY_WORKBOOK_UX_PLAN PR E2) are here for the same reason: each is a
  // FIELD in `AutosaveState`, so a change to only ONE of them (not the whole
  // library) must still schedule the debounce.
  //
  // `workbooks`/`savedRois` are the post-merge-review regression pin: both
  // were already persisted fields with no trigger here — a rename/move that
  // touches ONLY `workbooks`, or a named-ROI save/delete that touches ONLY
  // `savedRois`, could sit unsaved until some unrelated field also changed.
  // P2-1 (adversarial review probe): `collections` (LIBRARY_WORKBOOK_UX_PLAN
  // PR L saved-search Collections) and `quickPlotTemplates` (PR H) are BOTH
  // persisted fields (lib/workspace.ts's WorkspaceDoc) with no trigger here —
  // the exact bug class the comment above already names for
  // workbooks/savedRois, missed on these two. `toolWindowLayout` and
  // `originFidelity` are the same bug class, found by the completeness sweep
  // below while fixing this: both persist and both mutate independently of
  // every other tracked field (store/toolwindows.ts's setters;
  // store/originImport.ts's `addOriginFidelity`), so either could silently
  // change without ever scheduling an autosave or flipping the dirty marker.
  it.each(
    [
      "originFigures",
      "originFidelity",
      "reports",
      "macroSteps",
      "figureDocs",
      "editableFigures",
      "pages",
      "toolWindowLayout",
      "savedPlotSpecs",
      "quickPlotTemplates",
      "librarySelection",
      "workbookLastChild",
      "expandedWorkbookIds",
      "workbooks",
      "savedRois",
      "collections",
      "plotRecipes",
    ] as const,
  )("saves when %s changes", (field) => {
    expect(shouldAutosave({ ...base, [field]: [] }, base)).toBe(true);
  });

  it("saves when recalculation mode changes", () => {
    expect(shouldAutosave({ ...base, recalcMode: "manual" }, base)).toBe(true);
  });
});

// P1.2 box 1: the dirty marker must flip the moment a persisted field
// changes — reusing the SAME shouldAutosave comparison the debounced save
// itself uses (see useWorkspaceAutosave.ts's subscribe callback), so the
// two can never disagree about what counts as "changed".
describe("dirty tracking (P1.2 box 1)", () => {
  beforeEach(() => {
    setAutosaveBackend(memoryBackend());
    useApp.setState({ datasets: [], plotWindows: [], focusedWindowId: null, projectDirty: false });
  });

  afterEach(() => {
    useApp.setState({ projectDirty: false });
  });

  it("marks the project dirty as soon as a persisted field changes, before the debounce fires", () => {
    renderHook(() => useWorkspaceAutosave());
    expect(useApp.getState().projectDirty).toBe(false);

    act(() => {
      useApp.setState({
        datasets: [
          {
            id: "a",
            name: "a.dat",
            data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
          },
        ],
      });
    });

    // Synchronous — markProjectDirty runs inside the subscribe callback
    // itself, not inside the 800ms debounced save.
    expect(useApp.getState().projectDirty).toBe(true);
  });

  it("does not mark dirty when an unrelated field changes", () => {
    renderHook(() => useWorkspaceAutosave());
    act(() => {
      useApp.setState({ status: "some unrelated status text" });
    });
    expect(useApp.getState().projectDirty).toBe(false);
  });

  // P2-1 (adversarial review probe): a Collection rename/save or a Quick
  // Plot template save is a real, persisted edit (both round-trip through
  // .dwk) with NO other tracked field changing alongside it — before the
  // Pick-list/equality-chain fix, both left `projectDirty` false, a
  // misleading-clean title bar right up until a crash lost the edit.
  it("marks the project dirty on a collections-only change", () => {
    renderHook(() => useWorkspaceAutosave());
    act(() => {
      useApp.setState({ collections: [{ id: "c1", name: "Recent XRD", query: "" }] });
    });
    expect(useApp.getState().projectDirty).toBe(true);
  });

  // PR L slice 2: visibleDetailsColumns persists (lib/workspace.ts) and
  // mutates independently via store/libraryDetailsColumns.ts's
  // toggleVisibleDetailsColumn — same completeness-sweep class as
  // collections/quickPlotTemplates right above.
  it("marks the project dirty on a visibleDetailsColumns-only change", () => {
    renderHook(() => useWorkspaceAutosave());
    act(() => {
      useApp.getState().toggleVisibleDetailsColumn("sample");
    });
    expect(useApp.getState().projectDirty).toBe(true);
  });

  it("marks the project dirty on a quickPlotTemplates-only change", () => {
    renderHook(() => useWorkspaceAutosave());
    act(() => {
      // Reference-only check (shouldAutosave never inspects shape) — a
      // minimal stand-in cast is enough, same as the `it.each` probes above.
      useApp.setState({ quickPlotTemplates: [{ id: "t1" }] as unknown as AppState["quickPlotTemplates"] });
    });
    expect(useApp.getState().projectDirty).toBe(true);
  });

  // Finding 2 (P1.3 wave 2 integration): a Plot Recipe CRUD gesture is a
  // real, persisted edit (round-trips through .dwk via lib/workspace.ts)
  // with no other tracked field changing alongside it — before the Pick-
  // list/equality-chain fix, deletePlotRecipe/renamePlotRecipe/
  // duplicatePlotRecipe/saveAsPlotRecipe left `projectDirty` false, same
  // misleading-clean-title-bar bug class as collections/quickPlotTemplates
  // above. Exercised through the REAL store action (not a raw setState) so
  // this also proves the action's own set() call is actually reference-
  // distinct, not just the field's presence in the Pick list.
  it("marks the project dirty on a Plot Recipe delete (real CRUD action, not a raw setState)", () => {
    renderHook(() => useWorkspaceAutosave());
    act(() => {
      useApp.setState({
        plotRecipes: [{ id: "r1" } as unknown as AppState["plotRecipes"][number]],
      });
    });
    // The seed above is fixture setup — `plotRecipes` starts as a genuine
    // Pick-list field, so it must NOT be the reason projectDirty ends up
    // true below; reset it before the real action under test runs.
    useApp.setState({ projectDirty: false });

    act(() => {
      useApp.getState().deletePlotRecipe("r1");
    });

    expect(useApp.getState().plotRecipes).toHaveLength(0);
    expect(useApp.getState().projectDirty).toBe(true);
  });
});

// P1.2 box 5: crash recovery must EXPLAIN itself (source/time/choices) and
// never silently auto-restore over a named project — only when there IS a
// named "last project" AND the autosave candidate is newer than it.
describe("startup recovery choice (P1.2 box 5)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [], currentProject: null, projectDirty: false });
    useRecentProjects.setState({ recentProjects: [] });
    useRecoveryChoice.setState({ pending: null });
  });

  afterEach(() => {
    useRecentProjects.setState({ recentProjects: [] });
    useRecoveryChoice.setState({ pending: null });
  });

  it("offers a choice instead of silently restoring when the autosave is newer than the last project", async () => {
    setAutosaveBackend(memoryBackend([{ at: 500, text: serializeWorkspace({ datasets: [ds] }) }]));
    useRecentProjects.setState({
      recentProjects: [{ name: "project.dwk", path: "/p/project.dwk", at: new Date(100).toISOString() }],
    });

    renderHook(() => useWorkspaceAutosave());
    await flush();

    // NOT auto-loaded — the live session stays empty until the user chooses.
    expect(useApp.getState().datasets).toEqual([]);
    const pending = useRecoveryChoice.getState().pending;
    expect(pending).not.toBeNull();
    expect(pending?.autosaveAt).toBe(500);
    expect(pending?.datasetCount).toBe(1);
    expect(pending?.lastProject).toEqual({ name: "project.dwk", path: "/p/project.dwk", at: 100 });
  });

  it("silently restores exactly as before when there is no last-known project", async () => {
    setAutosaveBackend(memoryBackend([{ at: 500, text: serializeWorkspace({ datasets: [ds] }) }]));
    // recentProjects stays empty (set in beforeEach).

    renderHook(() => useWorkspaceAutosave());
    await flush();

    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["a.dat"]);
    expect(useRecoveryChoice.getState().pending).toBeNull();
  });

  it("silently restores when the autosave is NOT newer than the last project", async () => {
    setAutosaveBackend(memoryBackend([{ at: 500, text: serializeWorkspace({ datasets: [ds] }) }]));
    useRecentProjects.setState({
      recentProjects: [{ name: "project.dwk", path: "/p/project.dwk", at: new Date(1000).toISOString() }],
    });

    renderHook(() => useWorkspaceAutosave());
    await flush();

    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["a.dat"]);
    expect(useRecoveryChoice.getState().pending).toBeNull();
  });
});

// -- AutosaveState completeness sweep (P2-1, allowlist-coverage-guard) -----
//
// The bug this guards against: a field lib/workspace.ts genuinely persists
// (round-trips through `.dwk`) but is missing from BOTH `AutosaveState`'s
// `Pick<AppState, ...>` list and `shouldAutosave`'s equality chain — so an
// edit to ONLY that field never schedules an autosave and never flips the
// dirty marker (misleading-clean UI, crash-only data loss). `workbooks`/
// `savedRois` were an earlier instance of exactly this; `collections`/
// `quickPlotTemplates`/`toolWindowLayout`/`originFidelity` were this round's.
//
// Reads BOTH sides from raw source (Vite's `import.meta.glob`, the same
// mechanism architecture.test.ts's HISTORY_EXCLUDED guard uses) rather than
// hand-maintaining a duplicate list here — a hand-copied list would just be
// a second place to forget the same field.
const rawModules = import.meta.glob("./lib/workspace.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Field names declared in lib/workspace.ts's `interface WorkspaceDoc { ... }`
 *  — the actual persisted document shape. */
function workspaceDocFields(): string[] {
  const src = rawModules["./lib/workspace.ts"];
  if (!src) throw new Error("could not read lib/workspace.ts source (glob pattern moved?)");
  const block = /interface WorkspaceDoc \{([^}]*)\}/s.exec(src);
  if (!block) throw new Error("could not find `interface WorkspaceDoc` in lib/workspace.ts");
  return [...block[1].matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
}

/** Field names `shouldAutosave` actually compares, read from ITS OWN
 *  `.toString()` — so a Pick-list entry with no matching equality-chain
 *  line (or vice versa) shows up as a real gap, not just an assumption. */
function shouldAutosaveComparedFields(): string[] {
  const body = shouldAutosave.toString();
  return [...new Set([...body.matchAll(/state\.(\w+) ===/g)].map((m) => m[1]))];
}

// `serializeWorkspace` writes these itself — document metadata, never app
// state, so they are neither tracked nor excluded; just not applicable.
const DOC_METADATA_FIELDS = new Set(["format", "version", "savedAt"]);

// WorkspaceDoc field name -> the differently-named AppState field it actually
// serializes (lib/workspace.ts: `pipeline: ws.macroSteps ?? []`).
const WORKSPACE_DOC_RENAMES: Record<string, string> = { pipeline: "macroSteps" };

// Fields deliberately NOT tracked by shouldAutosave, with why — same
// discipline as architecture.test.ts's HISTORY_EXCLUDED list.
const AUTOSAVE_EXCLUDED: Record<string, string> = {
  techniqueViewMemory:
    "every mutation site (store/windows.ts's focusedRebindPatch, and the " +
    "background-window rebind branch) changes it in the SAME set() call " +
    "as activeId or plotWindows, both already tracked — a standalone " +
    "change is structurally impossible today, so tracking it separately " +
    "would never change autosave behavior. Re-check this exclusion if a " +
    "future edit gives techniqueViewMemory an independent mutation site.",
};

describe("AutosaveState completeness sweep (P2-1)", () => {
  it("covers every field lib/workspace.ts's WorkspaceDoc persists, or documents why not", () => {
    const persisted = workspaceDocFields()
      .filter((f) => !DOC_METADATA_FIELDS.has(f))
      .map((f) => WORKSPACE_DOC_RENAMES[f] ?? f);
    const tracked = new Set(shouldAutosaveComparedFields());
    const uncovered = persisted.filter((f) => !tracked.has(f) && !(f in AUTOSAVE_EXCLUDED));
    expect(
      uncovered,
      "add each field to shouldAutosave's Pick<AppState,...> list AND its equality chain, " +
        "or document it in AUTOSAVE_EXCLUDED with why a standalone change can't happen",
    ).toEqual([]);
  });

  it("AUTOSAVE_EXCLUDED stays honest — a field that stopped persisting must lose its entry", () => {
    const persisted = new Set(workspaceDocFields().map((f) => WORKSPACE_DOC_RENAMES[f] ?? f));
    const stale = Object.keys(AUTOSAVE_EXCLUDED).filter((f) => !persisted.has(f));
    expect(stale, "these no longer persist in WorkspaceDoc — remove their AUTOSAVE_EXCLUDED entry").toEqual([]);
  });

  it("finds a non-trivial number of persisted fields (the scan still works)", () => {
    expect(workspaceDocFields().length).toBeGreaterThan(15);
  });
});
