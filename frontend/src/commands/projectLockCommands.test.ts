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
import { BROWSER_AUTOSAVE_LOCK_PATH } from "../useWorkspaceAutosave";
import { useProjectLockCommands } from "./projectLockCommands";

vi.mock("../store/toasts", () => ({ toast: vi.fn() }));

function action(id: string) {
  const a = useCommands.getState().menuCommands.find((c) => c.id === id);
  if (!a) throw new Error(`no published action ${id}`);
  return a;
}

/** Bundle diet slice 17: each body loads on first use, so `run()` returns
 *  that promise (typed `void`, like every async command). */
const run = (id: string) => Promise.resolve(action(id).run() as unknown);

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

  it("Take Over Editing refuses with a reason (never calls the store action) when the lock isn't stale", async () => {
    renderHook(() => useProjectLockCommands());
    const takeOverEditing = vi.fn();
    useProjectLock.setState({ takeOverEditing });
    await run("take-over-editing");
    expect(takeOverEditing).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/nothing to take over|not available/i), "danger");
  });

  it("Take Over Editing calls the store action when the lock is stale", async () => {
    renderHook(() => useProjectLockCommands());
    const takeOverEditing = vi.fn(async () => true);
    useProjectLock.setState({ status: "held-by-other-stale", path: "/p/x.dwk", takeOverEditing });
    await run("take-over-editing");
    expect(takeOverEditing).toHaveBeenCalled();
  });

  it("Take Over Editing reports a refusal, but stays quiet when the project closed meanwhile", async () => {
    renderHook(() => useProjectLockCommands());
    const refused = vi.fn(async () => false);
    useProjectLock.setState({ status: "held-by-other-stale", path: "/p/x.dwk", takeOverEditing: refused });
    await run("take-over-editing");
    await refused.mock.results[0]?.value;
    await Promise.resolve();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/responding again/), "danger");

    vi.mocked(toast).mockClear();
    const superseded = vi.fn(async () => {
      useProjectLock.setState({ path: null, status: "unlocked" }); // closed while the CAS ran
      return false;
    });
    useProjectLock.setState({ status: "held-by-other-stale", path: "/p/x.dwk", takeOverEditing: superseded });
    await run("take-over-editing");
    await superseded.mock.results[0]?.value;
    await Promise.resolve();
    expect(toast).not.toHaveBeenCalled();
  });

  it("Open as Copy refuses with a reason when the project isn't currently held read-only", async () => {
    renderHook(() => useProjectLockCommands());
    const openAsCopy = vi.fn();
    useProjectLock.setState({ openAsCopy });
    await run("open-as-copy");
    expect(openAsCopy).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/not read-only|nothing to copy/i), "danger");
  });

  it("Open as Copy calls the store action when the project is read-only", async () => {
    renderHook(() => useProjectLockCommands());
    const openAsCopy = vi.fn();
    useProjectLock.setState({ status: "held-by-other-live", path: "/p/x.dwk", openAsCopy });
    await run("open-as-copy");
    expect(openAsCopy).toHaveBeenCalled();
  });

  // N3 (coordinator review round 3): the shared browser autosave slot has no
  // separate "copy destination" — Open as Copy must refuse outright, before
  // ever reaching (or calling) the store action, regardless of status.
  it("N3: Open as Copy refuses for the browser autosave slot even though it's read-only", async () => {
    renderHook(() => useProjectLockCommands());
    const openAsCopy = vi.fn();
    useProjectLock.setState({ status: "held-by-other-live", path: BROWSER_AUTOSAVE_LOCK_PATH, openAsCopy });
    await run("open-as-copy");
    expect(openAsCopy).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/single autosave slot|take over editing/i), "danger");
  });
});
