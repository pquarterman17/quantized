// Relink Sources palette command (P1.7) — publish/re-publish + wiring only;
// the actual relink logic is store/relink.test.ts's job.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useCommands } from "../store/commands";
import { useRelink } from "../store/relink";
import { useRelinkCommands } from "./relinkCommands";

function action(id: string) {
  const a = useCommands.getState().menuCommands.find((c) => c.id === id);
  if (!a) throw new Error(`no published action ${id}`);
  return a;
}

beforeEach(() => {
  useCommands.setState({ menuCommands: [] });
  useRelink.setState({ open: false, oldRoot: "", newRoot: "", preview: [], busy: false, bridgeAvailable: false });
});

describe("useRelinkCommands", () => {
  it("publishes 'Relink sources…' to the palette registry", () => {
    renderHook(() => useRelinkCommands());
    expect(action("relink-sources").label).toBe("Relink sources…");
    expect(action("relink-sources").group).toBe("File");
  });

  it("opens the relink panel when run", () => {
    renderHook(() => useRelinkCommands());
    action("relink-sources").run();
    expect(useRelink.getState().open).toBe(true);
  });
});
