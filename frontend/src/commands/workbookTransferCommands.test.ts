// PR I: "Paste workbook" palette command — publish/wiring only; the actual
// paste logic is store/workbookTransfer.test.ts's job.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCommands } from "../store/commands";
import { useApp } from "../store/useApp";
import { useWorkbookTransferCommands } from "./workbookTransferCommands";

function action(id: string) {
  const a = useCommands.getState().menuCommands.find((c) => c.id === id);
  if (!a) throw new Error(`no published action ${id}`);
  return a;
}

beforeEach(() => {
  useCommands.setState({ menuCommands: [] });
});

describe("useWorkbookTransferCommands", () => {
  it("publishes 'Paste workbook' to the palette registry, under File", () => {
    renderHook(() => useWorkbookTransferCommands());
    expect(action("paste-workbook").label).toBe("Paste workbook");
    expect(action("paste-workbook").group).toBe("File");
  });

  it("running it calls pasteWorkbookFromClipboard on the store", () => {
    renderHook(() => useWorkbookTransferCommands());
    const pasteWorkbookFromClipboard = vi.fn();
    useApp.setState({ pasteWorkbookFromClipboard });
    action("paste-workbook").run();
    expect(pasteWorkbookFromClipboard).toHaveBeenCalledWith();
  });
});
