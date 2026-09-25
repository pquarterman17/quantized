// COLD-path coverage for bundle headroom slice 9 (`plans/BUNDLE_HEADROOM.md`),
// which funded the React 19.3 bump by deferring five modules whose every
// entry point was already async:
//   * the `.dwk` codec (`lib/workspace.ts`, via `lib/workspaceCodecLazy.ts`)
//     — used by autosave, Save/Save As, Open (native) and Open Recent;
//   * Save / Save As (`store/workspaceIO.ts`, via `store/workspaceIOLazy.ts`);
//   * single-dataset re-import (`store/reimport.ts`, via `store/reimportLazy.ts`);
//   * the Origin graph-recovery fallbacks (`store/originFallback.ts`, via
//     `store/originFallbackLazy.ts`).
// (`lib/workspaceParseCore.ts`'s no-Worker fallback is covered by the
// open-workspace command specs, which run on that path in jsdom.)
//
// `src/architecture.test.ts` holds the STATIC half of the guard (SEAMS /
// DRAGGED_OUT). This spec holds the BEHAVIOURAL half, per seam:
//   * the deferred module really runs, with the caller's arguments;
//   * a chunk that will not load is REPORTED on the channel the gesture
//     already used for its own failures — never a silent success, and for
//     the startup restore never "nothing to restore" — and nothing mutates;
//   * the failure is not cached: the next gesture refetches.
//
// `vi.doMock` (not the hoisted `vi.mock`) is what makes the failure path
// reachable: each loader resolves its module at CALL time.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { autosaveHealth, loadAutosaveGeneration, saveAutosave, setAutosaveBackend } from "../lib/autosave";
import { memoryBackend } from "../lib/autosaveBackend";
import type { WorkspaceState } from "../lib/workspace";
import { resetWorkspaceCodecForTests, workspaceCodec, workspaceCodecOrReport } from "../lib/workspaceCodecLazy";
import type { Dataset } from "../lib/types";
import { useWorkspaceAutosave } from "../useWorkspaceAutosave";
import { resetOriginFallbackCoreForTests } from "./originFallbackLazy";
import { resetReimportCoreForTests } from "./reimportLazy";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";
import { resetWorkspaceIOCoreForTests } from "./workspaceIOLazy";

const ds: Dataset = {
  id: "a",
  name: "a.dat",
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
};

const failLoad = () => {
  throw new Error("network error");
};

function dangerToasts(): string[] {
  return useToasts
    .getState()
    .toasts.filter((t) => t.kind === "danger")
    .map((t) => t.msg);
}

/** A persistable state with one dataset, the shape autosave is handed. */
function stateWithOneDataset(): WorkspaceState {
  return { ...useApp.getState(), datasets: [ds] };
}

function resetAllLoaders(): void {
  resetWorkspaceCodecForTests();
  resetWorkspaceIOCoreForTests();
  resetReimportCoreForTests();
  resetOriginFallbackCoreForTests();
}

beforeEach(() => {
  resetAllLoaders();
  setAutosaveBackend(memoryBackend());
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [ds], status: "", currentProject: null, originWorksheetSeed: null });
});

afterEach(() => {
  for (const m of ["../lib/workspace", "./workspaceIO", "./reimport", "./originFallback"]) vi.doUnmock(m);
  vi.resetModules();
  resetAllLoaders();
});

