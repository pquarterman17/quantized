// Item 40 slice P6: presets in the Recipe Library, through the real Library
// panel, the real Resample panel and the real stores. Presets list with their
// tool and schema; "Open in tool" loads the tool's DRAFT and never runs it; a
// locked, unknown or vanished preset opens nothing.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ResampleRequest, ResampleResult } from "../../../lib/api/resample";
import { PRESETS_KEY } from "../../../lib/presets";
import { metaFor, pruneEntries, setFavorite } from "../../../lib/recipeIndex";
import { collectRecipes, liveKeys } from "../../../lib/recipeSources";
import { recipeDetails } from "../../../lib/recipeDetails";
import { RECIPE_CAPABILITIES, RECIPE_KINDS, supportsOperation, type RecipeRef } from "../../../lib/recipeLibrary";
import { readLastUsed, lastUsedSlot } from "../../../lib/presetLastUsed";
import type { DataStruct } from "../../../lib/types";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { usePendingPreset } from "../../../store/pendingPreset";
import { useRecipeManager } from "../../../store/recipeManager";
import { useResampleDialog } from "../../../store/resampleDialog";
import { useApp } from "../../../store/useApp";
import ConfirmDialog from "../../overlays/ConfirmDialog";
import ResamplePanel from "../resample/ResamplePanel";
import { applyOrOpen, deleteRecipe, renameRecipe } from "./recipeActions";
import RecipeLibraryPanel from "./RecipeLibraryPanel";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));
vi.mock("../../../lib/api/resample", () => ({ resampleDataset: vi.fn() }));
const { resampleDataset } = await import("../../../lib/api/resample");

function fakeBackend(body: ResampleRequest): Promise<ResampleResult> {
  const { time } = body.dataset;
  const n = body.n_points ?? 2;
  const lo = Math.min(...time);
  const hi = Math.max(...time);
  const grid = Array.from({ length: n }, (_, k) => lo + ((hi - lo) * k) / (n - 1));
  return Promise.resolve({
    dataset: { time: grid, values: grid.map((x) => [x]), labels: body.dataset.labels, units: body.dataset.units, metadata: { ...body.dataset.metadata } },
    warnings: [], source_range: [lo, hi], rows_in: time.length, rows_out: n,
  });
}

const a: DataStruct = { time: [0, 1, 2, 3], values: [[0], [10], [20], [30]], labels: ["M"], units: ["emu"], metadata: { x_column_unit: "K" } };
const DENSE = { mode: "n_points", nPoints: "77", step: "", start: "", stop: "", rangeStep: "", method: "pchip", outOfRange: "nan", sortUnsorted: false };
const rec = (id: string, name: string, over: object = {}) => ({ id, workshop: "resample", name, schema: 1, settings: DENSE, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", ...over });
const seed = (...records: unknown[]) => localStorage.setItem(PRESETS_KEY, JSON.stringify({ version: 1, presets: records }));
const ref = (id: string): RecipeRef => ({ kind: "preset", scope: "global", id });
const sources = () => ({ plotProject: [], plotGlobal: [], quickPlot: [], plotSourcesComplete: true });

beforeEach(() => {
  cleanup();
  localStorage.clear();
  lastUsedSlot.reset();
  vi.clearAllMocks();
  vi.mocked(resampleDataset).mockImplementation(fakeBackend);
  usePendingPreset.setState({ pending: null });
  useResampleDialog.setState({ seed: null });
  useApp.setState({ datasets: [{ id: "d1", name: "a.dat", data: a }], folders: [], activeId: "d1", selectedIds: ["d1"], plotRecipes: [], quickPlotTemplates: [], recipeSourcesComplete: true, macroRecording: true, macroSteps: [], history: [], future: [] });
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true, complete: true });
  useRecipeManager.setState({ open: true, library: true });
});

