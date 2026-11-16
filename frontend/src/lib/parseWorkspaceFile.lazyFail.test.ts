// Bundle diet slice 30 (plans/BUNDLE_HEADROOM.md): the `.dwk` parse entry
// point loads once a file is picked. A chunk that will not load lands in the
// same "<verb> failed: …" status a parse failure does, clears the busy op, and
// opens nothing. Its own file because `vi.doMock` must be registered before
// the module's first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "../commands/fileCommands";
import { openFilePicker } from "./openFilePicker";
import { WORKSPACE_FORMAT } from "./workspace";
import { usePendingOps } from "../store/pendingOps";
import { useImportBatch } from "../store/importBatch";
import { useApp } from "../store/useApp";

vi.mock("./openFilePicker", async (orig) => ({
  ...(await orig<typeof import("./openFilePicker")>()),
  openFilePicker: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(openFilePicker).mockReset();
  usePendingOps.setState({ ops: [] });
  useImportBatch.setState({ running: false });
  useApp.setState({ datasets: [], activeId: null, selectedIds: [], status: "" });
});

afterEach(() => {
  vi.doUnmock("./parseWorkspaceFile");
});

describe("Open workspace: the parse chunk will not load", () => {
  it("reports it as an open failure, clears the busy op and opens nothing", async () => {
    vi.doMock("./parseWorkspaceFile", () => {
      throw new Error("network error");
    });
    const before = useApp.getState().datasets;
    buildFileCommands(useApp.getState).find((c) => c.id === "open-workspace")?.run();
    const pick = vi.mocked(openFilePicker).mock.calls.at(-1)?.[0];
    expect(pick).toBeDefined();
    pick?.([{ text: () => Promise.resolve("{}") } as unknown as File]);

    await vi.waitFor(() => {
      expect(useApp.getState().status).toMatch(/^open failed: .+/);
      expect(usePendingOps.getState().ops).toHaveLength(0);
    });
    expect(useApp.getState().datasets).toBe(before);

    // Nothing is cached on the failure: the next open loads the parser and opens.
    vi.doUnmock("./parseWorkspaceFile");
    useApp.setState({ status: "" });
    buildFileCommands(useApp.getState).find((c) => c.id === "open-workspace")?.run();
    const retry = vi.mocked(openFilePicker).mock.calls.at(-1)?.[0];
    const ws = JSON.stringify({
      format: WORKSPACE_FORMAT,
      version: 3,
      datasets: [{ id: "d1", name: "retry.dat", data: { time: [1, 2], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } }],
      folders: [],
    });
    retry?.([{ text: () => Promise.resolve(ws) } as unknown as File]);
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/^loaded workspace/));
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["retry.dat"]);
  });
});
