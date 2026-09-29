// The Quick Figure Builder's first mapping consumes the error-binding
// CONFIDENCE GRADE (lib/errorBindingConfidence.ts): an adjacency-only (`low`)
// pairing is withheld until the user confirms it, and a `blocked` one is never
// applied. A name- or unit-backed pairing is applied as before.

import { describe, expect, it } from "vitest";

import { reviewSeedErrorBindings } from "./errorBindingConfidence";
import { assignQuickFigureColumn, assignmentFor, initialQuickFigureMapping } from "./quickFigureMappingActions";
import type { Dataset } from "./types";

function sheet(labels: string[], units: string[], extra: Partial<Dataset> = {}): Dataset {
  return {
    id: "d",
    name: "refl.dat",
    data: { time: [0, 1], values: [labels.map(() => 1), labels.map(() => 2)], labels, units, metadata: {} },
    ...extra,
  };
}

describe("initialQuickFigureMapping and the confidence grade", () => {
  it("withholds a low pairing: the column is neither an error nor a Y until confirmed", () => {
    const ds = sheet(["Q", "R", "dR", "SA", "err"], ["", "", "", "", ""]);
    const mapping = initialQuickFigureMapping(ds);
    expect(mapping.errorBindings).toEqual([{ channel: 2, target: 1, axis: "y", side: "both" }]);
    expect(mapping.yKeys).toEqual([0, 1, 3]);
    expect(assignmentFor(mapping, 4).role).toBe("ignore");
    // Confirming is the ordinary explicit assignment.
    const [ask] = reviewSeedErrorBindings(ds).confirm;
    const confirmed = assignQuickFigureColumn(mapping, ask.channel, { role: "error", target: ask.target, axis: ask.axis, side: ask.side });
    expect(confirmed.errorBindings).toContainEqual({ channel: 4, target: 3, axis: "y", side: "both" });
    expect(confirmed.ignoredKeys).not.toContain(4);
  });

  it("applies the same position pairing without asking once the units agree", () => {
    const mapping = initialQuickFigureMapping(sheet(["R", "err"], ["counts", "counts"]));
    expect(mapping.errorBindings).toEqual([{ channel: 1, target: 0, axis: "y", side: "both" }]);
    expect(mapping.ignoredKeys).toEqual([]);
  });

  it("never applies a blocked pairing carried by committed roles", () => {
    const committed = [{ channel: 1, target: 0, axis: "y" as const, side: "both" as const }];
    const mapping = initialQuickFigureMapping(sheet(["M", "M_err"], ["emu", "K"], { errorRoles: committed }));
    expect(mapping.errorBindings).toEqual([]);
    expect(mapping.ignoredKeys).toEqual([1]);
  });
});
