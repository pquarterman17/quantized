// Peak Analyzer step 1: every field has an accessible name. The numeric fields
// sat beside a bare <label> (no htmlFor) or carried only a placeholder, so a
// screen reader announced "edit text" for the range, lambda, p, radius, order
// and iteration fields.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_RECIPE, type PeakRecipe } from "../../../lib/peakwizard";
import { StepRangeBaseline } from "./StepRangeBaseline";
import type { PeakWizardState } from "./usePeakWizard";

function wizard(baseline: Partial<PeakRecipe["baseline"]>): PeakWizardState {
  return {
    recipe: { ...DEFAULT_RECIPE, baseline: { ...DEFAULT_RECIPE.baseline, ...baseline } },
    patchRecipe: vi.fn(),
    baselineBusy: false,
    baselineError: null,
  } as unknown as PeakWizardState;
}

describe("StepRangeBaseline — accessible names", () => {
  it("names the X range fields", () => {
    render(<StepRangeBaseline w={wizard({ method: "none" })} />);
    expect(screen.getByRole("textbox", { name: "X range from" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "X range to" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Peak baseline method" })).toBeInTheDocument();
  });

  it.each([
    ["als", ["λ", "p"]],
    ["rollingball", ["radius (pts)"]],
    ["modpoly", ["order"]],
    ["poly", ["order"]],
    ["shirley", ["max iterations"]],
  ] as const)("names the %s parameters", (method, names) => {
    render(<StepRangeBaseline w={wizard({ method })} />);
    for (const name of names) expect(screen.getByRole("textbox", { name })).toBeInTheDocument();
  });

  it("names the anchor-point fields", () => {
    render(<StepRangeBaseline w={wizard({ method: "anchor" })} />);
    expect(screen.getByRole("textbox", { name: "Baseline anchor X positions" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Anchor interpolation" })).toBeInTheDocument();
  });
});
