// P16 — cross-language parity for error-column label inference.
//
// `inferErrorBindingsFromLabels` here (errorRoles.ts, built on
// errorLabelCandidates.ts / errorLabelClassify.ts) and
// `quantized.io.error_inference.infer_error_bindings_from_labels` (a
// faithful Python port, src/quantized/io/error_label_candidates.py +
// error_label_classify.py + error_inference.py) are two independently
// maintained implementations of the SAME rules -- nothing in the toolchain
// enforces that they agree. This file is BOTH the generator for
// tests/fixtures/error_labels/parity_corpus.json AND the TypeScript half
// of the parity pin (the Python half is
// tests/test_error_inference_parity_fixture.py).
//
// THE FIXTURE IS GENERATED FROM THIS FILE'S TYPESCRIPT OUTPUT -- the
// TypeScript implementation is the source of truth for every case's
// `bindings`. A diff between what's committed and what this file computes
// means the TWO LANGUAGES DISAGREE (or this file's CASES list changed
// without regenerating) -- the fix is to make Python and TypeScript agree
// (or regenerate after an intentional TS change, then re-verify Python),
// NEVER to regenerate the fixture to paper over a Python regression.
//
// To regenerate after a deliberate change to the TS classifier:
//   ERROR_LABEL_FIXTURE_WRITE=1 npx vitest run src/lib/errorLabelParityFixture.gen.test.ts
// then re-run this file's own parity test (no env var) to confirm it now
// matches, and update the Python port + its fixture test to match too.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { inferErrorBindingsFromLabels } from "./errorRoles";

const here = dirname(fileURLToPath(import.meta.url));
// frontend/src/lib -> repo root is three levels up.
const FIXTURE_PATH = join(here, "../../../tests/fixtures/error_labels/parity_corpus.json");

interface CaseSpec {
  note: string;
  labels: string[];
}

interface FixtureBinding {
  channel: number;
  target: number;
  axis: "x" | "y";
  side: "both" | "+" | "-";
}

interface FixtureCase {
  note: string;
  labels: string[];
  bindings: FixtureBinding[];
}

