// Statistical tests workshop: the option lists of the settings that are chosen
// from a short list. The workshop's inputs (components/workshops/statstests)
// render their selects from these, and the preset adapter validates against the
// same lists, so an option added here is offered and accepted with no second
// copy to forget. Type-only imports: this module has no runtime dependencies.

import type { PosthocMethod, VarianceMethod, MoreParams } from "./statsTestsMore";
import type { LifeCiMethod, LifePlotting } from "./statsTestsLife";
import type { SpcParams } from "./statsTestsSpc";
import type { Alternative, TestParams } from "./statsTests";

/** A value and the label its select shows. */
export type OptionPair<T> = readonly [value: T, label: string];

export const ALTERNATIVES: readonly Alternative[] = ["two-sided", "less", "greater"];

export const SS_TYPE_OPTIONS: readonly OptionPair<TestParams["ssType"]>[] = [[3, "Type III"], [2, "Type II"]];

export const ADJUST_METHOD_OPTIONS: readonly OptionPair<TestParams["adjustMethod"]>[] = [
  ["holm", "Holm"], ["bonferroni", "Bonferroni"], ["bh", "Benjamini-Hochberg (FDR)"],
];

export const CRITERION_OPTIONS: readonly OptionPair<TestParams["criterion"]>[] = [["aic", "AIC"], ["bic", "BIC"]];

export const DIRECTION_OPTIONS: readonly OptionPair<TestParams["direction"]>[] = [
  ["forward", "forward"], ["backward", "backward"], ["both", "both"],
];

export const POWER_KIND_OPTIONS: readonly OptionPair<TestParams["kind"]>[] = [
  ["two-sample", "two-sample"], ["paired", "paired"], ["one-sample", "one-sample"],
];

export const TAILS_OPTIONS: readonly OptionPair<TestParams["tails"]>[] = [[2, "two-sided"], [1, "one-sided"]];

export const GOF_EXPECTED_OPTIONS: readonly OptionPair<TestParams["gofExpected"]>[] = [
  ["uniform", "uniform (equal counts)"], ["column", "from a column"],
];

export const POSTHOC_OPTIONS: readonly OptionPair<PosthocMethod>[] = [
  ["games-howell", "Games-Howell (unequal variances)"], ["tukey", "Tukey HSD"],
  ["scheffe", "Scheffé"], ["lsd", "Fisher LSD (no correction)"], ["dunn-sidak", "Dunn-Šidák (rank-based, nonparametric)"],
  ["steel-dwass", "Steel-Dwass (rank-based, nonparametric Tukey analogue)"],
];

export const VARIANCE_OPTIONS: readonly OptionPair<VarianceMethod>[] = [
  ["bartlett", "Bartlett (normal data)"], ["levene", "Levene (mean)"],
  ["brown-forsythe", "Brown-Forsythe (median)"], ["f-test", "F test (2 groups)"],
];

export const TOST_DESIGN_OPTIONS: readonly OptionPair<MoreParams["tostDesign"]>[] = [
  ["welch", "Welch (unequal variances)"], ["pooled", "Pooled variance"], ["paired", "Paired rows"],
];

export const POISSON_SAMPLES_OPTIONS: readonly OptionPair<MoreParams["poissonSamples"]>[] = [
  ["one", "one sample vs a rate"], ["two", "two samples (rate ratio)"],
];

export const TI_SIDES_OPTIONS: readonly OptionPair<MoreParams["tiSides"]>[] = [
  ["two", "two-sided"], ["upper", "upper bound only"], ["lower", "lower bound only"],
];

export const PROP_METHOD_OPTIONS: readonly OptionPair<MoreParams["propMethod"]>[] = [
  ["exact", "exact binomial"], ["normal", "normal approximation"],
];

export const LIFE_CI_OPTIONS: readonly OptionPair<LifeCiMethod>[] = [
  ["wald", "Wald (default)"], ["likelihood-ratio", "Likelihood ratio (profile)"],
];

export const LIFE_PLOTTING_OPTIONS: readonly OptionPair<LifePlotting>[] = [
  ["median-rank", "median ranks (Johnson / Benard)"], ["kaplan-meier", "Kaplan-Meier midpoints"],
];

export const SPC_SUBGROUP_MODE_OPTIONS: readonly OptionPair<SpcParams["subgroupMode"]>[] = [
  ["size", "fixed size (consecutive rows)"], ["column", "a subgroup column"],
];

export const SPC_SIGMA_OPTIONS: readonly OptionPair<SpcParams["sigmaMethod"]>[] = [
  ["range", "R-bar / d2"], ["sd", "S-bar / c4"],
];

export const SPC_SIZE_MODE_OPTIONS: readonly OptionPair<SpcParams["sizeMode"]>[] = [
  ["column", "from a column"], ["constant", "one constant"],
];

/** The values of a list. */
export const optionValues = <T>(pairs: readonly OptionPair<T>[]): T[] => pairs.map(([value]) => value);

/** A list as the `{ value, label }` objects a Select takes (string values). */
export const selectOptions = <T extends string | number>(pairs: readonly OptionPair<T>[]): { value: string; label: string }[] =>
  pairs.map(([value, label]) => ({ value: String(value), label }));
