// The core commands' help copy lives in commands/commandDocs.ts (kept out of
// the startup chunk) and is merged back by buildAppActions. These checks keep
// the table and the command list from drifting apart.
import { describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import { buildCoreActions } from "../appCommandsCore";
import { useApp } from "../store/useApp";
import { CORE_COMMAND_DOCS, withCommandDocs } from "./commandDocs";

describe("core command docs table", () => {
  const core = buildCoreActions(useApp.getState);

  it("has exactly one entry per core command", () => {
    const ids = core.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(CORE_COMMAND_DOCS).sort()).toEqual([...ids].sort());
  });

  it("is the only home of the core commands' descriptions and keywords", () => {
    expect(core.filter((a) => a.description !== undefined || a.keywords !== undefined).map((a) => a.id)).toEqual([]);
    for (const docs of Object.values(CORE_COMMAND_DOCS)) expect(docs.description?.trim()).toBeTruthy();
  });

  it("the full list carries every core command's description and keywords", () => {
    const full = new Map(buildAppActions(useApp.getState).map((a) => [a.id, a]));
    for (const a of core) {
      const merged = full.get(a.id);
      expect(merged?.description, a.id).toBe(CORE_COMMAND_DOCS[a.id].description);
      expect(merged?.keywords, a.id).toBe(CORE_COMMAND_DOCS[a.id].keywords);
      expect(merged?.label, a.id).toBe(a.label);
    }
  });

  it("merging keeps everything else and leaves commands outside the table alone", () => {
    const run = (): void => undefined;
    const checked = (): boolean => true;
    const outside = { id: "not-a-core-command", group: "Analyze", label: "X", description: "Own copy.", run };
    const [merged, untouched] = withCommandDocs([{ id: "grid", group: "Plot", label: "Toggle grid lines", checked, run }, outside]);
    expect(merged).toEqual({ id: "grid", group: "Plot", label: "Toggle grid lines", checked, run, ...CORE_COMMAND_DOCS.grid });
    expect(untouched).toBe(outside);
    // An inherited Object.prototype name is not a table entry.
    expect(withCommandDocs([{ id: "toString", group: "X", label: "X", run }])[0]).not.toHaveProperty("description");
  });
});