describe("the preset recipe kind", () => {
  it("is a stable-id, global, renameable kind with no duplicate or per-row export", () => {
    expect(RECIPE_KINDS).toContain("preset");
    expect(RECIPE_CAPABILITIES.preset).toMatchObject({ stableId: true, scopes: ["global"], canRename: true, canDuplicate: false, canImportExport: false, schemaVersioned: true });
    expect(supportsOperation("preset", "copyScope")).toBe(false);
  });

  it("lists presets with their tool and schema, and says when one needs a newer version or an unknown tool", () => {
    seed(rec("p1:a", "Dense"), rec("p1:b", "Future", { schema: 2 }), rec("p1:c", "Alien", { workshop: "warp-drive" }));
    const col = collectRecipes(sources());
    const rows = col.recipes.filter((r) => r.kind === "preset");
    expect(rows.map((r) => [r.name, r.summary])).toEqual([
      ["Dense", "Resample, schema 1"],
      ["Future", "Resample, schema 2, needs a newer version"],
      ["Alien", "tool 'warp-drive', schema 1, unknown tool"],
    ]);
    expect(rows[0]).toMatchObject({ ref: { kind: "preset", scope: "global", id: "p1:a" }, schemaVersion: 1, modifiedAt: "2026-01-02T00:00:00.000Z" });
    expect(col.complete).toBe(true);
    // The summary names the tool and schema, never a setting value.
    expect(JSON.stringify(rows)).not.toContain("pchip");
  });

  it("an unreadable or malformed presets file makes the collection incomplete (so the sidecar is not pruned)", () => {
    seed(rec("p1:a", "Dense"), "junk");
    expect(collectRecipes(sources()).complete).toBe(false);
    localStorage.setItem(PRESETS_KEY, "{not json");
    expect(collectRecipes(sources())).toMatchObject({ complete: false });
    expect(collectRecipes(sources()).recipes.filter((r) => r.kind === "preset")).toEqual([]);
  });

  it("details say the tool, state and where it is stored, and offer Open in tool, Rename and Delete only", () => {
    seed(rec("p1:a", "Dense"), rec("p1:b", "Future", { schema: 2 }));
    const col = collectRecipes(sources());
    const field = (name: string, label: string) => recipeDetails(col.recipes.find((r) => r.name === name)!, sources())?.fields.find((f) => f.label === label)?.value;
    expect(field("Dense", "Tool")).toBe("Resample");
    expect(field("Dense", "State")).toBe("ready");
    expect(field("Future", "State")).toContain("locked");
    expect(field("Dense", "Stored in")).toContain("not in the project");
    expect(field("Dense", "Available actions")).toBe("Open in tool, Rename, Delete");
    seed();
    expect(recipeDetails(col.recipes.find((r) => r.name === "Dense")!, sources())).toBeNull();
  });
});

describe("favourites sidecar", () => {
  it("a favourite survives a rename (the id is stable), and is pruned only after the preset is deleted", () => {
    seed(rec("p1:a", "Dense"));
    setFavorite(ref("p1:a"), true);
    renameRecipe(ref("p1:a"), "Denser");
    expect(metaFor(ref("p1:a")).favorite).toBe(true);
    expect(pruneEntries(liveKeys(collectRecipes(sources())), true)).toBe(0);
    expect(metaFor(ref("p1:a")).favorite).toBe(true);
    deleteRecipe(ref("p1:a"));
    pruneEntries(liveKeys(collectRecipes(sources())), true);
    expect(metaFor(ref("p1:a")).favorite).toBe(false);
  });

  it("an unreadable presets file never prunes anyone's favourite", () => {
    seed(rec("p1:a", "Dense"));
    setFavorite(ref("p1:a"), true);
    localStorage.setItem(PRESETS_KEY, "{not json");
    const col = collectRecipes(sources());
    expect(col.complete).toBe(false);
    pruneEntries(liveKeys(col), col.complete);
    expect(metaFor(ref("p1:a")).favorite).toBe(true);
  });
});

