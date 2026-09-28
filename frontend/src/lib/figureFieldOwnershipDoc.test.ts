// PRIMARY_SOFTWARE_AUDIT_PLAN — "Document one ownership path per field before
// deleting adapters." `docs/figure_field_ownership.md` is that document,
// generated from figureContract.ts's own field census. This guard keeps the
// two from drifting apart: every field this file classifies "canonical" (the
// only classification that owns an independent, persisted storage location —
// see figureContract.ts's own module doc) must be named in the doc, so a
// future field added to PlotView/FigureDoc — or renamed — fails HERE instead
// of silently leaving the doc stale.
//
// Sabotage-verifiable: add a new `canonical(...)` field to
// PLOT_VIEW_FIELD_CONTRACT or FIGURE_DOC_FIELD_CONTRACT (or rename an
// existing one) without adding it to the doc, and the matching case fails.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FIGURE_FIELD_CONTRACTS } from "./figureContract";

const docPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "docs", "figure_field_ownership.md",
);
const doc = readFileSync(docPath, "utf8");

describe("figure_field_ownership.md stays in sync with figureContract.ts", () => {
  for (const [modelName, fields] of Object.entries(FIGURE_FIELD_CONTRACTS)) {
    const canonicalFields = Object.entries(fields)
      .filter(([, contract]) => contract.classification === "canonical")
      .map(([field]) => field);

    if (canonicalFields.length === 0) continue;

    it(`${modelName}: every canonical field is named in the doc`, () => {
      for (const field of canonicalFields) {
        // Rendered as `field` (backtick-quoted) in the doc's tables — a plain
        // substring match would also accept an unrelated mention (or another
        // field's name that happens to contain this one), so require the same
        // markdown inline-code form the doc actually uses.
        expect(doc, `docs/figure_field_ownership.md is missing the canonical field \`${field}\` (${modelName})`)
          .toContain(`\`${field}\``);
      }
    });
  }

  it("covers exactly the two contracts that currently have canonical fields", () => {
    // Guards the doc's own "Scope" section: if a THIRD contract (PlotSpec,
    // FigureConfig, FigureSpec) ever gains a canonical field, that model's
    // fields need their own table here too, not just a first-guard pass on
    // the two existing tables above.
    const contractsWithCanonicalFields = Object.entries(FIGURE_FIELD_CONTRACTS)
      .filter(([, fields]) => Object.values(fields).some((c) => c.classification === "canonical"))
      .map(([name]) => name);
    expect(contractsWithCanonicalFields.sort()).toEqual(["FigureDoc", "PlotView"]);
  });
});
