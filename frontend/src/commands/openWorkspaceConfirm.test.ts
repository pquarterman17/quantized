// "Open workspace (.dwk)…" REPLACES the entire library — datasets, folders,
// reports, figure docs, saved specs, macro steps, windows. It used to do that
// on one click with no confirm AND no undo entry, while the strictly LESS
// destructive "Remove all…" in the same menu both confirmed and recorded
// undo. The 800ms autosave debounce then overwrote the discarded session's
// autosave record, so the loss was total within about a second.
//
// The guard lives on the COMMAND, not inside `loadWorkspace`, because that
// action has two legitimate non-interactive callers: `clearAll` (confirmed at
// its own call site) and the startup autosave restore. The last test here is
// the one that matters for that choice — a restore must never prompt.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { openFilePicker } from "../lib/openFilePicker";
import { WORKSPACE_FORMAT } from "../lib/workspace";
import { useApp } from "../store/useApp";
import type { DataStruct, Dataset } from "../lib/types";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../lib/openFilePicker", async (orig) => ({
  ...(await orig<typeof import("../lib/openFilePicker")>()),
  openFilePicker: vi.fn(),
}));

const data: DataStruct = {
  time: [0, 1],
  values: [[1], [2]],
  labels: ["y"],
  units: [""],
  metadata: {},
};
const ds = (id: string): Dataset => ({ id, name: `${id}.dat`, data });

/** Drive the picker's callback with a one-file .dwk payload, then let the
 *  whole async chain settle: file.text() -> dispatch -> askConfirm -> apply. */
async function pickWorkspaceFile(json: string) {
  const cb = vi.mocked(openFilePicker).mock.calls.at(-1)?.[0];
  if (!cb) throw new Error("openFilePicker was never called");
  cb([{ text: () => Promise.resolve(json) } as unknown as File]);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

const WS = JSON.stringify({
  format: WORKSPACE_FORMAT,
  version: 3,
  datasets: [],
  folders: [],
});

function openWorkspace() {
  const cmd = buildFileCommands(useApp.getState).find((c) => c.id === "open-workspace");
  if (!cmd) throw new Error("open-workspace command not registered");
  cmd.run();
}

beforeEach(() => {
  vi.mocked(askConfirm).mockReset();
  vi.mocked(openFilePicker).mockReset();
  useApp.setState({ datasets: [ds("a"), ds("b")], activeId: "a", selectedIds: [] });
});

describe("Open workspace — confirms before replacing the library", () => {
  it("asks before discarding a non-empty library", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    openWorkspace();
    await pickWorkspaceFile(WS);
    expect(askConfirm).toHaveBeenCalledOnce();
  });

  it("declining keeps every dataset", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    openWorkspace();
    await pickWorkspaceFile(WS);
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("counts what would be lost, so the prompt is not generic", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    openWorkspace();
    await pickWorkspaceFile(WS);
    expect(vi.mocked(askConfirm).mock.calls[0][1]).toContain("2 datasets");
  });

  it("does NOT prompt when the library is already empty (nothing to lose)", async () => {
    useApp.setState({ datasets: [], activeId: null, selectedIds: [] });
    openWorkspace();
    await pickWorkspaceFile(WS);
    expect(askConfirm).not.toHaveBeenCalled();
  });

  it("records an undo entry so the replace is recoverable", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    const before = useApp.getState().history.length;
    openWorkspace();
    await pickWorkspaceFile(WS);
    expect(useApp.getState().history.length).toBeGreaterThan(before);
    expect(useApp.getState().history.at(-1)?.label).toBe("open workspace");
  });

  it("the autosave restore path still calls loadWorkspace WITHOUT prompting", () => {
    // The reason the guard is on the command and not in the store action.
    useApp.getState().loadWorkspace({ datasets: [ds("restored")], folders: [] });
    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["restored"]);
  });
});
