// The Baseline workshop's methods: the one list. The `BaselineMethod` type, the
// panel's method select, the reopen seed and the preset adapter all derive from
// it, so a method added here is offered, reopened and accepted by presets with
// no second list to forget. Order is the panel's display order.

export const BASELINE_METHODS = [
  "als", "rollingball", "modpoly", "snip", "region", "anchor", "shirley", "xrdla", "linear", "quadratic", "poly",
] as const;

export type BaselineMethod = (typeof BASELINE_METHODS)[number];

/** The anchor method's interpolation choices: calc.backgrounds.anchor_baseline's dispatch keys. */
export const ANCHOR_INTERPOLATIONS = ["pchip", "linear", "spline"] as const;
