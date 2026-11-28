// The help text for the base and top (plateau) levels a rise or fall time is
// measured between. One wording for the gadget chip and the Curve measurements
// panel; the method is the calc's (`calc/step_levels.py`).

/** The rise-time percentages as the readout states them ("10–90 %"). */
export const pctRange = (lowFraction: number, highFraction: number): string =>
  `${Math.round(lowFraction * 1000) / 10}–${Math.round(highFraction * 1000) / 10} %`;

/** How the base and top levels are found, and when no time is reported. */
export const STATE_LEVEL_HELP =
  "Base and top levels are the IEEE Std 181-2011 histogram state levels (section 5.2): the samples are binned " +
  "(100 bins between the lowest and highest Y), and the fullest bin in the lower half is the base, the fullest in the " +
  "upper half is the top (each taken as the median of the samples in that bin). The rise time is the X distance between " +
  "the crossings of base + 10 % and base + 90 % of (top - base), or 20 % and 80 % when chosen. A trace with no clear " +
  "two-level shape (a ramp, a pure exponential, an oscillation: fewer than 25 % of the samples within 10 % of the step " +
  "height of a level) is refused with a reason instead of a guess; type the level yourself to measure it anyway.";
