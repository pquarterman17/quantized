// Take Over Editing / Open as Copy load their bodies on first use (bundle
// diet slice 17, plans/BUNDLE_HEADROOM.md). A body that will not load must
// not vanish: `run()` returns the load's promise, so `runAction` reports the
// rejection as a danger toast naming the command, and no lock action runs.
// Its own file because `vi.doMock` must be registered before the first load
// of the body (projectLockCommands.test.ts loads it).
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAction, useCommands } from "../store/commands";
import { usePendingOps } from "../store/pendingOps";
import { useProjectLock } from "../store/projectLock";
import { useToasts } from "../store/toasts";
import { untilState } from "../test/untilState";
import { useProjectLockCommands } from "./projectLockCommands";

function action(id: string) {
  const a = useCommands.getState().menuCommands.find((c) => c.id === id);
  if (!a) throw new Error(`no published action ${id}`);
  return a;
}

const dangerToasts = () => useToasts.getState().toasts.filter((t) => t.kind === "danger").map((t) => t.msg);

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useCommands.setState({ menuCommands: [] });
  vi.doMock("./projectLockRun", () => {
    throw new Error("network error");
  });
});

afterEach(() => {
  vi.doUnmock("./projectLockRun");
  vi.resetModules();
});

describe("project-lock commands: the body's chunk will not load", () => {
  it("Take Over Editing reports the load failure and takes nothing over", async () => {
    renderHook(() => useProjectLockCommands());
    const takeOverEditing = vi.fn(async () => true);
    useProjectLock.setState({ status: "held-by-other-stale", path: "/p/x.dwk", takeOverEditing });

    runAction(action("take-over-editing"));

    await untilState(useToasts, () => {
      expect(dangerToasts()).toEqual([expect.stringMatching(/^Take Over Editing failed: .+/)]);
    });
    expect(takeOverEditing).not.toHaveBeenCalled();
    expect(usePendingOps.getState().ops).toEqual([]);
  });

  it("Open as Copy reports the load failure and opens nothing", async () => {
    renderHook(() => useProjectLockCommands());
    const openAsCopy = vi.fn();
    useProjectLock.setState({ status: "held-by-other-live", path: "/p/x.dwk", openAsCopy });

    runAction(action("open-as-copy"));

    await untilState(useToasts, () => {
      expect(dangerToasts()).toEqual([expect.stringMatching(/^Open as Copy failed: .+/)]);
    });
    expect(openAsCopy).not.toHaveBeenCalled();
  });
});
