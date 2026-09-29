// P1.4 residuals 4 and 5 in the Graph Builder's encoding wells: what Color /
// Symbol / Label offer (a continuous column on Color = a gradient; the sheet's
// text columns under virtual option indices past the channels), how an
// assigned ref reads on its chip, and what an assignment stores.

import { describe, expect, it } from "vitest";

import { GRADIENT_DS } from "../../../test/gradientEncodingFixture";
import type { Dataset } from "../../../lib/types";
import { encodingChip, encodingOptions, encodingRef } from "./encodingWellModel";

const OPTIONS = [
  { index: 0, label: "Rxy" },
  { index: 1, label: "T" },
];

describe("encodingWellModel", () => {
  it("Color and Label offer every channel plus the text columns; Symbol only factors plus the text columns", () => {
    const o = encodingOptions(GRADIENT_DS, OPTIONS);
    const text = [
      { index: 2, label: "C (text)" },
      { index: 3, label: "D (text)" },
    ];
    expect(o.color).toEqual([...OPTIONS, ...text]);
    expect(o.label).toEqual([...OPTIONS, ...text]);
    expect(o.symbol).toEqual(text); // Rxy and T read continuous
    expect(encodingOptions(null, OPTIONS)).toEqual({ color: [], symbol: [], label: [] });
  });

  it("a sampled preview offers no text column (its text cells describe other rows)", () => {
    const sampled: Dataset = { ...GRADIENT_DS, pending: { previewSampled: true } as Dataset["pending"] };
    expect(encodingOptions(sampled, OPTIONS).label).toEqual(OPTIONS);
  });

  it("stores a text option BY NAME, never by its virtual index", () => {
    expect(encodingRef(GRADIENT_DS, "symbol", 2)).toEqual({ datasetId: "grad", channel: -1, text: "C" });
    expect(encodingRef(GRADIENT_DS, "label", 3)).toEqual({ datasetId: "grad", channel: -1, text: "D" });
    expect(encodingRef(GRADIENT_DS, "color", 1)).toEqual({ datasetId: "grad", channel: 1 }); // a gradient
    expect(encodingRef(GRADIENT_DS, "symbol", 1)).toMatch(/^Symbol needs a categorical column/);
    expect(encodingRef(GRADIENT_DS, "label", 9)).toMatch(/no longer in this sheet/);
  });

  it("each chip says how its pick is read", () => {
    expect(encodingChip(GRADIENT_DS, "color", { datasetId: "grad", channel: 1 })).toEqual({ channel: 1, label: "T (gradient)" });
    expect(encodingChip(GRADIENT_DS, "symbol", { datasetId: "grad", channel: 1 })).toEqual({
      channel: 1,
      label: "T (not categorical: ignored)",
    });
    expect(encodingChip(GRADIENT_DS, "label", { datasetId: "grad", channel: 1 })).toEqual({ channel: 1, label: "T" });
    expect(encodingChip(GRADIENT_DS, "symbol", { datasetId: "grad", channel: -1, text: "D" })).toEqual({
      channel: 3,
      label: "D (text)",
    });
    expect(encodingChip(GRADIENT_DS, "label", { datasetId: "grad", channel: -1, text: "Z" })).toEqual({
      channel: -1,
      label: "Z (text column missing: ignored)",
    });
  });
});
