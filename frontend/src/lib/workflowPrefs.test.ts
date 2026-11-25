// Workflow prefs (PREFS_AUDIT lane 4): defaults equal the hardcoded values they
// replaced, every numeric pref clamps on load, and each consumer reads the
// slot at call time (undo depth, recents caps, autosave generations/retention).

import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../store/useApp";
import { HISTORY_DEPTH } from "../store/history";
import { useRecentProjects } from "../store/recentProjects";
import { evictPaths, MAX_UNPINNED, type WorkingPath } from "../store/workingPaths";
import { autosaveHealth, listAutosaveGenerations, saveAutosave, setAutosaveBackend } from "./autosave";
import { memoryBackend } from "./autosaveBackend";
import { MAX_GENERATION_AGE_MS, MAX_GENERATIONS } from "./autosaveGenerationRules";
import { WORKFLOW_DEFAULTS, WORKFLOW_RANGES, clampWorkflow, workflowPrefsSlot, type WorkflowNumKey } from "./workflowPrefs";
import { resetGeneralPrefs, setWorkflowPrefs } from "./workflowPrefsEdit";

const KEY = "qz.workflowPrefs";
const store = (v: unknown) => localStorage.setItem(KEY, JSON.stringify(v));

beforeEach(() => {
  localStorage.clear();
  useApp.setState({ history: [], future: [], recent: [] });
  useRecentProjects.setState({ recentProjects: [] });
});

describe("defaults are today's hardcoded values", () => {
  it("matches the constants each pref replaced", () => {
    const d = workflowPrefsSlot.load();
    expect(d.undoDepth).toBe(HISTORY_DEPTH);
    expect(d.autosaveGenerations).toBe(MAX_GENERATIONS);
    expect(d.autosaveRetentionDays * 86_400_000).toBe(MAX_GENERATION_AGE_MS);
    expect(d.recentFoldersMax).toBe(MAX_UNPINNED);
    expect(d.autosaveDebounceSec).toBe(0.8);
    expect([d.recentFilesMax, d.recentProjectsMax]).toEqual([12, 12]);
    expect(d.rememberImportSettings).toBe(false);
    expect(d.showFirstRunHints).toBe(true);
  });

  it("only the two confirmations are new behaviour, both ON (owner decision 2026-11-25)", () => {
    const d = workflowPrefsSlot.load();
    expect(d.confirmUnsavedClose).toBe(true);
    expect(d.confirmReplaceWorkspace).toBe(true);
  });
});

describe("clamping on load", () => {
  const keys = Object.keys(WORKFLOW_RANGES) as WorkflowNumKey[];

  it.each(keys)("%s: below the range -> min, above -> max, inside kept", (k) => {
    const [lo, hi] = WORKFLOW_RANGES[k];
    store({ [k]: lo - 1000 });
    expect(workflowPrefsSlot.load()[k]).toBe(lo);
    store({ [k]: hi + 1000 });
    expect(workflowPrefsSlot.load()[k]).toBe(hi);
    const mid = WORKFLOW_DEFAULTS[k];
    store({ [k]: mid });
    expect(workflowPrefsSlot.load()[k]).toBe(mid);
  });

  it("uses the stated provisional ranges", () => {
    expect(WORKFLOW_RANGES.undoDepth.slice(0, 2)).toEqual([10, 200]);
    expect(WORKFLOW_RANGES.autosaveGenerations.slice(0, 2)).toEqual([1, 10]);
    expect(WORKFLOW_RANGES.autosaveDebounceSec.slice(0, 2)).toEqual([0.4, 10]);
  });

  it("a non-number or non-finite value is the default; integers are rounded", () => {
    store({ undoDepth: "lots", autosaveGenerations: null, recentFilesMax: 7.6, autosaveDebounceSec: 0.123 });
    const p = workflowPrefsSlot.load();
    expect(p.undoDepth).toBe(50);
    expect(p.autosaveGenerations).toBe(3);
    expect(p.recentFilesMax).toBe(8);
    expect(p.autosaveDebounceSec).toBe(0.4);
    expect(clampWorkflow("undoDepth", Number.NaN)).toBe(50);
    expect(clampWorkflow("undoDepth", Infinity)).toBe(50);
  });

  it("wrong-typed booleans and a malformed import memory fall back", () => {
    store({ confirmUnsavedClose: "no", showFirstRunHints: 0, importMemory: { delimiter: 3, header_line: 1, units_line: null } });
    const p = workflowPrefsSlot.load();
    expect(p.confirmUnsavedClose).toBe(true);
    expect(p.showFirstRunHints).toBe(true);
    expect(p.importMemory).toBeNull();
  });
});

