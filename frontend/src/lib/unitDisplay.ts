// How a unit string is SPELLED in an axis title or legend: "cm^-1" -> "cm⁻¹",
// "emu/cm3" -> "emu/cm³", "Ang^-1" -> "Å⁻¹". Display only — the dataset keeps
// the unit its file wrote. The export leg is `quantized/unit_display.py`
// (its docstring states the rules; a bare "A" stays, it may be the ampere);
// both read the cases in `tests/fixtures/wire/unit_display.json`. Kept terse:
// it rides the eager plot path.

const sup = (s: string): string => s.replace(/./g, (c) => "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻"["0123456789+-".indexOf(c)]);

/** The axis-title spelling of `unit`. A mathtext unit (`$…$`) is returned as-is. */
export function displayUnit(unit: string): string {
  return unit.includes("$")
    ? unit
    : unit
        .replace(/\bang(?:stroms?)?\b/gi, "Å")
        .replace(/\^\{?([+-]?\d+)\}?(?![\d.])/g, (_m, e: string) => sup(e))
        .replace(/(?<![\w.])([a-zµÅ]+)(-?[1-9])(?![\w.^])/gi, (_m, r: string, e: string) => r + sup(e));
}

/** `"label (unit)"` with the unit in its display spelling, else `label`. */
export function withUnit(label: string, unit: string | undefined): string {
  return unit ? `${label} (${displayUnit(unit)})` : label;
}
