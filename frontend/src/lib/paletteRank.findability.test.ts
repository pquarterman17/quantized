// UX9-J findability: queries a scientist types that used to return nothing (or
// the wrong command) must put the intended EXISTING command in the top three,
// ranked against the real registry plus the real history-group entries.
import { describe, expect, it } from "vitest";

import { buildAppActions } from "../appCommands";
import { withHookDocs } from "../commands/hookCommandDocs";
import { buildHistoryActions } from "../components/history/useHistoryCommands";
import { useApp } from "../store/useApp";
import { contextPaletteActions } from "./paletteContextActions";
import { rankActions } from "./paletteRank";

useApp.setState({ datasets: [{ id: "d1", name: "Alpha", data: { time: [1], values: [[1]], labels: ["m"], units: [""], metadata: {} } }], activeId: "d1" });
const REAL = [...buildAppActions(useApp.getState), ...withHookDocs(buildHistoryActions("add dataset", null)), ...contextPaletteActions()];

// query -> the intended id (must be in the top three), plus companions that must be too.
const CASES: [string, string, string[]][] = [
  ["history", "history-list", []],
  ["undo history", "history-list", []],
  ["peak table", "peaks", ["reductions-wh"]],
  ["index peaks", "reductions-reference", ["reductions-pawley"]],
  ["d-spacing", "calculators", ["reductions-reference"]],
  ["Scherrer", "reductions-wh", ["calculators"]],
  ["parameter vs", "curvefit", []],
  ["tau vs T", "curvefit", []],
  ["batch fit", "curvefit", []],
];

describe("single-letter terms (UX9-J)", () => {
  const act = (label: string, keywords: string) => ({ id: label, group: "Analyze", label, keywords, run: () => {} });
  it("match a keyword that is exactly that letter, never a longer keyword's prefix", () => {
    const hit = act("Curve fit…", "tau vs t summary");
    const miss = act("Other item", "tauc terms");
    expect(rankActions([hit, miss], "tau vs t").map((r) => r.a.id)).toEqual(["Curve fit…"]);
    expect(rankActions([miss], "t")).toEqual([]);
  });
});

describe("palette findability (UX9-J)", () => {
  it.each(CASES)("%s", (q, intended, alsoTop3) => {
    const ids = rankActions(REAL, q).slice(0, 3).map((r) => r.a.id);
    expect(ids).toContain(intended);
    for (const id of alsoTop3) expect(ids).toContain(id);
  });
});
