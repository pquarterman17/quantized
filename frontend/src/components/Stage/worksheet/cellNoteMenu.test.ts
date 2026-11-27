// Acceptance 8 C2: the note entry's shortcut reads like the other cell-menu items on each platform.
import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { cellNoteItems } from "./cellNoteMenu";

const ds: Dataset = { id: "d", name: "d", data: { time: [0], values: [[1]], labels: ["v"], units: [""], metadata: {} } };
const label = (isMac: boolean) => cellNoteItems(ds, 0, 0, isMac).find((i) => "label" in i && i.label === "Add note…");

describe("cellNoteItems shortcut", () => {
  it("is spelled out off a Mac and a glyph on one", () => {
    expect(label(false)).toMatchObject({ shortcutLabel: "Alt+Shift+F2" });
    expect(label(true)).toMatchObject({ shortcutLabel: "⌥⇧F2" });
  });
});
