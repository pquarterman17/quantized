// The corpus in errorRoles.test.ts (and the acceptance sweep in the PR
// description) proves the concrete bugs are fixed. It does NOT prove the
// structural claim plans/ERROR_LABEL_CLASSIFIER_PLAN.md actually makes:
//
//   "adding a token changes only the generator; ranking and selection are
//    independent of the token list."
//
// A before/after diff over the real ERROR_TOKENS table can't test this --
// there IS no "before" for a token already in the table. So this file
// injects an ADVERSARIAL token that never existed in the real table and
// checks two things: (1) every label uninvolved with that token classifies
// identically with and without it, and (2) the one label it legitimately
// touches changes in exactly the expected way. It also pins absolute
// top-ranked-candidate expectations for the two labels with genuinely
// competing candidates (`Ierr`, `MStdErr`), because a consistently-wrong
// ranking produces the SAME wrong answer on both sides of an injection and
// a diff alone would never catch it.

import { describe, expect, it } from "vitest";

import { ERROR_TOKENS, flatNorm, generateCandidates } from "./errorLabelCandidates";
import { classifyErrorLabel, classifyErrorLabelInLabels, rankCandidates } from "./errorLabelClassify";
import { inferErrorBindingsFromLabels } from "./errorRoles";

// "ose" is a real substring at the EDGE of exactly one ordinary base name in
// this corpus ("dose".endsWith("ose")) and nowhere else. In particular
// "noise" ends in "ise", NOT "ose" -- it must stay in the strict, unaffected
// half, not the legitimate-exception half.
const INJECTED_TOKEN = "ose";
const INJECTED_TOKENS = [...ERROR_TOKENS, INJECTED_TOKEN];

// A broad corpus of ordinary, non-error column names -- the never-classify
// list, the domain-corpus base names, and a handful of unrelated scientific
// labels thrown in for width. None of these end with "ose" except "Dose".
const ORDINARY_LABELS = [
  "Kerr", "Phase", "Noise", "Sensor", "Response", "Dose", "Pulse", "Base",
  "Use", "Series", "Second", "Depth", "Delay", "Density", "Set",
  "Temp (K)", "Intensity", "2theta", "Si", "O", "Depth (nm)",
  "NbAu-1", "NbAu-2", "Field", "Moment", "R", "M", "X", "Signal", "Time",
  "Voltage", "Current", "Frequency", "Amplitude", "Count", "Rate",
  "Length", "Width", "Height", "Mass", "Volume", "Pressure", "Angle",
];

describe("token-list independence (structural invariant)", () => {
  it("classifies every label ending in \"ose\" identically to how it ONLY affects that label", () => {
    const changed: string[] = [];
    for (const label of ORDINARY_LABELS) {
      const before = classifyErrorLabel(label, ERROR_TOKENS);
      const after = classifyErrorLabel(label, INJECTED_TOKENS);
      if (JSON.stringify(before) !== JSON.stringify(after)) changed.push(label);
    }
    // The only label whose flat form ends with "ose" is "Dose" -- the one
    // legitimate exception the plan calls out by name.
    expect(changed).toEqual(["Dose"]);
  });

  it("the legitimate exception actually changes in the expected direction", () => {
    // "Dose" is one whole segment ("dose") -- the bare-"d" delta convention
    // needs "d" to be its OWN leading segment (as in "dR"), which "Dose"
    // never has, so it carries zero candidates by default, same as
    // "Depth"/"Density"/"Delay". Injecting "ose" as a token adds exactly
    // one candidate this label didn't have: a glued match at the edge of
    // its one segment (token "ose", base "d") -- null flips to non-null.
    expect(classifyErrorLabel("Dose", ERROR_TOKENS)).toBeNull();
    expect(classifyErrorLabel("Dose", INJECTED_TOKENS)?.base).toBe("d");
  });

  it("\"Noise\" (ends in \"ise\", not \"ose\") stays in the strict, unaffected half", () => {
    expect(flatNorm("Noise").endsWith("ose")).toBe(false);
    expect(classifyErrorLabel("Noise", ERROR_TOKENS)).toBeNull();
    expect(classifyErrorLabel("Noise", INJECTED_TOKENS)).toBeNull();
  });

  it("the never-classify corpus is untouched by the injected token, with a sibling column present", () => {
    const NEVER = [
      "Kerr", "Phase", "Noise", "Sensor", "Response", "Pulse", "Base",
      "Use", "Series", "Second", "Depth", "Delay", "Density", "Set",
    ]; // "Dose" deliberately excluded -- it is the legitimate exception.
    for (const name of NEVER) {
      const before = inferErrorBindingsFromLabels(["T", "R", name]);
      // inferErrorBindingsFromLabels always uses the real, default token
      // table (production behaviour is unaffected by this test file) -- the
      // injection is only exercised through the classifier functions
      // directly, which DO accept an explicit token list.
      expect(before, name).toEqual([]);
      const beforeInjected = classifyErrorLabelInLabels(["T", "R", name], 2, ERROR_TOKENS);
      const afterInjected = classifyErrorLabelInLabels(["T", "R", name], 2, INJECTED_TOKENS);
      expect(JSON.stringify(beforeInjected), name).toBe(JSON.stringify(afterInjected));
    }
  });

  it("the X_err -> X acceptance corpus is untouched by the injected token", () => {
    const XERR = ["Phase", "Base", "Noise", "Sensor", "Response", "Set", "Pulse", "Use"];
    // "Dose" excluded for the same reason as above.
    for (const name of XERR) {
      const labels = ["Time", name, `${name}_err`];
      const before = classifyErrorLabelInLabels(labels, 2, ERROR_TOKENS);
      const after = classifyErrorLabelInLabels(labels, 2, INJECTED_TOKENS);
      expect(JSON.stringify(before), name).toBe(JSON.stringify(after));
      expect(before?.base, name).toBe(flatNorm(name));
    }
  });

  it("the generator is parameterizable, but production callers see the real table by default", () => {
    // Default-parameter behaviour: calling with no explicit token list must
    // match calling with ERROR_TOKENS explicitly, for both the generator and
    // every layer built on it.
    for (const label of [...ORDINARY_LABELS, "Ierr", "MStdErr", "M_std_err", "dR"]) {
      expect(generateCandidates(label)).toEqual(generateCandidates(label, ERROR_TOKENS));
      expect(classifyErrorLabel(label)).toEqual(classifyErrorLabel(label, ERROR_TOKENS));
    }
  });
});

