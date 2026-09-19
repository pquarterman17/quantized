// BUG-021 defect 3: deciding M(T) from M(H) from what the data DECLARES, and
// failing closed when it declares nothing usable.

import { describe, expect, it } from "vitest";

import { detectMagXKind } from "./magDataKind";

describe("detectMagXKind — the unit decides", () => {
  it.each(["Oe", "oe", " kOe ", "T", "mT", "G", "gauss", "A/m", "kA/m"])(
    "%s is a field",
    (unit) => {
      expect(detectMagXKind("", unit).kind).toBe("field");
    },
  );

  it.each(["K", "kelvin", "°C", "degC", "°F"])("%s is a temperature", (unit) => {
    expect(detectMagXKind("", unit).kind).toBe("temperature");
  });

  it("names the evidence so the panel can show it", () => {
    expect(detectMagXKind("Magnetic Field", "Oe").reason).toContain('"Oe"');
  });
});

describe("detectMagXKind — the label decides when the unit says nothing", () => {
  it.each(["Magnetic Field (Oe)", "field", "Applied H", "H field"])(
    "%s is a field",
    (label) => {
      expect(detectMagXKind(label, "").kind).toBe("field");
    },
  );

  it.each(["Temperature", "Temp (K)", "sample temperature", "sample T"])(
    "%s is a temperature",
    (label) => {
      expect(detectMagXKind(label, "").kind).toBe("temperature");
    },
  );
});

// `io/origin_project/opj.py`'s `_label_for` falls back to the bare Origin
// SHORT designation when the worksheet carried no Long Name — so reading
// `x_column_long` first (the earlier fix) does not on its own keep a bare
// letter out of the detector. A lone symbol is not evidence of a quantity.
describe("detectMagXKind — a LONE symbol never classifies on its own", () => {
  it.each(["B", "H", "T", "b", "h", "t", " H "])(
    "the bare label %s alone is unknown, not a guess",
    (label) => {
      const d = detectMagXKind(label, "");
      expect(d.kind).toBe("unknown");
    },
  );

  it("a recognisable UNIT still decides over a bare-letter label", () => {
    expect(detectMagXKind("H", "Oe").kind).toBe("field");
    expect(detectMagXKind("T", "K").kind).toBe("temperature");
    expect(detectMagXKind("B", "mT").kind).toBe("field");
  });

  it("a bare letter with an UNRECOGNISED unit still fails closed", () => {
    expect(detectMagXKind("B", "").kind).toBe("unknown");
    expect(detectMagXKind("T", "counts").kind).toBe("unknown");
  });

  it("the symbol still counts inside a longer label", () => {
    expect(detectMagXKind("Applied H", "").kind).toBe("field");
    expect(detectMagXKind("sample T", "").kind).toBe("temperature");
  });
});

describe("detectMagXKind — fails closed", () => {
  it("returns unknown for an unlabelled, unitless axis", () => {
    const d = detectMagXKind("", "");
    expect(d.kind).toBe("unknown");
    expect(d.reason).toContain("no label or unit");
  });

  it("returns unknown for an axis it does not recognise", () => {
    expect(detectMagXKind("Index", "counts").kind).toBe("unknown");
  });

  it("returns unknown — NOT a winner — when the label and unit DISAGREE", () => {
    // "T" is tesla as a unit but temperature as a label: a mislabelled column
    // must not silently pick one analysis over the other.
    const d = detectMagXKind("Temperature", "T");
    expect(d.kind).toBe("unknown");
    expect(d.reason).toContain("disagree");
  });

  it("does NOT consult the data's shape — a loop with no declared axis stays unknown", () => {
    // A ±15,000 non-monotonic sweep is suggestive, but guessing the analysis
    // from the data's shape is the bug being fixed, in a new costume.
    expect(detectMagXKind("", "").kind).toBe("unknown");
    expect(detectMagXKind("column 1", "").kind).toBe("unknown");
  });
});
