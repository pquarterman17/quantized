// The step builder and script renderer, split out of lib/macro.ts (bundle diet
// slice 32) and re-exported from it with `export *`: only the lazy pipeline and
// macro panels call them. `lit` and the step shape stay in lib/macro.ts.

import type { MacroStep } from "./macro";

let _seq = 0;

/** Build a step with a unique id (for React keys + targeted removal). */
export function macroStep(label: string, code: string): MacroStep {
  return { id: `mac-${++_seq}`, label, code };
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
