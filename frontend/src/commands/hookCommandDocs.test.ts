// The hook-published commands carry no help copy of their own (it lives in
// commands/hookCommandDocs.ts, kept out of the startup chunk). These checks keep
// the table and the published commands from drifting apart.
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildHistoryActions, useHistoryCommands } from "../components/history/useHistoryCommands";
import { useWindowCommands } from "../components/windows/useWindowCommands";
import { useCommands, type Action } from "../store/commands";
import { HOOK_COMMAND_DOCS, mergeSearchable, withHookDocs } from "./hookCommandDocs";
import { useProjectLockCommands } from "./projectLockCommands";
import { useRelinkCommands } from "./relinkCommands";
import { useWorkbookTransferCommands } from "./workbookTransferCommands";

const run = (): void => undefined;

describe("hook command docs table", () => {
  const published = (): Action[] => {
    renderHook(() => {
      useWindowCommands();
      useHistoryCommands();
      useProjectLockCommands();
      useRelinkCommands();
      useWorkbookTransferCommands();
    });
    return [...useCommands.getState().menuCommands, ...buildHistoryActions(null, null)];
  };

  it("names only commands the hooks publish, and they carry no copy of their own", () => {
    const all = published();
    const byId = new Map(all.map((a) => [a.id, a]));
    for (const id of Object.keys(HOOK_COMMAND_DOCS)) {
      const a = byId.get(id);
      expect(a, id).toBeDefined();
      expect(a?.description, id).toBeUndefined();
      expect(a?.keywords, id).toBeUndefined();
    }
  });

  it("merges the table in, keeps a command's own copy, and leaves other commands alone", () => {
    const outside: Action = { id: "not-a-hook-command", group: "Window", label: "X", run };
    const own: Action = { id: "figure-save", group: "File", label: "Save editable figure", description: "Own copy.", run };
    const [merged, kept, untouched] = withHookDocs<Action>([{ id: "window-pin", group: "Window", label: "Pin window", run }, own, outside]);
    expect(merged.keywords).toBe(HOOK_COMMAND_DOCS["window-pin"].keywords);
    expect(kept.description).toBe("Own copy.");
    expect(kept.keywords).toBe(HOOK_COMMAND_DOCS["figure-save"].keywords);
    expect(untouched).toBe(outside);
    expect(withHookDocs([{ id: "toString", group: "X", label: "X", run }])[0]).not.toHaveProperty("description");
  });

  it("the searchable merge adds the docs and the old names", () => {
    const pin = { id: "window-pin", group: "Window", label: "Pin window", run };
    const rec = { id: "preferences", group: "File", label: "Preferences…", run };
    const found = mergeSearchable([rec], [pin]);
    expect(found.find((a) => a.id === "window-pin")?.keywords).toContain("Pin Window");
    expect(found.find((a) => a.id === "preferences")?.keywords).toContain("Settings");
  });
});
