// Bundle headroom slice 14: the Recent Projects reopen body loads through
// runLazy. A chunk that will not load must show the standard "Could not load
// the …" toast, leave no busy entry, and settle "failed" (a reason was
// toasted) — never reject into HomeScreen's or the palette's caller. Its own
// file because the failing module mock would break every reopen case in
// recentProjectsCommands.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePendingOps } from "../store/pendingOps";
import { useToasts } from "../store/toasts";
import { openRecentProject } from "./recentProjectsCommands";

vi.mock("./recentProjectReopen", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

beforeEach(() => {
  usePendingOps.setState({ ops: [] });
  useToasts.setState({ toasts: [] });
});

describe("openRecentProject when the reopen chunk fails to load", () => {
  it("toasts the load failure, settles 'failed' and leaves no busy entry", async () => {
    await expect(openRecentProject("a.dwk", "/p/a.dwk")).resolves.toBe("failed");
    expect(useToasts.getState().toasts.map((t) => [t.kind, t.msg])).toEqual([
      ["danger", expect.stringMatching(/^Could not load the project reopen: /)],
    ]);
    expect(usePendingOps.getState().ops).toEqual([]);
  });
});
