import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { autosaveHealth, setAutosaveBackend } from "./lib/autosave";
import { memoryBackend } from "./lib/autosaveBackend";
import { createBrowserLockProvider } from "./lib/browserLockProvider";
import { STALE_AFTER_MS } from "./lib/lockState";
import { serializeWorkspace } from "./lib/workspace";
import { useAutosaveStatus } from "./store/autosaveStatus";
import { useProjectLock } from "./store/projectLock";
import { useRecentProjects } from "./store/recentProjects";
import { useRecoveryChoice } from "./store/recoveryChoice";
import { useApp, type AppState } from "./store/useApp";
import { useToasts } from "./store/toasts";
import {
  BROWSER_AUTOSAVE_LOCK_PATH,
  engageBrowserAutosaveLock,
  flushAutosaveNow,
  installBrowserAutosaveReengage,
  resetAutosavePausedReporting,
  shouldAutosave,
  useWorkspaceAutosave,
  type AutosaveState,
} from "./useWorkspaceAutosave";

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
// `WorkspaceDoc` moved to lib/workspaceSerialize.ts with `serializeWorkspace`
// (2026-08-30, P3.5 extraction under workspace.ts's size pin). It is still the
// one declaration of the persisted document shape — only its file changed, and
// this scan throws rather than passing vacuously if it moves again.
const rawModules = import.meta.glob("./lib/workspaceSerialize.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Field names declared in lib/workspaceSerialize.ts's
 *  `interface WorkspaceDoc { ... }` — the actual persisted document shape. */
function workspaceDocFields(): string[] {
  const src = rawModules["./lib/workspaceSerialize.ts"];
  if (!src) throw new Error("could not read lib/workspaceSerialize.ts source (glob pattern moved?)");
  const block = /interface WorkspaceDoc \{([^}]*)\}/s.exec(src);
  if (!block) throw new Error("could not find `interface WorkspaceDoc` in lib/workspaceSerialize.ts");
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

// -- Browser autosave lock (coordinator review round, M1) ------------------
//
// M1's finding: the browser LockProvider (lib/browserLockProvider.ts) was
// dead code — nothing on a browser-tab path ever called one of its verbs.
// The autosave slot (this module's own restore/debounced-save loop) is the
// actual same-browser collision surface, scouted in this module's own
// header. "Two simulated tabs" below is the same technique
// lib/browserLockProvider.test.ts and store/projectLock.test.ts already
// use: a raw `createBrowserLockProvider` instance mutates the SHARED fake
// storage directly (bypassing `useProjectLock` entirely) to stand in for
// "the other tab", while `useProjectLock`'s own real provider/actions stand
// in for "this tab".
function fakeAutosaveStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe("browser autosave lock — engage/takeover (M1)", () => {
  let original: ReturnType<typeof useProjectLock.getState>;

  beforeEach(() => {
    original = useProjectLock.getState();
  });

  afterEach(() => {
    useProjectLock.setState(original);
  });

  it("engageBrowserAutosaveLock acquires the synthetic lock when the slot is free", async () => {
    const storage = fakeAutosaveStorage();
    useProjectLock.setState({
      provider: createBrowserLockProvider("tab-a", { storage, subscribeUnload: () => () => {} }),
    });

    await engageBrowserAutosaveLock();

    expect(useProjectLock.getState().status).toBe("held-by-me");
    expect(useProjectLock.getState().path).toBe(BROWSER_AUTOSAVE_LOCK_PATH);
    expect(useProjectLock.getState().canWriteNow()).toBe(true);
  });

  it("a second tab is read-only with the first tab's record, and Take Over Editing works once it's stale", async () => {
    const storage = fakeAutosaveStorage();
    // "Tab A" acquires directly, bypassing the store — a different tab's
    // own action, never routed through THIS session's useProjectLock.
    const otherTab = createBrowserLockProvider("tab-a", { storage, subscribeUnload: () => () => {} });
    const acquired = await otherTab.tryAcquire(BROWSER_AUTOSAVE_LOCK_PATH);
    expect(acquired.acquired).toBe(true);

    // "This tab" installs its own provider sharing the SAME storage and
    // engages — must observe tab A's record and land read-only, the same
    // read-only + Take Over Editing UX a real desktop project open gets.
    useProjectLock.setState({
      provider: createBrowserLockProvider("tab-b", { storage, subscribeUnload: () => () => {} }),
    });
    await engageBrowserAutosaveLock();

    expect(useProjectLock.getState().status).toBe("held-by-other-live");
    expect(useProjectLock.getState().record?.instanceId).toBe("tab-a");
    expect(useProjectLock.getState().canWriteNow()).toBe(false);

    // Force tab A stale (the deterministic stand-in for "real time passed"
    // every other lock-provider test in this codebase uses) and re-open to
    // pick up the fresh classification before Take Over Editing's own gate
    // (`canTakeOver`) will act on it — mirrors L0.47's re-verify discipline.
    const key = "qz-project-lock:v1:" + BROWSER_AUTOSAVE_LOCK_PATH;
    const parsed = JSON.parse(storage.getItem(key) as string);
    parsed.record.heartbeatAt = Date.now() - STALE_AFTER_MS - 1;
    storage.setItem(key, JSON.stringify(parsed));
    await useProjectLock.getState().openProject(BROWSER_AUTOSAVE_LOCK_PATH);
    expect(useProjectLock.getState().status).toBe("held-by-other-stale");

    const tookOver = await useProjectLock.getState().takeOverEditing();
    expect(tookOver).toBe(true);
    expect(useProjectLock.getState().status).toBe("held-by-me");
    expect(useProjectLock.getState().canWriteNow()).toBe(true);
  });
});

describe("browser autosave lock — the debounced write actually consults it (M1)", () => {
  let original: ReturnType<typeof useProjectLock.getState>;

  beforeEach(() => {
    original = useProjectLock.getState();
    setAutosaveBackend(memoryBackend());
    useApp.setState({ datasets: [], plotWindows: [], focusedWindowId: null, projectDirty: false });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useProjectLock.setState(original);
    useApp.setState({ projectDirty: false });
  });

  async function editAndFlushDebounce(): Promise<void> {
    act(() => {
      useApp.setState({ datasets: [{ ...ds }] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
  }

  it("skips the write when the lock reports read-only for the browser autosave path", async () => {
    useProjectLock.setState({ path: BROWSER_AUTOSAVE_LOCK_PATH, status: "held-by-other-live", record: null });
    renderHook(() => useWorkspaceAutosave());

    await editAndFlushDebounce();

    expect(autosaveHealth().savedAt).toBeNull();
  });

  it("performs the write when held-by-me for the browser autosave path", async () => {
    useProjectLock.setState({ path: BROWSER_AUTOSAVE_LOCK_PATH, status: "held-by-me", record: null });
    renderHook(() => useWorkspaceAutosave());

    await editAndFlushDebounce();

    expect(autosaveHealth().savedAt).not.toBeNull();
  });

  it("writes normally when the lock isn't tracking the browser autosave path at all (desktop, or not yet engaged)", async () => {
    useProjectLock.setState({ path: null, status: "unlocked", record: null });
    renderHook(() => useWorkspaceAutosave());

    await editAndFlushDebounce();

    expect(autosaveHealth().savedAt).not.toBeNull();
  });

  // N3 belt (coordinator review round 3): `openAsCopy()` clears `lock.path`
  // to `null`, which would otherwise make the ordinary
  // `path === BROWSER_AUTOSAVE_LOCK_PATH` check above silently no-op —
  // there is no separate "copy destination" for the single shared autosave
  // slot, so a post-copy write must still be refused. This is the belt;
  // the primary fix is the command-level refusal
  // (commands/projectLockCommands.test.ts's N3 test).
  it("N3 belt: refuses when openedAsCopy is set, even though path is null", async () => {
    useProjectLock.setState({ path: null, status: "unlocked", openedAsCopy: true, record: null });
    renderHook(() => useWorkspaceAutosave());

    await editAndFlushDebounce();

    expect(autosaveHealth().savedAt).toBeNull();
  });
});

// -- N2: event-driven re-engage ---------------------------------------------

describe("browser autosave lock — event-driven re-engage (N2)", () => {
  let original: ReturnType<typeof useProjectLock.getState>;

  beforeEach(() => {
    original = useProjectLock.getState();
  });

  afterEach(() => {
    useProjectLock.setState(original);
  });

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it("N2: a visibilitychange-to-visible re-engage recovers once the holder releases", async () => {
    const storage = fakeAutosaveStorage();
    const otherTab = createBrowserLockProvider("tab-a", { storage, subscribeUnload: () => () => {} });
    const acquired = await otherTab.tryAcquire(BROWSER_AUTOSAVE_LOCK_PATH);

    useProjectLock.setState({
      provider: createBrowserLockProvider("tab-b", { storage, subscribeUnload: () => () => {} }),
    });
    const teardown = installBrowserAutosaveReengage();
    await engageBrowserAutosaveLock();
    expect(useProjectLock.getState().status).toBe("held-by-other-live");

    // The holder releases — tab B doesn't know yet (no message-passing).
    await otherTab.release(BROWSER_AUTOSAVE_LOCK_PATH, acquired.record?.token ?? "");

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();

    expect(useProjectLock.getState().status).toBe("held-by-me");
    teardown();
  });

  it("N2: a definite loss on the autosave path triggers an immediate re-engage attempt", async () => {
    const storage = fakeAutosaveStorage();
    const provider = createBrowserLockProvider("tab-b", { storage, subscribeUnload: () => () => {} });
    const readSpy = vi.spyOn(provider, "read");
    useProjectLock.setState({ provider });
    const teardown = installBrowserAutosaveReengage();
    await engageBrowserAutosaveLock();
    expect(useProjectLock.getState().status).toBe("held-by-me");
    const callsAfterEngage = readSpy.mock.calls.length;

    // Someone else takes over behind tab B's back — never through tab B's
    // own actions, exactly like a real second tab would.
    const otherTab = createBrowserLockProvider("tab-a", { storage, subscribeUnload: () => () => {} });
    const key = "qz-project-lock:v1:" + BROWSER_AUTOSAVE_LOCK_PATH;
    const parsed = JSON.parse(storage.getItem(key) as string);
    parsed.record.heartbeatAt = Date.now() - STALE_AFTER_MS - 1;
    storage.setItem(key, JSON.stringify(parsed));
    const bToken = useProjectLock.getState().record?.token ?? "";
    const tookOver = await otherTab.takeOver(BROWSER_AUTOSAVE_LOCK_PATH, bToken);
    expect(tookOver.acquired).toBe(true);

    // Tab B's own heartbeat now sees the CAS fail — a definite loss.
    await useProjectLock.getState().heartbeat();
    expect(useProjectLock.getState().status).toBe("held-by-other-live");

    await flush();

    // The re-engage attempt performed its OWN `openProject` -> `provider.read`
    // call, on top of the initial engage's — proves the watcher actually
    // fired, not just that heartbeat's own demotion ran.
    expect(readSpy.mock.calls.length).toBeGreaterThan(callsAfterEngage);
    teardown();
  });

  it("N2: never re-engages while openedAsCopy is set", async () => {
    useProjectLock.setState({
      path: BROWSER_AUTOSAVE_LOCK_PATH,
      status: "held-by-other-live",
      openedAsCopy: true,
      record: null,
    });
    const teardown = installBrowserAutosaveReengage();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    // No provider was ever installed for this state, so any attempted
    // `openProject` call would throw/reject — the absence of a thrown
    // rejection (unhandled) plus the status staying exactly as set is the
    // proof no re-engage was attempted.
    expect(useProjectLock.getState().status).toBe("held-by-other-live");
    teardown();
  });
});

// -- N4: immediate flush after recovering the lock --------------------------

describe("browser autosave lock — immediate post-recovery flush (N4)", () => {
  let original: ReturnType<typeof useProjectLock.getState>;

  beforeEach(() => {
    original = useProjectLock.getState();
    setAutosaveBackend(memoryBackend());
    useApp.setState({ datasets: [], plotWindows: [], focusedWindowId: null, projectDirty: false });
  });

  afterEach(() => {
    useProjectLock.setState(original);
    useApp.setState({ projectDirty: false });
  });

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it("N4: a successful takeover with dirty edits flushes immediately, without waiting for a later change", async () => {
    const storage = fakeAutosaveStorage();
    const otherTab = createBrowserLockProvider("tab-a", { storage, subscribeUnload: () => () => {} });
    await otherTab.tryAcquire(BROWSER_AUTOSAVE_LOCK_PATH);

    useProjectLock.setState({
      provider: createBrowserLockProvider("tab-b", { storage, subscribeUnload: () => () => {} }),
    });
    const teardown = installBrowserAutosaveReengage();
    await engageBrowserAutosaveLock();
    expect(useProjectLock.getState().status).toBe("held-by-other-live");

    // Edits pile up in memory while gated — dirty, but never actually saved.
    useApp.setState({ projectDirty: true, datasets: [{ ...ds }] });
    expect(autosaveHealth().savedAt).toBeNull();

    const key = "qz-project-lock:v1:" + BROWSER_AUTOSAVE_LOCK_PATH;
    const parsed = JSON.parse(storage.getItem(key) as string);
    parsed.record.heartbeatAt = Date.now() - STALE_AFTER_MS - 1;
    storage.setItem(key, JSON.stringify(parsed));
    await useProjectLock.getState().openProject(BROWSER_AUTOSAVE_LOCK_PATH); // pick up the stale classification
    const tookOver = await useProjectLock.getState().takeOverEditing();
    expect(tookOver).toBe(true);

    await flush(); // let the subscribe-triggered flushAutosaveNow() settle

    // Flushed as part of the takeover itself — no LATER, unrelated change
    // was needed to re-fire the debounce.
    expect(autosaveHealth().savedAt).not.toBeNull();
    teardown();
  });

  it("N4: does NOT flush on recovery when nothing was dirty", async () => {
    const storage = fakeAutosaveStorage();
    useProjectLock.setState({
      provider: createBrowserLockProvider("tab-b", { storage, subscribeUnload: () => () => {} }),
    });
    const teardown = installBrowserAutosaveReengage();
    await engageBrowserAutosaveLock(); // unlocked -> held-by-me, but nothing dirty
    await flush();
    expect(autosaveHealth().savedAt).toBeNull();
    teardown();
  });
});

// -- N6: paused/resumed reporting is once-per-transition ---------------------

describe("browser autosave lock — paused/resumed reporting (N6)", () => {
  let original: ReturnType<typeof useProjectLock.getState>;

  beforeEach(() => {
    original = useProjectLock.getState();
    setAutosaveBackend(memoryBackend());
    useApp.setState({ datasets: [], plotWindows: [], focusedWindowId: null, projectDirty: false });
    // Round 4: the paused-report latch is module-level — reset it here so
    // these tests never depend on which OTHER test's flush happened to
    // reset it (docs/testing.md's determinism discipline).
    resetAutosavePausedReporting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useProjectLock.setState(original);
    useApp.setState({ projectDirty: false });
  });

  it("N6: reports the paused notice exactly once across repeated refused ticks, then reports resumed once", async () => {
    useProjectLock.setState({ path: BROWSER_AUTOSAVE_LOCK_PATH, status: "held-by-other-live", record: null });
    const setHealthSpy = vi.spyOn(useAutosaveStatus.getState(), "setHealth");
    renderHook(() => useWorkspaceAutosave());

    // Two separate edits, each re-firing the debounce while STILL paused.
    act(() => {
      useApp.setState({ datasets: [{ ...ds }] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    act(() => {
      useApp.setState({ datasets: [{ ...ds, name: "b.dat" }] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    const pausedCalls = setHealthSpy.mock.calls.filter((c) => c[0].error?.includes("paused"));
    expect(pausedCalls).toHaveLength(1); // once per TRANSITION, never once per tick
    expect(autosaveHealth().savedAt).toBeNull();

    // Resume, then edit again — the real save's own health report is what
    // proves "resumed" (see flushAutosaveNow's own doc for why there is no
    // separate, redundant "resumed" message to keep in sync with it).
    useProjectLock.setState({ status: "held-by-me" });
    act(() => {
      useApp.setState({ datasets: [{ ...ds, name: "c.dat" }] });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    expect(autosaveHealth().error).toBeNull();
    expect(autosaveHealth().savedAt).not.toBeNull();
  });

  // Round 4: an opened-as-copy pause is NOT "another tab holds this
  // session" — no other tab need exist and the pause never self-resumes;
  // the report must say so honestly.
  it("round 4: the opened-as-copy pause reports its own cause-specific message", async () => {
    // spyOn on an already-spied method returns the SAME spy with earlier
    // tests' history — clear so counts are this test's own.
    const setHealthSpy = vi.spyOn(useAutosaveStatus.getState(), "setHealth").mockClear();
    useProjectLock.setState({ path: null, status: "unlocked", record: null, openedAsCopy: true });
    await flushAutosaveNow();
    const reported = setHealthSpy.mock.calls.map((c) => c[0].error).filter(Boolean);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("opened as a copy");
    expect(reported[0]).not.toContain("another tab");
  });
});

// -- Round 4: re-engage triggers are quiet + copy-guarded --------------------

describe("browser autosave lock — round-4 trigger guards", () => {
  let original: ReturnType<typeof useProjectLock.getState>;
  let teardown: (() => void) | null = null;

  beforeEach(() => {
    original = useProjectLock.getState();
    resetAutosavePausedReporting();
  });

  afterEach(() => {
    // Teardown in afterEach, never inline at the test tail — a failing
    // expect would otherwise skip it and leak this test's watcher into
    // every later test in the module (order-coupling).
    teardown?.();
    teardown = null;
    useProjectLock.setState(original);
  });

  it("a visibilitychange re-engage back onto the same read-only state shows NO toast", async () => {
    const storage = fakeAutosaveStorage();
    // Another tab genuinely holds the slot.
    const holder = createBrowserLockProvider("tab-a", { storage, subscribeUnload: () => () => {} });
    await holder.tryAcquire(BROWSER_AUTOSAVE_LOCK_PATH);
    const provider = createBrowserLockProvider("tab-b", { storage, subscribeUnload: () => () => {} });
    useProjectLock.setState({ provider });
    teardown = installBrowserAutosaveReengage();
    await engageBrowserAutosaveLock(); // initial engage MAY toast — that one is fine
    const toastsBefore = useToasts.getState().toasts.length;

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    await Promise.resolve();

    expect(useProjectLock.getState().status).toBe("held-by-other-live"); // re-engage really ran its course
    expect(useToasts.getState().toasts.length).toBe(toastsBefore); // and said nothing new
  });

  it("pageshow while openedAsCopy never re-engages (openProject would clear the flag)", async () => {
    useProjectLock.setState({
      path: BROWSER_AUTOSAVE_LOCK_PATH,
      status: "held-by-other-live",
      openedAsCopy: true,
      record: null,
    });
    teardown = installBrowserAutosaveReengage();
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await Promise.resolve();
    await Promise.resolve();
    // openProject clears openedAsCopy on BOTH its branches — the flag
    // surviving proves no engage ran.
    expect(useProjectLock.getState().openedAsCopy).toBe(true);
  });

  it("an unverifiable-streak demotion does NOT trigger the loss re-engage (R4's poller owns recovery)", async () => {
    const openProjectSpy = vi
      .fn()
      .mockResolvedValue({ readOnly: true, status: "held-by-other-live" });
    useProjectLock.setState({
      path: BROWSER_AUTOSAVE_LOCK_PATH,
      status: "held-by-me",
      openedAsCopy: false,
      unverifiableHeartbeats: 0,
      openProject: openProjectSpy,
    });
    teardown = installBrowserAutosaveReengage();
    // The R4 demotion shape: status drops but the streak is NON-zero (the
    // kept record still names this instance) — must NOT re-engage.
    useProjectLock.setState({ status: "held-by-other-live", unverifiableHeartbeats: 3 });
    await Promise.resolve();
    expect(openProjectSpy).not.toHaveBeenCalled();
    // A DEFINITE loss (streak zero) from held-by-me DOES re-engage.
    useProjectLock.setState({ status: "held-by-me", unverifiableHeartbeats: 0 });
    useProjectLock.setState({ status: "held-by-other-live", unverifiableHeartbeats: 0 });
    await Promise.resolve();
    expect(openProjectSpy).toHaveBeenCalledTimes(1);
  });

  // Round 4: the latch resets on the REGAIN EDGE (the watcher), not merely
  // inside an unblocked flush — a takeover with nothing dirty runs no
  // flush, and the SECOND pause after it must still report. openProject is
  // an inert spy so the loss-edge re-engage can't mutate lock state
  // underneath the sequence being tested.
  it("round 4: a second pause after a no-flush takeover still reports", async () => {
    setAutosaveBackend(memoryBackend());
    const openProjectSpy = vi
      .fn()
      .mockResolvedValue({ readOnly: true, status: "held-by-other-live" });
    useProjectLock.setState({
      path: BROWSER_AUTOSAVE_LOCK_PATH,
      status: "held-by-other-live",
      record: null,
      openedAsCopy: false,
      unverifiableHeartbeats: 0,
      openProject: openProjectSpy,
    });
    teardown = installBrowserAutosaveReengage();
    const setHealthSpy = vi.spyOn(useAutosaveStatus.getState(), "setHealth").mockClear();

    await flushAutosaveNow(); // pause 1: reports
    useProjectLock.setState({ status: "held-by-me" }); // regain edge: latch resets, nothing dirty → no flush
    useProjectLock.setState({ status: "held-by-other-live" }); // pause 2
    await flushAutosaveNow(); // must report AGAIN

    const pausedCalls = setHealthSpy.mock.calls.filter((c) => c[0].error?.includes("paused"));
    expect(pausedCalls).toHaveLength(2); // one per TRANSITION, including the second
  });
});
