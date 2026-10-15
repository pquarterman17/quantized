import { describe, expect, it } from "vitest";

import { sanitizeRefLines } from "./plotview";
import { sanitizeFigureOverrides } from "./figureOverridesSanitize";

const stick = {
  intensity: 0.75, baseline: 0.04, height: 0.2, color: "#D97706",
  visible: true, showLabel: false,
};

describe("sanitizeRefLines reference sticks", () => {
  it("retains a bounded, valid persisted stick and its provenance", () => {
    expect(sanitizeRefLines([{ id: "r", axis: "x", value: 28.44, label: "(111)", stick }])).toEqual([
      { id: "r", axis: "x", value: 28.44, label: "(111)", stick },
    ]);
  });

  it("drops an invalid nested stick rather than misrendering it as a full-height line", () => {
    expect(sanitizeRefLines([{ id: "r", axis: "x", value: 28.44, stick: { ...stick, height: 2 } }])).toEqual([]);
  });

  it("never accepts a reference stick on a y line", () => {
    expect(sanitizeRefLines([{ id: "r", axis: "y", value: 2, stick }])).toEqual([]);
  });
});

describe("publication reference-stick sanitizer", () => {
  it("retains only renderer-safe wire fields", () => {
    expect(sanitizeFigureOverrides({ ref_lines: [{
      axis: "x", value: 28.44, label: "(111)", ignored: "no",
      stick: { intensity: 1, baseline: 0.03, height: 0.18, color: "#d97706", visible: true, show_label: true, ignored: "no" },
    }] })).toEqual({ ref_lines: [{
      axis: "x", value: 28.44, label: "(111)",
      stick: { intensity: 1, baseline: 0.03, height: 0.18, color: "#d97706", visible: true, show_label: true },
    }] });
  });

  it("drops a malformed stick instead of exporting it as an ordinary line", () => {
    expect(sanitizeFigureOverrides({ ref_lines: [{
      axis: "x", value: 28.44, stick: { intensity: 2, baseline: 0, height: 1, color: "red", visible: true, show_label: true },
    }] })).toBeNull();
  });
});
