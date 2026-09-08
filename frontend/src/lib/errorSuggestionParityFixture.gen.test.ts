// P16 review finding #7 — cross-language parity for the Import Wizard's
// TWO-TIER error-binding suggestion narrowing.
//
// `suggestErrorBindings` here (importwizard.ts) and
// `quantized.io.error_binding_suggestions.suggest_error_bindings_by_channel`
// (a faithful Python port) are two independently maintained implementations
// of the SAME two-tier narrowing rule -- nothing in the toolchain enforces
// that they agree. `errorLabelParityFixture.gen.test.ts` already pins the
// LABEL-level inference (`inferErrorBindingsFromLabels`) the two share, but
// this two-tier layer sits ON TOP of that and had no cross-language pin at
// all until now, so a TS-side change to the demotion rule could drift
// silently. This file is BOTH the generator for
// tests/fixtures/error_labels/suggestion_parity_corpus.json AND the
// TypeScript half of the parity pin (the Python half is
// tests/test_error_suggestion_parity_fixture.py).
//
// THE FIXTURE IS GENERATED FROM THIS FILE'S TYPESCRIPT OUTPUT -- the
// TypeScript implementation is the source of truth for every case's
// `bindings`. A diff between what's committed and what this file computes
// means the TWO LANGUAGES DISAGREE (or this file's CASES list changed
// without regenerating) -- the fix is to make Python and TypeScript agree
// (or regenerate after an intentional TS change, then re-verify Python),
// NEVER to regenerate the fixture to paper over a Python regression.
//
// SCOPE NOTE: the cases below deliberately INCLUDE the ones that first
// exposed a divergence, rather than avoiding them. An earlier round fixed
// three real bugs in the Python only (an error column whose base name is
// the x column's was mis-bound to the nearest y instead of the x axis;
// source and target columns were not restricted by role) and scoped this
// corpus around them -- which would have left a parity fixture that passes
// only because it looks away from the one place the two disagree. The
// TypeScript carried the same bugs and has been fixed to match, so the
// cases live here where a future change to either side has to keep them
// agreeing.
//
// To regenerate after a deliberate change to the TS two-tier narrowing:
//   ERROR_LABEL_FIXTURE_WRITE=1 npx vitest run src/lib/errorSuggestionParityFixture.gen.test.ts
// then re-run this file's own parity test (no env var) to confirm it now
// matches, and update the Python port + its fixture test to match too.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { suggestErrorBindings } from "./importwizard";
import type { ImportColumnRole, ImportPreviewColumn } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
// frontend/src/lib -> repo root is three levels up.
const FIXTURE_PATH = join(
  here,
  "../../../tests/fixtures/error_labels/suggestion_parity_corpus.json",
);

interface ColumnSpec {
  name: string;
  role: ImportColumnRole;
  effective_name?: string;
}

interface CaseSpec {
  note: string;
  columns: ColumnSpec[];
}

interface FixtureBinding {
  channel: number;
  target: number;
  axis: "x" | "y";
  side: "both" | "+" | "-";
}

interface FixtureCase {
  note: string;
  columns: (ColumnSpec & { index: number })[];
  bindings: FixtureBinding[];
}

function toColumns(spec: ColumnSpec[]): ImportPreviewColumn[] {
  return spec.map((c, index) => ({
    index,
    name: c.name,
    unit: "",
    role: c.role,
    ...(c.effective_name !== undefined ? { effective_name: c.effective_name } : {}),
  }));
}

