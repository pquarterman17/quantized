// The Open/Append-workspace commands load lib/openWorkspaceReplace.ts (the
// replace-and-confirm half) once a picked `.dwk` has parsed (bundle diet
// slice 17, plans/BUNDLE_HEADROOM.md). A half that will not load reports in
// the same "<verb> failed: …" status line a parse failure does, and nothing
// is replaced, appended or asked.
// Its own file because `vi.doMock` must be registered before the first load
// of the half (the other open-workspace suites load it).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { openFilePicker } from "../lib/openFilePicker";
import type { Dataset } from "../lib/types";
import { WORKSPACE_FORMAT } from "../lib/workspace";
import { useImportBatch } from "../store/importBatch";
import { useApp } from "../store/useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../lib/openFilePicker", async (orig) => ({
  ...(await orig<typeof import("../lib/openFilePicker")>()),
  openFilePicker: vi.fn(),
}));

const ds = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});
const WS = JSON.stringify({ format: WORKSPACE_FORMAT, version: 3, datasets: [], folders: [] });

function run(id: string): void {
  const cmd = buildFileCommands(useApp.getState).find((c) => c.id === id);
  if (!cmd) throw new Error(`${id} not registered`);
  cmd.run();
  const pick = vi.mocked(openFilePicker).mock.calls.at(-1)?.[0];
  if (!pick) throw new Error("openFilePicker was never called");
  pick([{ text: () => Promise.resolve(WS) } as unknown as File]);
}

const failHalf = () =>
  vi.doMock("../lib/openWorkspaceReplace", () => {
    throw new Error("network error");
  });

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  vi.mocked(openFilePicker).mockReset();
  useImportBatch.setState({ running: false });
  useApp.setState({
    datasets: [ds("a"), ds("b")],
    activeId: "a",
    selectedIds: [],
    currentProject: null,
    history: [],
    future: [],
    status: "idle",
  });
});

afterEach(() => {
  vi.doUnmock("../lib/openWorkspaceReplace");
  vi.resetModules();
});

describe("open/append workspace: the replace half will not load", () => {
  it("reports open failed, asks nothing and keeps the library", async () => {
    failHalf();
    vi.mocked(askConfirm).mockResolvedValue(true);
    run("open-workspace");

    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/^open failed: .+/));
    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a", "b"]);
    expect(useApp.getState().history).toEqual([]);
  });

  it("reports open failed for Open without layout too", async () => {
    failHalf();
    vi.mocked(askConfirm).mockResolvedValue(true);
    run("open-workspace-safe");

    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/^open failed: .+/));
    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("reports append failed and appends nothing", async () => {
    failHalf();
    const append = vi.spyOn(useApp.getState(), "appendWorkspace");
    run("append-workspace");

    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/^append failed: .+/));
    expect(append).not.toHaveBeenCalled();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("retries the load on the next open instead of staying broken", async () => {
    failHalf();
    vi.mocked(askConfirm).mockResolvedValue(true);
    run("open-workspace");
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/^open failed: /));

    // A rejected dynamic import is not cached, so the next open refetches.
    vi.doUnmock("../lib/openWorkspaceReplace");
    vi.resetModules();
    run("open-workspace");

    await vi.waitFor(() => expect(useApp.getState().datasets).toEqual([]));
    expect(askConfirm).toHaveBeenCalledOnce();
    expect(useApp.getState().history.at(-1)?.label).toBe("open workspace");
  });
});