// Every case below is a `labels` array actually exercised (or a close
// domain-corpus analogue of one) by errorLabelInvariant.test.ts,
// errorLabelOrdinaryNames.test.ts, and errorRoles.test.ts -- the three
// files covering errorLabelCandidates.ts / errorLabelClassify.ts /
// errorRoles.ts -- plus the plan's own worked examples
// (plans/archive/ERROR_LABEL_CLASSIFIER_PLAN.md), the domain corpora it
// names (MOKE, XRD, SIMS, magnetometry, hyphenated Origin sample names),
// and the task's explicit hard cases (Unicode, mixed-case, empty/single
// column). See P16's task description for the full checklist this covers.
const CASES: CaseSpec[] = [
  // ── errorRoles.test.ts: inferErrorBindings / inferErrorBindingsFromLabels ──
  { note: "base-name match: dR -> R (unambiguous)", labels: ["R", "dR"] },
  { note: "explicit x-prefix binds to the x axis", labels: ["Signal", "xerr"] },
  { note: "explicit y-prefix (symmetry check for x-prefix)", labels: ["Signal", "yerr"] },
  {
    note: "nearest PRECEDING value column (reflectometry instrument-file convention)",
    labels: ["R++", "err", "SA", "err"],
  },
  { note: "both halves of an asymmetric +/- pair", labels: ["M", "M_err+", "M_err-"] },
  { note: "asymmetric hi/lo suffixes", labels: ["M", "M_hi", "M_lo"] },
  { note: "asymmetric upper/lower suffixes", labels: ["M", "M_upper", "M_lower"] },
  { note: "leading error column has nothing defensible preceding it -> unbound", labels: ["err", "M"] },
  { note: "no error columns at all -> nothing", labels: ["Temp", "Moment"] },
  {
    note: "inferErrorBindingsFromLabels === inferErrorBindings(ds) delegation fixture",
    labels: ["R", "dR", "M_err+", "M_err-", "M"],
  },
  { note: "dQ base-name match (second delta-convention letter)", labels: ["Q", "dQ"] },

  // ── errorLabelInvariant.test.ts: the never-classify corpus, with siblings ──
  { note: "never-classify: Kerr beside T,R (no K sibling) -> unbound", labels: ["T", "R", "Kerr"] },
  { note: "never-classify: Phase beside T,R -> unbound", labels: ["T", "R", "Phase"] },
  { note: "never-classify: Noise beside T,R -> unbound", labels: ["T", "R", "Noise"] },
  { note: "never-classify: Sensor beside T,R -> unbound", labels: ["T", "R", "Sensor"] },
  { note: "never-classify: Response beside T,R -> unbound", labels: ["T", "R", "Response"] },
  { note: "never-classify: Dose beside T,R -> unbound", labels: ["T", "R", "Dose"] },
  { note: "never-classify: Pulse beside T,R -> unbound", labels: ["T", "R", "Pulse"] },
  { note: "never-classify: Base beside T,R -> unbound", labels: ["T", "R", "Base"] },
  { note: "never-classify: Use beside T,R -> unbound", labels: ["T", "R", "Use"] },
  { note: "never-classify: Series beside T,R -> unbound", labels: ["T", "R", "Series"] },
  { note: "never-classify: Second beside T,R -> unbound", labels: ["T", "R", "Second"] },
  { note: "never-classify: Depth beside T,R -> unbound", labels: ["T", "R", "Depth"] },
  { note: "never-classify: Delay beside T,R -> unbound", labels: ["T", "R", "Delay"] },
  { note: "never-classify: Density beside T,R -> unbound", labels: ["T", "R", "Density"] },
  { note: "never-classify: Set beside T,R (2-char token glue exclusion) -> unbound", labels: ["T", "R", "Set"] },

  // X_err -> X acceptance corpus (explicit leading-x-axis-name, trailing "_err")
  { note: "X_err acceptance: Phase_err -> Phase", labels: ["Time", "Phase", "Phase_err"] },
  { note: "X_err acceptance: Base_err -> Base", labels: ["Time", "Base", "Base_err"] },
  { note: "X_err acceptance: Noise_err -> Noise", labels: ["Time", "Noise", "Noise_err"] },
  { note: "X_err acceptance: Sensor_err -> Sensor", labels: ["Time", "Sensor", "Sensor_err"] },
  { note: "X_err acceptance: Response_err -> Response", labels: ["Time", "Response", "Response_err"] },
  { note: "X_err acceptance: Set_err -> Set", labels: ["Time", "Set", "Set_err"] },
  { note: "X_err acceptance: Pulse_err -> Pulse", labels: ["Time", "Pulse", "Pulse_err"] },
  { note: "X_err acceptance: Use_err -> Use", labels: ["Time", "Use", "Use_err"] },

  // The Ierr / Kerr domain special case, both halves pinned together.
  { note: "Ierr with NO I sibling -> positional pairing takes over (XRD)", labels: ["2theta", "Intensity", "Ierr"] },
  { note: "Ierr WITH a literal I sibling -> base-name match", labels: ["I", "Ierr"] },
  { note: "Ierr alone, no siblings at all -> unbound (nothing precedes)", labels: ["Ierr"] },
  { note: "Kerr beside Field,Phase (no K sibling) -> unbound (the deliberate exclusion)", labels: ["Field", "Phase", "Kerr"] },
  { note: "Kerr WITH a literal K sibling -> base-name match (symmetric with Ierr)", labels: ["K", "Kerr"] },

  // MStdErr / M_std_err absolute ranking pins, resolved through full selection.
  { note: "MStdErr beside M -> base-name match on the longer token (stderr)", labels: ["M", "MStdErr"] },
  { note: "M_std_err (explicit separators) beside M -> same as camelCase", labels: ["M", "M_std_err"] },

  // ── errorLabelOrdinaryNames.test.ts: prefix-lookalikes that must stay inert ──
  { note: "ordinary name starting with d-: Depth, beside T,R -> unbound", labels: ["T", "R", "Depth"] },
  { note: "ordinary name starting with d-: Density, beside T,R -> unbound", labels: ["T", "R", "Density"] },
  { note: "ordinary name starting with d-: Delay, beside T,R -> unbound", labels: ["T", "R", "Delay"] },
  { note: "ordinary name starting with d-: Deviation, beside T,R -> unbound", labels: ["T", "R", "Deviation"] },
  { note: "ordinary name starting with d-: Delta, beside T,R -> unbound", labels: ["T", "R", "Delta"] },
  { note: "ordinary name starting with d-: Deg, beside T,R -> unbound", labels: ["T", "R", "Deg"] },
  { note: "ordinary name starting with s-: Sample, beside T,R -> unbound", labels: ["T", "R", "Sample"] },
  { note: "ordinary name starting with s-: Sensitivity, beside T,R -> unbound", labels: ["T", "R", "Sensitivity"] },
  { note: "ordinary name starting with s-: Separation, beside T,R -> unbound", labels: ["T", "R", "Separation"] },
  { note: "ordinary name starting with e-: Temperature, beside T,R -> unbound", labels: ["T", "R", "Temperature"] },
  { note: "ordinary name starting with e-: Energy, beside T,R -> unbound", labels: ["T", "R", "Energy"] },
  { note: "ordinary name starting with e-: Extinction, beside T,R -> unbound", labels: ["T", "R", "Extinction"] },
  { note: "nastiest shape: a real D column beside Depth -> still unbound", labels: ["D", "Depth"] },
  { note: "nastiest shape: a real S column beside Sample -> still unbound", labels: ["S", "Sample"] },
  { note: "nastiest shape: a real E column beside Energy -> still unbound", labels: ["E", "Energy"] },
  {
    note: "a genuine error bar still detected alongside an inert ordinary name (not merely inert everywhere)",
    labels: ["Depth", "R", "Rerr"],
  },

  // ── Plan worked examples / documented hard cases ──────────────────────────
  { note: "Rerr glued reading alone (provisional, no sibling) -> unbound", labels: ["Rerr"] },
  { note: "Rerr glued reading WITH sibling R -> base-name match", labels: ["R", "Rerr"] },
  { note: "T,Set (2-char token glue exclusion, single-letter sibling present)", labels: ["T", "Set"] },
  { note: "Std Dev (separated, no base) binds positionally", labels: ["M", "Std Dev"] },
  {
    note: "hyphenated Origin sample name: NbAu-1_err -> NbAu-1 (punctuation base-matching)",
    labels: ["NbAu-1", "NbAu-1_err"],
  },
  {
    note: "hyphenated Origin sample names: NbAu-1_err must not bind to NbAu-2",
    labels: ["NbAu-1", "NbAu-2", "NbAu-1_err"],
  },

  // ── Domain corpora named in the plan (real headers from this toolbox) ─────
  { note: "MOKE: Field, Kerr, Phase (Kerr stays unbound, no K sibling)", labels: ["Field", "Kerr", "Phase"] },
  { note: "XRD: 2theta, Intensity, Ierr", labels: ["2theta", "Intensity", "Ierr"] },
  { note: "SIMS depth profile: Depth (nm), Si, O, Si_sigma", labels: ["Depth (nm)", "Si", "O", "Si_sigma"] },
  { note: "magnetometry: Temp (K), M, M_std_err", labels: ["Temp (K)", "M", "M_std_err"] },

  // ── Two-tier wizard-narrowing precursor shapes (raw inference, unnarrowed) ─
  { note: "Temp, M, err -- single-candidate positional pairing", labels: ["Temp", "M", "err"] },
  {
    note: "T1, 'T err', T2 -- raw inference still binds via rule 3 (unbounded-forward); " +
      "the wizard's two-tier narrowing (Python error_binding_suggestions.py, TS importwizard.ts) " +
      "is what demotes this to unassigned, NOT this function",
    labels: ["T1", "T err", "T2"],
  },

  // ── Unicode and mixed-case labels ──────────────────────────────────────────
  { note: "Unicode accented base name with explicit _err suffix", labels: ["Résistance", "Résistance_err"] },
  { note: "Unicode Greek letter base name with explicit _err suffix", labels: ["Ω", "Ω_err"] },
  { note: "Unicode combining base name (Delta-theta) with explicit _err suffix", labels: ["Δθ", "Δθ_err"] },
  { note: "mixed case: ALL-CAPS base, mixed-case _ERR suffix", labels: ["MASS", "mass_ERR"] },
  { note: "mixed case: Title-case base, ALL-CAPS _ERR suffix", labels: ["Voltage", "VOLTAGE_ERR"] },

  // ── Empty and single-column lists ──────────────────────────────────────────
  { note: "empty label list", labels: [] },
  { note: "single ordinary column, no error columns at all", labels: ["Temp"] },
  { note: "single error-like column alone -- nothing to bind to", labels: ["err"] },
];

