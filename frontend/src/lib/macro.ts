// Macro recorder — a log of reproducible analysis steps and a serializer that
// turns it into a runnable-looking script. Pure (no store / React imports) so
// the formatting + serialization unit-test without a DOM. The store owns the
// live log + recording flag; call sites push steps through `recordMacro`.

/** One recorded action: a human `label` for the panel list and a `code` line
 *  (the reproducible `qz.*(...)` form) emitted into the exported script. */
export interface MacroStep {
  id: string;
  label: string;
  code: string;
}

let _seq = 0;

/** Build a step with a unique id (for React keys + targeted removal). */
export function macroStep(label: string, code: string): MacroStep {
  return { id: `mac-${++_seq}`, label, code };
}

/** Render a value as a script literal: strings get JSON quoting, arrays/objects
 *  render compactly (undefined fields dropped), null/undefined → `null`. Used to
 *  build the `code` lines at the recording call sites. */
export function lit(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(lit).join(", ")}]`;
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${lit(v)}`);
    return `{ ${parts.join(", ")} }`;
  }
  return String(value);
}

/** Render the recorded steps as a runnable-looking script with a header. The
 *  output is deterministic (no timestamps) so it diffs cleanly and tests stably. */
export function macroToScript(steps: MacroStep[]): string {
  const lines = [
    "// Quantized macro — reproducible analysis script",
    `// ${steps.length} step${steps.length === 1 ? "" : "s"}`,
    "",
  ];
  if (steps.length === 0) lines.push("// (no steps recorded)");
  else for (const s of steps) lines.push(s.code);
  return lines.join("\n") + "\n";
}
