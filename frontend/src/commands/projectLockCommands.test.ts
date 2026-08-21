// PR I2 (L0.47): "Take Over Editing" / "Open as Copy" palette commands —
// publish/gating/wiring only; the actual lock logic is
// store/projectLock.test.ts's job. store/commands.ts's `Action` has no
// `disabled` field (this app's palette convention — see e.g.
// commands/relinkCommands.ts — is always-enabled, with `run()` itself
// refusing gracefully when not applicable), so the gating tests below drive
// `run()` and observe the refusal, not a disabled flag.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCommands } from "../store/commands";
import { toast } from "../store/toasts";
import { useProjectLock } from "../store/projectLock";
import { useProjectLockCommands } from "./projectLockCommands";

vi.mock("../store/toasts", () => ({ toast: vi.fn() }));

function action(id: string) {
  const a = useCommands.getState().menuCommands.find((c) => c.id === id);
  if (!a) throw new Error(`no published action ${id}`);
  return a;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCommands.setState({ menuCommands: [] });
  useProjectLock.setState({
    status: "unlocked",
    record: null,
    path: null,
    openedAsCopy: false,
    provider: {
      read: async () => null,
      tryAcquire: async () => ({ acquired: true, record: null }),
      refresh: async () => ({ acquired: true, record: null }),
      takeOver: async () => ({ acquired: true, record: null }),
      release: async () => true,
    },
  });
});

describe("useProjectLockCommands", () => {
  it("publishes both commands to the File group", () => {
    renderHook(() => useProjectLockCommands());
    expect(action("take-over-editing").group).toBe("File");
    expect(action("open-as-copy").group).toBe("File");
  });

  it("Take Over Editing refuses with a reason (never calls the store action) when the lock isn't stale", () => {
    renderHook(() => useProjectLockCommands());
    const takeOverEditing = vi.fn();
    useProjectLock.setState({ takeOverEditing });
    action("take-over-editing").run();
    expect(takeOverEditing).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/nothing to take over|not available/i), "danger");
  });

  it("Take Over Editing calls the store action when the lock is stale", () => {
    renderHook(() => useProjectLockCommands());
    const takeOverEditing = vi.fn(async () => true);
    useProjectLock.setState({ status: "held-by-other-stale", path: "/p/x.dwk", takeOverEditing });
    action("take-over-editing").run();
    expect(takeOverEditing).toHaveBeenCalled();
  });

  it("Open as Copy refuses with a reason when the project isn't currently held read-only", () => {
    renderHook(() => useProjectLockCommands());
    const openAsCopy = vi.fn();
    useProjectLock.setState({ openAsCopy });
    action("open-as-copy").run();
    expect(openAsCopy).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/not read-only|nothing to copy/i), "danger");
  });

  it("Open as Copy calls the store action when the project is read-only", () => {
    renderHook(() => useProjectLockCommands());
    const openAsCopy = vi.fn();
    useProjectLock.setState({ status: "held-by-other-live", path: "/p/x.dwk", openAsCopy });
    action("open-as-copy").run();
    expect(openAsCopy).toHaveBeenCalled();
  });
});
