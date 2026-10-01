// Dialog-basics RATCHET: a new dialog cannot land without the basics, and
// cannot land unaudited.
//
// Every source file that renders a dialog surface (`role="dialog"`, a
// `qz-overlay-backdrop`, or the `qz-dialog` frame) must
//   1. carry role="dialog" (or alertdialog),
//   2. be named: aria-labelledby (aria-label only when it has no heading),
//   3. get the focus contract from the shared hooks — `useDialogFocus`, or
//      `useFocusTrap` plus its own restore — unless listed below with a reason,
//   4. be rendered through the render-level audit (`test/dialogA11y.ts`) by
//      some test file, which is what checks focus-in, the Tab trap, Escape,
//      restore, field labels, error links and disabled-button reasons.

import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Dialog surfaces that legitimately skip the shared focus hooks. */
const OWN_FOCUS_CONTRACT: Record<string, string> = {
  // Eager: must not import the lazy hook seam; traps Tab and restores itself.
  "CommandPalette.tsx": "eager palette with its own Tab trap and opener restore",
  // Non-modal: takes focus and restores it (useOpenerRestore), traps nothing.
  "ToolWindow.tsx": "non-modal workshop host",
};

const SURFACE = /role="(?:alert)?dialog"|qz-overlay-backdrop|"qzk-glass qz-dialog/;

function base(path: string): string {
  return path.split("/").pop() ?? path;
}

/** The opening tags carrying role="dialog": from the `<` before the role to
 *  the first `>` that is not an arrow function's. */
function dialogTags(src: string): string[] {
  const tags: string[] = [];
  for (const m of src.matchAll(/role="(?:alert)?dialog"/g)) {
    const start = src.lastIndexOf("<", m.index);
    const rest = src.slice(m.index);
    const end = rest.search(/[^=]>/);
    tags.push(src.slice(start, m.index + (end < 0 ? rest.length : end + 2)));
  }
  return tags;
}

function surfaces(): [string, string][] {
  return Object.entries(sources).filter(
    ([p, src]) => !/\.test\.tsx$/.test(p) && !p.includes("/test/") && SURFACE.test(src.replace(/\/\/.*$/gm, "")),
  );
}

/** Component names the render-level audit actually renders. */
function audited(): Set<string> {
  const names = new Set<string>();
  for (const [p, src] of Object.entries(sources)) {
    if (!/\.test\.tsx$/.test(p) || !/from "[./]*test\/dialogA11y"/.test(src)) continue;
    for (const m of src.matchAll(/^import (\w+)(?:,|\s+from)/gm)) names.add(m[1]);
  }
  return names;
}

describe("dialog-basics ratchet", () => {
  it("finds the known dialog inventory (scanner sanity)", () => {
    const found = surfaces().map(([p]) => base(p));
    for (const known of ["ParamDialogBody.tsx", "ConfirmDialogBody.tsx", "PreferencesDialog.tsx", "ToolWindow.tsx"]) {
      expect(found).toContain(known);
    }
  });

  it("every dialog has role, a name, and the shared focus contract", () => {
    const gaps: string[] = [];
    for (const [p, src] of surfaces()) {
      const file = base(p);
      const tags = dialogTags(src);
      if (tags.length === 0) gaps.push(`${file}: no role="dialog"`);
      for (const tag of tags) {
        if (!/aria-labelledby=/.test(tag) && !(/aria-label=/.test(tag) && !/<h[1-6]/.test(src))) {
          gaps.push(`${file}: not named by its title (aria-labelledby)`);
        }
      }
      const hooks = /\buseDialogFocus\(|\buseFocusTrap\(/.test(src);
      if (!hooks && !(file in OWN_FOCUS_CONTRACT)) gaps.push(`${file}: no useDialogFocus / useFocusTrap`);
    }
    expect(gaps, "give the new dialog the basics (see useDialogFocus.ts)").toEqual([]);
  });

  it("every dialog is rendered through the dialog-basics audit", () => {
    const names = audited();
    const missing = surfaces()
      .map(([p]) => base(p).replace(/\.tsx$/, "").replace(/Body$/, ""))
      .filter((name) => !names.has(name));
    expect(missing, "add it to dialogInventory*.a11y.test.tsx (auditDialog)").toEqual([]);
  });
});
