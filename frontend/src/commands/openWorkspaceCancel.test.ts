// Open / Append workspace: Cancel while the parse is in flight leaves the
// current workspace untouched, and the late parse result is never applied
// (RESULT_ACCEPTANCE_AUDIT part 4, row 7).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./fileCommands";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { openFilePicker } from "../lib/openFilePicker";
import { WORKSPACE_FORMAT } from "../lib/workspace";
import { usePendingOps } from "../store/pendingOps";
import { useImportBatch } from "../store/importBatch";
import { useApp } from "../store/useApp";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../lib/openFilePicker", async (orig) => ({
  ...(await orig<typeof import("../lib/openFilePicker")>()),
  openFilePicker: vi.fn(),
}));

const ds = { id: "keep", name: "keep.dat", data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} } };
const WS = JSON.stringify({
  format: WORKSPACE_FORMAT,
  version: 3,
  datasets: [{ ...ds, id: "late", name: "late.dat" }],
  folders: [],
});

function heldFile(): { file: File; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return { file: { size: 2048, text: () => gate.then(() => WS) } as unknown as File, release };
}

function start(id: "open-workspace" | "append-workspace", file: File) {
  buildFileCommands(useApp.getState).find((c) => c.id === id)!.run();
  vi.mocked(openFilePicker).mock.calls.at(-1)![0]([file]);
}

beforeEach(() => {
  vi.mocked(askConfirm).mockReset().mockResolvedValue(true);
  vi.mocked(openFilePicker).mockReset();
  usePendingOps.setState({ ops: [] });
  useImportBatch.setState({ running: false });
  useApp.setState({ datasets: [ds], activeId: "keep", selectedIds: [] });
});

describe.each([["open-workspace", "open"], ["append-workspace", "append"]] as const)("%s Cancel", (id, verb) => {
  it("leaves the workspace unchanged and drops the late parse", async () => {
    const { file, release } = heldFile();
    start(id, file);
    await vi.waitFor(() => expect(usePendingOps.getState().ops[0]?.cancel).toBeDefined());
    expect(usePendingOps.getState().ops[0].label).toContain("2 kB");

    usePendingOps.getState().ops[0].cancel!();
    await vi.waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(useApp.getState().status).toBe(`${verb} cancelled — the current workspace is unchanged`);

    release(); // the late answer
    await new Promise((r) => setTimeout(r, 20));
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["keep"]);
    expect(askConfirm).not.toHaveBeenCalled();
    expect(useApp.getState().status).toBe(`${verb} cancelled — the current workspace is unchanged`);
  });
});