describe("row actions", () => {
  it("renames (id kept) and deletes exactly that record; a locked preset is not renamed", () => {
    seed(rec("p1:a", "Dense"), rec("p1:b", "Future", { schema: 2 }), rec("p1:c", "Other"));
    expect(renameRecipe(ref("p1:a"), "Denser")).toMatchObject({ ok: true, ref: ref("p1:a") });
    expect(renameRecipe(ref("p1:b"), "Nope")).toMatchObject({ ok: false, reason: expect.stringContaining("locked") });
    expect(renameRecipe(ref("p1:c"), "denser")).toMatchObject({ ok: false, reason: expect.stringContaining("already exists") });
    expect(deleteRecipe(ref("p1:c"))).toMatchObject({ ok: true });
    const left = (JSON.parse(localStorage.getItem(PRESETS_KEY)!) as { presets: { id: string; name: string }[] }).presets;
    expect(left.map((r) => [r.id, r.name])).toEqual([["p1:a", "Denser"], ["p1:b", "Future"]]);
    expect(deleteRecipe(ref("p1:c"))).toMatchObject({ ok: false, reason: "that preset no longer exists" });
  });

  it("Open in tool refuses a locked, unknown or vanished preset and opens nothing", async () => {
    seed(rec("p1:b", "Future", { schema: 2 }), rec("p1:c", "Alien", { workshop: "warp-drive" }), rec("p1:d", "Bad", { settings: { ...DENSE, nPoints: "-4" } }));
    for (const [id, why] of [["p1:b", "newer version"], ["p1:c", "not a tool"], ["p1:d", "nPoints"], ["p1:zzz", "no longer exists"]] as const) {
      const r = await applyOrOpen(ref(id));
      expect(r, id).toMatchObject({ ok: false, reason: expect.stringContaining(why) });
    }
    expect(useResampleDialog.getState().seed).toBeNull();
    expect(usePendingPreset.getState().pending).toBeNull();
  });

  it("Resample cannot open without a dataset: nothing is handed over", async () => {
    seed(rec("p1:a", "Dense"));
    useApp.setState({ activeId: null });
    expect(await applyOrOpen(ref("p1:a"))).toMatchObject({ ok: false, reason: expect.stringContaining("select a dataset") });
    expect(usePendingPreset.getState().pending).toBeNull();
  });
});

describe("Open in tool from the Library panel", () => {
  const form = () => ({
    n: (screen.getByRole("textbox", { name: "Number of points" }) as HTMLInputElement).value,
    method: (screen.getByRole("combobox", { name: "Interpolation" }) as HTMLSelectElement).value,
  });

  it("shows the preset as a Preset row, and Open in tool opens the tool with the draft loaded and runs nothing", async () => {
    seed(rec("p1:a", "Dense PCHIP"));
    render(
      <>
        <RecipeLibraryPanel />
        <ConfirmDialog />
      </>,
    );
    const row = screen.getByText("Dense PCHIP").closest("li, tr, div[role='listitem'], .qz-recipe-row") ?? document.body;
    expect(within(row as HTMLElement).getByText("Preset")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open in tool: Dense PCHIP" }));
    await waitFor(() => expect(useResampleDialog.getState().seed).toEqual(["d1"]));
    expect(usePendingPreset.getState().pending).toMatchObject({ workshop: "resample", id: "p1:a" });
    // The tool mounts afterwards (lazy): its bar takes the handoff and loads the draft.
    cleanup();
    render(<ResamplePanel />);
    await screen.findByRole("region", { name: "Resample presets" });
    await waitFor(() => expect(form()).toEqual({ n: "77", method: "pchip" }));
    expect(screen.getByRole("status").textContent).toContain("Applied preset 'Dense PCHIP' to Resample: press Create to run it");
    expect(usePendingPreset.getState().pending).toBeNull();
    // Never run: no dataset, no recorded step, no last used.
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().macroSteps).toEqual([]);
    expect(readLastUsed("resample")).toBeNull();
  });

  it("an already-open tool takes the preset at once (Revert returns to the hand-set form)", async () => {
    seed(rec("p1:a", "Dense PCHIP"));
    useResampleDialog.setState({ seed: ["d1"] });
    render(<ResamplePanel />);
    await screen.findByRole("region", { name: "Resample presets" });
    fireEvent.change(screen.getByRole("textbox", { name: "Number of points" }), { target: { value: "33" } });
    const out = await applyOrOpen(ref("p1:a"));
    expect(out).toMatchObject({ ok: true, message: expect.stringContaining("press Create to run it") });
    await waitFor(() => expect(form()).toEqual({ n: "77", method: "pchip" }));
    fireEvent.click(screen.getByRole("button", { name: "Revert" }));
    expect(form().n).toBe("33");
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("a stale handoff nobody took is ignored", async () => {
    seed(rec("p1:a", "Dense PCHIP"));
    usePendingPreset.setState({ pending: { workshop: "resample", id: "p1:a", at: Date.now() - 10 * 60 * 1000 } });
    useResampleDialog.setState({ seed: ["d1"] });
    render(<ResamplePanel />);
    await screen.findByRole("region", { name: "Resample presets" });
    expect(form().n).toBe("500");
  });
});