describe("the .dwk codec seam (lib/workspaceCodecLazy.ts)", () => {
  it("loads the real parse/serialize module on first use", async () => {
    const codec = await workspaceCodec();
    const text = codec.serializeWorkspace(stateWithOneDataset());
    expect(codec.parseWorkspace(text).datasets.map((d) => d.id)).toEqual(["a"]);
  });

  it("does not cache a failed load — the next call refetches", async () => {
    vi.doMock("../lib/workspace", failLoad);
    await expect(workspaceCodec()).rejects.toThrow();

    vi.doUnmock("../lib/workspace");
    vi.resetModules();
    await expect(workspaceCodec()).resolves.toHaveProperty("serializeWorkspace");
  });

  it("workspaceCodecOrReport reports a load failure on the status line and as a danger toast", async () => {
    vi.doMock("../lib/workspace", failLoad);
    const setStatus = vi.fn();
    expect(await workspaceCodecOrReport("save", setStatus)).toBeNull();
    expect(setStatus).toHaveBeenCalledWith(expect.stringMatching(/^save failed — couldn't load the workspace file codec: /));
    expect(dangerToasts()).toEqual([expect.stringMatching(/^save failed — couldn't load the workspace file codec: /)]);
  });
});

describe("autosave through the codec seam", () => {
  it("the startup restore REJECTS when the codec will not load — never reads as 'nothing to restore'", async () => {
    expect(await saveAutosave(stateWithOneDataset())).toBe(true);

    resetWorkspaceCodecForTests();
    vi.doMock("../lib/workspace", failLoad);
    await expect(loadAutosaveGeneration()).rejects.toThrow();

    // The autosave itself is untouched, and the next attempt restores it.
    vi.doUnmock("../lib/workspace");
    vi.resetModules();
    const picked = await loadAutosaveGeneration();
    expect(picked?.workspace.datasets.map((d) => d.id)).toEqual(["a"]);
  });

  it("a save whose codec will not load reports autosave health and writes nothing", async () => {
    vi.doMock("../lib/workspace", failLoad);
    expect(await saveAutosave(stateWithOneDataset())).toBe(false);
    expect(autosaveHealth().error).toBeTruthy();

    vi.doUnmock("../lib/workspace");
    vi.resetModules();
    expect(await loadAutosaveGeneration()).toBeNull(); // nothing was written
  });

  it("the autosave hook toasts a restore whose codec will not load, and loads nothing", async () => {
    expect(await saveAutosave(stateWithOneDataset())).toBe(true);
    useApp.setState({ datasets: [] });
    resetWorkspaceCodecForTests();
    vi.doMock("../lib/workspace", failLoad);

    renderHook(() => useWorkspaceAutosave());
    await act(async () => {
      await vi.dynamicImportSettled();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    expect(dangerToasts()).toEqual([expect.stringMatching(/^Couldn't restore the autosaved library \(.*\) — reload to try again$/)]);
    expect(useApp.getState().datasets).toEqual([]);
  });
});

describe("the Save / Save As seam (store/workspaceIOLazy.ts)", () => {
  it("runs the real save module once loaded", async () => {
    useApp.setState({ datasets: [] });
    await useApp.getState().saveWorkspaceToFile();
    expect(useApp.getState().status).toBe("no datasets to save");
    useApp.setState({ status: "" });
    await useApp.getState().saveWorkspace(); // no current project: delegates to Save As
    expect(useApp.getState().status).toBe("no datasets to save");
  });

  it("settles a save whose module will not load with the save-failure status and toast, then retries", async () => {
    vi.doMock("./workspaceIO", failLoad);
    await expect(useApp.getState().saveWorkspaceToFile()).resolves.toBeUndefined();
    expect(useApp.getState().status).toMatch(/^save failed — couldn't load the save module: /);
    expect(dangerToasts()).toEqual([expect.stringMatching(/^save failed — couldn't load the save module: /)]);
    expect(useApp.getState().datasets).toEqual([ds]);

    vi.doUnmock("./workspaceIO");
    vi.resetModules();
    useApp.setState({ datasets: [] });
    await useApp.getState().saveWorkspace();
    expect(useApp.getState().status).toBe("no datasets to save");
  });
});

describe("the re-import seam (store/reimportLazy.ts)", () => {
  it("delegates to the real slice with the dataset id", async () => {
    const reimportDataset = vi.fn(async () => undefined);
    vi.doMock("./reimport", () => ({ createReimportSlice: () => ({ reimportDataset }) }));
    await useApp.getState().reimportDataset("a");
    expect(reimportDataset).toHaveBeenCalledWith("a");
  });

  it("settles a re-import whose module will not load, says the dataset is unchanged, then retries", async () => {
    vi.doMock("./reimport", failLoad);
    await expect(useApp.getState().reimportDataset("a")).resolves.toBeUndefined();
    expect(useApp.getState().status).toMatch(/^re-import failed: couldn't load re-import: /);
    expect(dangerToasts()).toEqual([expect.stringMatching(/^re-import "a\.dat" failed: .* — the dataset is unchanged$/)]);
    expect(useApp.getState().datasets).toEqual([ds]);

    vi.doUnmock("./reimport");
    vi.resetModules();
    const reimportDataset = vi.fn(async () => undefined);
    vi.doMock("./reimport", () => ({ createReimportSlice: () => ({ reimportDataset }) }));
    await useApp.getState().reimportDataset("a");
    expect(reimportDataset).toHaveBeenCalledWith("a");
  });
});

describe("the Origin fallback seam (store/originFallbackLazy.ts)", () => {
  it("keeps the worksheet seed and its clearer eager and synchronous", () => {
    useApp.setState({ originWorksheetSeed: { datasetId: "a", columns: [0] } });
    useApp.getState().clearOriginWorksheetSeed();
    expect(useApp.getState().originWorksheetSeed).toBeNull();
  });

  it("delegates both actions to the real slice with their arguments", async () => {
    const openOriginFigureSource = vi.fn(async () => undefined);
    const remakeOriginFigure = vi.fn(async () => undefined);
    vi.doMock("./originFallback", () => ({
      createOriginFallbackSlice: () => ({ openOriginFigureSource, remakeOriginFigure }),
    }));
    await useApp.getState().openOriginFigureSource("fig", "a", { manual: true });
    await useApp.getState().remakeOriginFigure("fig");
    expect(openOriginFigureSource).toHaveBeenCalledWith("fig", "a", { manual: true });
    expect(remakeOriginFigure).toHaveBeenCalledWith("fig");
  });

  it("settles both actions with a danger toast when the module will not load", async () => {
    vi.doMock("./originFallback", failLoad);
    await expect(useApp.getState().openOriginFigureSource("fig")).resolves.toBeUndefined();
    await expect(useApp.getState().remakeOriginFigure("fig")).resolves.toBeUndefined();
    expect(dangerToasts()).toEqual([
      expect.stringMatching(/^Couldn't open Origin source workbook — /),
      expect.stringMatching(/^Couldn't seed Graph Builder — /),
    ]);
  });
});