describe("absolute ranking pins (a consistently-wrong ranking survives a before/after diff)", () => {
  it("Ierr's top-ranked candidate is the confirmed quantity-prefix reading, base \"i\"", () => {
    const ranked = rankCandidates(generateCandidates("Ierr"));
    expect(ranked[0]).toMatchObject({ token: "err", base: "i", confirmed: true });
  });

  it("MStdErr's top-ranked candidate is the longer token \"stderr\", base \"m\" -- not \"err\"/\"mstd\"", () => {
    const ranked = rankCandidates(generateCandidates("MStdErr"));
    expect(ranked[0]).toMatchObject({ token: "stderr", base: "m", confirmed: true });
  });

  it("M_std_err (explicit separators) ranks identically to the camelCase spelling", () => {
    const ranked = rankCandidates(generateCandidates("M_std_err"));
    expect(ranked[0]).toMatchObject({ token: "stderr", base: "m", confirmed: true });
  });

  it("both pins resolve through full selection to their documented targets", () => {
    expect(classifyErrorLabelInLabels(["2theta", "Intensity", "Ierr"], 2)?.base).toBe("i");
    expect(classifyErrorLabelInLabels(["M", "MStdErr"], 1)?.base).toBe("m");
  });

  // The four pins above exercise "confirmed beats provisional" (Ierr, against
  // its own duplicate glued reading) and "longer token wins" (MStdErr,
  // M_std_err) -- but ERROR_TOKENS already happens to list "stderr" before
  // "err", so a ranking that used TABLE POSITION instead of actual length
  // would get MStdErr right BY ACCIDENT (see the discrimination experiment
  // below). The four pins in this block each isolate one ranking key on a
  // label where the token table's ORDER does not already imply the right
  // answer, so a positional stand-in cannot pass by coincidence.

  it('confirmed beats provisional even when the provisional\'s token is longer -- "Mstd_err"', () => {
    // "mstd" (one segment -- lowercase, no internal capital) does not split
    // the way "M_std"/"MStd" does, so the run rule only ever peels "err" off
    // the end, CONFIRMED. The full flat string "mstderr" also happens to end
    // in the token "stderr" (crossing what were "mstd"+"err"), which is a
    // strictly LONGER token -- but only reachable by an unaligned glued
    // match, PROVISIONAL. A ranking that checked token length before
    // confirmed-status would pick the provisional "stderr" reading; the
    // correct top pick is the shorter, confirmed one.
    const ranked = rankCandidates(generateCandidates("Mstd_err"));
    expect(ranked[0]).toMatchObject({ token: "err", base: "mstd", confirmed: true });
  });

  it('longer token wins even when the table lists it AFTER the shorter one -- "Sdev_X_err"', () => {
    // ERROR_TOKENS order is [stderr, sigma, error, err, unc, sdev, std, sd,
    // se] -- "err" (index 3) sits BEFORE "sdev" (index 5), the opposite of
    // their length order. Both "sdev" (leading segment) and "err" (trailing
    // segment) are confirmed, whole-segment matches here, so this is a pure
    // rule-2 decision: the correct top pick is "sdev" (length 4), not "err"
    // (length 3) -- a ranking keyed on table position instead of length
    // would get this backwards.
    const ranked = rankCandidates(generateCandidates("Sdev_X_err"));
    expect(ranked[0]).toMatchObject({ token: "sdev", base: "xerr", confirmed: true });
  });

  it('longer base wins between two same-token confirmed candidates -- "X_err"', () => {
    // "X_err" generates TWO confirmed candidates with the identical token
    // "err": the ordinary run-rule reading (base "x", from the segment
    // boundary at the underscore) and the explicit-axis-prefix reading
    // (base "", by that rule's own definition -- the axis character is
    // consumed, not kept). Confirmed-status and token length both tie, so
    // this is a pure rule-3 decision, and it is also the more useful answer:
    // preferring the longer ("x") base reads this as "column X's error", not
    // a bare x-axis marker with no name at all.
    const ranked = rankCandidates(generateCandidates("X_err"));
    expect(ranked[0]).toMatchObject({ token: "err", base: "x", axis: null, confirmed: true });
  });

  it('the lexical tiebreak decides between two same-length confirmed candidates -- "Err_Mid_Unc"', () => {
    // Leading segment "err" and trailing segment "unc" are both confirmed,
    // both length 3 -- and because both readings consume the SAME total
    // three segments, their bases ("midunc" and "errmid") are also both
    // length 6, so rules 1-3 all tie. The final lexical tiebreak (comparing
    // the base strings) decides it: "errmid" < "midunc", so the "unc"
    // reading (base "errmid") wins.
    const ranked = rankCandidates(generateCandidates("Err_Mid_Unc"));
    expect(ranked[0]).toMatchObject({ token: "unc", base: "errmid", confirmed: true });
  });
});
