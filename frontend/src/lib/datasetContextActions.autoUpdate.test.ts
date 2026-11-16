// The Library row menu's "Auto-update from source" (gap audit 5 lane J, item
// 10): a toggle with a check mark, disabled WITH a reason for a worksheet that
// has no file path (a browser upload); the watcher itself loads lazily.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { actionMenuItem, type DatasetActionTarget } from "./contextActions";
import { datasetCoreActions } from "./datasetContextActions";
import { toggleAutoUpdate, watchedIds } from "./sourceWatchMenu";
import type { Dataset } from "./types";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";

const statSources = vi.hoisted(() => vi.fn());
vi.mock("./api/sourceWatch", () => ({ statSources, importLive: vi.fn() }));
vi.mock("../store/toasts", () => ({ toast: vi.fn() }));

const action = datasetCoreActions.find((a) => a.id === "dataset.autoUpdate")!;
const ds = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d1",
  name: "run.dat",
  data: { time: [0], values: [[0]], labels: ["x"], units: [""], metadata: {} },
  source: { kind: "path", path: "/data/run.dat" },
  importedAt: "2026-11-16T10:00:00.000Z",
  ...over,
});
type Item = Extract<NonNullable<ReturnType<typeof actionMenuItem>>, { run: () => void }>;
const target = (d: Dataset): DatasetActionTarget => ({
  dataset: d, active: false, selected: false, selectedIds: [], canMoveUp: false, canMoveDown: false, onRename: () => {}, onAddTag: () => {},
});
const itemOf = (d: Dataset): Item => actionMenuItem(action, target(d)) as Item;

beforeEach(() => {
  vi.clearAllMocks();
  statSources.mockResolvedValue([]);
});
afterEach(async () => {
  if (watchedIds.has("d1")) await toggleAutoUpdate("d1"); // leave no timer behind
});

describe("dataset.autoUpdate", () => {
  it("is enabled for a worksheet with a source path, unchecked at first", () => {
    const item = itemOf(ds());
    expect(item.label).toBe("Auto-update from source");
    expect(item.disabled).toBe(false);
    expect(item.checked).toBe(false);
  });

  it("a browser upload (no path) is disabled and says why", () => {
    const item = itemOf(ds({ source: undefined }));
    expect(item.disabled).toBe(true);
    expect(item.title).toMatch(/browser upload.*desktop app/);
  });

  it("turns watching on (checked, status says so) and off again", async () => {
    useApp.setState({ datasets: [ds()], status: "" });
    await toggleAutoUpdate("d1");
    expect(itemOf(ds()).checked).toBe(true);
    expect(useApp.getState().status).toMatch(/auto-update on for "run\.dat"/);
    await toggleAutoUpdate("d1");
    expect(itemOf(ds()).checked).toBe(false);
    expect(useApp.getState().status).toMatch(/auto-update off for "run\.dat"/);
  });

  it("on a path-less worksheet turns nothing on and toasts the reason", async () => {
    useApp.setState({ datasets: [ds({ source: undefined })] });
    await toggleAutoUpdate("d1");
    expect(watchedIds.has("d1")).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/browser upload/), "danger");
  });
});