describe("each pref takes effect where it was hardcoded", () => {
  it("undo depth caps the history stack (and the default is 50)", () => {
    for (let i = 0; i < 60; i++) useApp.getState().recordHistory(`a${i}`);
    expect(useApp.getState().history).toHaveLength(50);
    useApp.setState({ history: [], future: [] });
    setWorkflowPrefs({ undoDepth: 10 });
    for (let i = 0; i < 25; i++) useApp.getState().recordHistory(`b${i}`);
    expect(useApp.getState().history).toHaveLength(10);
    expect(useApp.getState().history.at(-1)?.label).toBe("b24");
  });

  it("recent files cap", () => {
    setWorkflowPrefs({ recentFilesMax: 3 });
    for (let i = 0; i < 6; i++) useApp.getState().pushRecent(`f${i}.csv`, 1);
    expect(useApp.getState().recent.map((r) => r.name)).toEqual(["f5.csv", "f4.csv", "f3.csv"]);
  });

  it("recent projects cap", () => {
    setWorkflowPrefs({ recentProjectsMax: 2 });
    for (let i = 0; i < 5; i++) useRecentProjects.getState().pushRecentProject(`p${i}`, `/p${i}.dwk`);
    expect(useRecentProjects.getState().recentProjects.map((r) => r.name)).toEqual(["p4", "p3"]);
  });

  it("recent folders cap keeps pinned entries", () => {
    const wp = (path: string, usedAt: number, pinned = false): WorkingPath => ({ path, label: path, pinned, usedAt });
    const many = [wp("/pin", 0, true), ...Array.from({ length: 10 }, (_, i) => wp(`/p${i}`, i + 1))];
    expect(evictPaths(many).filter((p) => !p.pinned)).toHaveLength(8);
    setWorkflowPrefs({ recentFoldersMax: 2 });
    const kept = evictPaths(many);
    expect(kept.filter((p) => !p.pinned)).toHaveLength(2);
    expect(kept.some((p) => p.pinned)).toBe(true);
  });

  const ds = (id: string) => ({ id, name: id, data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } });

  it("autosave generations", async () => {
    setAutosaveBackend(memoryBackend());
    setWorkflowPrefs({ autosaveGenerations: 5 });
    for (let at = 1; at <= 8; at++) await saveAutosave({ datasets: [ds(`d${at}`)] }, at);
    expect((await listAutosaveGenerations()).map((g) => g.at)).toEqual([8, 7, 6, 5, 4]);
    expect(autosaveHealth().count).toBe(5);
    setWorkflowPrefs({ autosaveGenerations: 1 });
    await saveAutosave({ datasets: [ds("d9")] }, 9);
    expect((await listAutosaveGenerations()).map((g) => g.at)).toEqual([9]);
  });

  it("autosave retention drops old copies but always keeps the newest", async () => {
    const DAY = 86_400_000;
    setAutosaveBackend(memoryBackend());
    setWorkflowPrefs({ autosaveRetentionDays: 2, autosaveGenerations: 10 });
    await saveAutosave({ datasets: [ds("old")] }, 1 * DAY);
    await saveAutosave({ datasets: [ds("mid")] }, 9 * DAY);
    await saveAutosave({ datasets: [ds("new")] }, 10 * DAY);
    expect((await listAutosaveGenerations()).map((g) => g.at)).toEqual([10 * DAY, 9 * DAY]);
  });
});

describe("reset", () => {
  it("resetGeneralPrefs restores General fields and leaves the import memory", () => {
    setWorkflowPrefs({
      undoDepth: 99,
      confirmUnsavedClose: false,
      rememberImportSettings: true,
      importMemory: { delimiter: "tab", header_line: 1, units_line: null },
    });
    resetGeneralPrefs();
    const p = workflowPrefsSlot.load();
    expect(p.undoDepth).toBe(50);
    expect(p.confirmUnsavedClose).toBe(true);
    expect(p.rememberImportSettings).toBe(true);
    expect(p.importMemory?.delimiter).toBe("tab");
  });
});