function computeCases(): FixtureCase[] {
  return CASES.map(({ note, labels }) => ({
    note,
    labels,
    bindings: inferErrorBindingsFromLabels(labels).map((b) => ({
      channel: b.channel,
      target: b.target,
      axis: b.axis,
      side: b.side,
    })),
  }));
}

describe("error-label parity fixture (generated from inferErrorBindingsFromLabels)", () => {
  // Regeneration is opt-in (ERROR_LABEL_FIXTURE_WRITE=1) so a normal
  // `vitest run` never mutates a committed fixture as a side effect --
  // see this file's header comment for the regeneration command.
  it("regenerates the fixture from the TypeScript source of truth when ERROR_LABEL_FIXTURE_WRITE=1", () => {
    if (process.env.ERROR_LABEL_FIXTURE_WRITE !== "1") {
      return;
    }
    const payload = {
      _generated_from:
        "frontend/src/lib/errorLabelParityFixture.gen.test.ts, running the real " +
        "inferErrorBindingsFromLabels (errorRoles.ts). A diff against " +
        "src/quantized/io/error_inference.py's port means the two languages " +
        "disagree -- fix the disagreement, never regenerate this file to hide it.",
      cases: computeCases(),
    };
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  });

  it("the committed fixture matches what inferErrorBindingsFromLabels produces right now", () => {
    const data = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as { cases: FixtureCase[] };
    expect(data.cases).toEqual(computeCases());
  });

  it("fixture is nontrivial and covers both bound and unbound outcomes", () => {
    const data = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as { cases: FixtureCase[] };
    expect(data.cases.length).toBeGreaterThanOrEqual(CASES.length);
    expect(data.cases.some((c) => c.bindings.length > 0)).toBe(true);
    expect(data.cases.some((c) => c.bindings.length === 0)).toBe(true);
    // At least one asymmetric (+/-) case and one x-axis case, since those
    // are the two shapes most likely to silently regress unnoticed.
    expect(data.cases.some((c) => c.bindings.some((b) => b.side === "+"))).toBe(true);
    expect(data.cases.some((c) => c.bindings.some((b) => b.axis === "x"))).toBe(true);
  });
});
