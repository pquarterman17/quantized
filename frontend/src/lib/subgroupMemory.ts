// "Vary dash & marker" and its subgroup size (plan item 24): the preference is one value, `false` | `true` | N
// (`store/prefs.ts`), so turning the switch off used to lose N and turning it back on came back with every series
// in one run. The size is remembered for the session here and handed back when the switch goes on again. A size
// the user clears (blank = every series) is forgotten. Both toggles (the Appearance menu and Preferences) use it.

let last = 0;

/** The `autoSeriesStyles` value after the switch is turned `on` or off, with `current` the value it had. */
export function varyToggled(current: boolean | number, on: boolean): boolean | number {
  if (!on) {
    if (typeof current === "number") last = current;
    return false;
  }
  return last >= 2 ? last : true;
}

/** A size the user typed (a whole number >= 2), or blank (`null`: every series, forgotten). */
export function rememberSubgroup(n: number | null): void {
  last = n ?? 0;
}
