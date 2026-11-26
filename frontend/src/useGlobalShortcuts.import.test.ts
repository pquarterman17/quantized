// A4: Ctrl/Cmd+O, the palette/menu command and the Library button all reach
// ONE import entry (lib/importEntry.runImportEntry), so the picker they open
// has the same accept filter and the in-flight guard applies to all of them.
// The picker is mocked at its boundary (lib/openFilePicker), not the entry.

import { fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildFileCommands } from "./commands/fileCommands";
import { IMPORT_ACCEPT } from "./lib/openFilePicker";
import { ALREADY_RUNNING_MSG, useImportBatch } from "./store/importBatch";
import { useToasts } from "./store/toasts";
import { useApp } from "./store/useApp";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

const picker = vi.hoisted(() => vi.fn());
vi.mock("./lib/openFilePicker", async (orig) => ({
  ...(await orig<typeof import("./lib/openFilePicker")>()),
  openFilePicker: picker,
}));

beforeEach(() => {
  picker.mockClear();
  useImportBatch.setState({ running: false });
  useToasts.setState({ toasts: [] });
});

describe("Ctrl+O and Import data… share one import path", () => {
  it("both open the picker with the same accept filter", () => {
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "o", code: "KeyO", ctrlKey: true });
    buildFileCommands(useApp.getState).find((c) => c.id === "import")?.run();
    expect(picker).toHaveBeenCalledTimes(2);
    expect(picker.mock.calls[0]?.[1]).toBe(IMPORT_ACCEPT);
    expect(picker.mock.calls[1]?.[1]).toBe(IMPORT_ACCEPT);
  });

  it("Ctrl+O is refused with the in-flight toast while an import runs", () => {
    useImportBatch.setState({ running: true });
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "o", code: "KeyO", ctrlKey: true });
    expect(picker).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts.at(-1)?.msg).toBe(ALREADY_RUNNING_MSG);
  });
});
