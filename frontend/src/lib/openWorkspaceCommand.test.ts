// P1.2 box 3 (torn-write consumer fact, native branch): when a truncated/
// corrupt `.dwk` reaches `openWorkspaceCommand`'s NATIVE open path (a real
// desktop-bridge dialog, content already in memory — see that module's own
// doc for why this path calls `parseWorkspace` directly rather than through
// the Worker-backed `parseWorkspaceFile`), a `parseWorkspace` throw must
// never reach `dispatch` — the caller (fileCommands.ts's replace/append
// flow) would otherwise apply a partial workspace — and must surface as a
// clear `setStatus` failure instead.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openWorkspaceCommand } from "./openWorkspaceCommand";
import { useApp } from "../store/useApp";

const openProject = vi.fn();
vi.mock("./desktopBridge", () => ({
  CANCELLED: "qz/desktop-bridge/cancelled",
  hasDesktopShell: () => true,
  openProject: (...a: unknown[]) => openProject(...a),
}));

beforeEach(() => {
  openProject.mockReset();
  useApp.getState().setStatus("starting…");
});

describe("openWorkspaceCommand — native branch, a corrupt/truncated payload", () => {
  it("never calls dispatch and reports 'open failed: …' via setStatus", async () => {
    openProject.mockResolvedValue({ path: "/proj/workspace.dwk", content: "not json at all" });
    const dispatch = vi.fn();

    openWorkspaceCommand(useApp.getState, "open", dispatch)();

    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/^open failed:/));
    expect(useApp.getState().status).toMatch(/bad JSON/);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("also refuses a well-formed-JSON-but-not-a-workspace payload", async () => {
    openProject.mockResolvedValue({ path: "/proj/workspace.dwk", content: "[1, 2, 3]" });
    const dispatch = vi.fn();

    openWorkspaceCommand(useApp.getState, "open", dispatch)();

    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/^open failed:/));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("a well-formed workspace DOES reach dispatch (positive control)", async () => {
    const good = JSON.stringify({ format: "quantized-workspace", version: 4, datasets: [] });
    openProject.mockResolvedValue({ path: "/proj/workspace.dwk", content: good });
    // Wait on STATE (this flag), never poll the mock call directly — see
    // architecture.test.ts's weak-wait ratchet.
    let dispatched = false;
    const dispatch = vi.fn(() => {
      dispatched = true;
    });

    openWorkspaceCommand(useApp.getState, "open", dispatch)();

    await vi.waitFor(() => expect(dispatched).toBe(true));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(useApp.getState().status).not.toMatch(/^open failed:/);
  });
});
