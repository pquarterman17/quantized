// Bundle diet slice 30 (plans/BUNDLE_HEADROOM.md): the `.dwk` parse entry
// point loads once a file is picked. A chunk that will not load lands in the
// same "<verb> failed: …" status a parse failure does, clears the busy op, and
// opens nothing. Its own file because `vi.doMock` must be registered before
// the module's first load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "../commands/fileCommands";
import { openFilePicker } from "./openFilePicker";
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
  });
});