// Every case below mirrors an existing scenario from BOTH
// importwizard.test.ts's `describe("suggestErrorBindings ...")` block and
// tests/test_io_error_binding_suggestions.py -- i.e. behavior already
// proven identical between the two languages, now formalized as a shared,
// generated pin instead of two hand-maintained, independently-written
// test files that could drift apart without anything noticing.
const CASES: CaseSpec[] = [
  {
    note: "x-named error column binds to the X AXIS, not the nearest y (was mis-bound in both)",
    columns: [
      { name: "H", role: "x" },
      { name: "M", role: "y" },
      { name: "H_err", role: "error" },
    ],
  },
  {
    note: "same, with the x column NOT first — catches an index-space off-by-one",
    columns: [
      { name: "M", role: "y" },
      { name: "H", role: "x" },
      { name: "H_err", role: "error" },
    ],
  },
  {
    note: "a base-name match landing on a categorical column is never suggested",
    columns: [
      { name: "X", role: "x" },
      { name: "M", role: "y" },
      { name: "Cat", role: "categorical" },
      { name: "Cat_err", role: "error" },
    ],
  },
  {
    note: "an ignore-role column with an error-shaped name is never a suggestion source",
    columns: [
      { name: "T", role: "x" },
      { name: "R", role: "y" },
      { name: "dR", role: "ignore" },
    ],
  },
  {
    note: "unambiguous base-name pairing: Temp(x), R(y), dR(error)",
    columns: [
      { name: "Temp", role: "x" },
      { name: "R", role: "y" },
      { name: "dR", role: "error" },
    ],
  },
  {
    note: "rule-1 pairing whose base is only provisionally error-like (Serr) is not dropped",
    columns: [
      { name: "Serr", role: "y" },
      { name: "dSerr", role: "error" },
      { name: "X", role: "y" },
    ],
  },
  {
    note: "control: the same shape with a non-provisional base was never affected",
    columns: [
      { name: "R", role: "y" },
      { name: "dR", role: "error" },
      { name: "X", role: "y" },
    ],
  },
  {
    note: "classifies against effective_name, not the raw header name, when label_line overrides it",
    columns: [
      { name: "Col1", role: "x", effective_name: "Temp" },
      { name: "Col2", role: "y", effective_name: "R" },
      { name: "Col3", role: "error", effective_name: "dR" },
    ],
  },
  {
    note: "genuinely ambiguous error column gets NO suggestion at all -- never a guessed default",
    columns: [
      { name: "Temp", role: "x" },
      { name: "err", role: "error" },
      { name: "M", role: "y" },
    ],
  },
  {
    note: "demotes a MULTI-CANDIDATE position-only (rule 3) pairing to unassigned",
    columns: [
      { name: "T1", role: "y" },
      { name: "T err", role: "error" },
      { name: "T2", role: "y" },
    ],
  },
  {
    note: "keeps a SINGLE-CANDIDATE position-only pairing as a real suggestion",
    columns: [
      { name: "Temp", role: "x" },
      { name: "M", role: "y" },
      { name: "err", role: "error" },
    ],
  },
  {
    note: "a base-name match (rule 1) is never demoted, even with a plausible column following",
    columns: [
      { name: "R", role: "y" },
      { name: "dR", role: "error" },
      { name: "M", role: "y" },
    ],
  },
  {
    note: "an explicit x-prefix (rule 2) is never demoted either",
    columns: [
      { name: "Signal", role: "y" },
      { name: "xerr", role: "error" },
      { name: "M", role: "y" },
    ],
  },
  {
    note: "a following ERROR-role column (not a value column) does not itself trigger demotion",
    columns: [
      { name: "T1", role: "y" },
      { name: "err1", role: "error" },
      { name: "err2", role: "error" },
    ],
  },
  {
    note: "a following CATEGORICAL column (not a plausible numeric target) does not itself trigger demotion",
    columns: [
      { name: "T", role: "y" },
      { name: "err", role: "error" },
      { name: "Sample", role: "categorical" },
    ],
  },
];

function computeCases(): FixtureCase[] {
  return CASES.map(({ note, columns }) => {
    const previewColumns = toColumns(columns);
    return {
      note,
      columns: previewColumns.map((c, i) => ({ ...columns[i], index: c.index })),
      bindings: suggestErrorBindings(previewColumns).map((b) => ({
        channel: b.channel,
        target: b.target,
        axis: b.axis,
        side: b.side,
      })),
    };
  });
}

describe("error-suggestion parity fixture (generated from suggestErrorBindings)", () => {
  // Regeneration is opt-in (ERROR_LABEL_FIXTURE_WRITE=1) so a normal
  // `vitest run` never mutates a committed fixture as a side effect -- see
  // this file's header comment for the regeneration command.
  it("regenerates the fixture from the TypeScript source of truth when ERROR_LABEL_FIXTURE_WRITE=1", () => {
    if (process.env.ERROR_LABEL_FIXTURE_WRITE !== "1") {
      return;
    }
    const payload = {
      _generated_from:
        "frontend/src/lib/errorSuggestionParityFixture.gen.test.ts, running the real " +
        "suggestErrorBindings (importwizard.ts). A diff against " +
        "src/quantized/io/error_binding_suggestions.py's " +
        "suggest_error_bindings_by_channel port means the two languages " +
        "disagree -- fix the disagreement, never regenerate this file to hide it. " +
        "See this generator's header comment for the deliberate-divergence scope note.",
      cases: computeCases(),
    };
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  });

  it("the committed fixture matches what suggestErrorBindings produces right now", () => {
    const data = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as { cases: FixtureCase[] };
    expect(data.cases).toEqual(computeCases());
  });

  it("fixture is nontrivial and covers both suggested and demoted outcomes", () => {
    const data = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as { cases: FixtureCase[] };
    expect(data.cases.length).toBeGreaterThanOrEqual(CASES.length);
    expect(data.cases.some((c) => c.bindings.length > 0)).toBe(true);
    expect(data.cases.some((c) => c.bindings.length === 0)).toBe(true);
    // At least one x-axis (rule 2) case, the shape most likely to silently
    // regress unnoticed in the demotion logic.
    expect(data.cases.some((c) => c.bindings.some((b) => b.axis === "x"))).toBe(true);
  });
});
