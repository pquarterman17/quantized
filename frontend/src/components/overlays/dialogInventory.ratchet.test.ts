// Dialog-basics RATCHET: a new dialog cannot land without the basics, and
// cannot land unaudited.
//
// Every source file that renders a dialog surface (`role="dialog"`, a
// `qz-overlay-backdrop`, or the `qz-dialog` frame) must
//   1. carry role="dialog" (or alertdialog),
//   2. be named: aria-labelledby (aria-label only when it has no heading),
//   3. get the focus contract from the shared hooks — `useDialogFocus`, or
//      `useFocusTrap` plus its own restore — unless listed below with a reason,
//   4. be rendered AND audited (`auditDialog` / `staticDialogIssues` from
//      `test/dialogA11y.ts`) in the same test — importing it next to the
//      helper does not count. The audit is what checks focus-in, the Tab
//      trap, Escape, restore, field labels, error links and disabled-button
//      reasons.

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

/** Component names the render-level audit actually renders: a test file
 *  credits `X` only when ONE `it`/`test` block both renders `<X` and calls
 *  `auditDialog(` / `staticDialogIssues(` — directly, or through a local
 *  function (a `Host` wrapper, an `openWith` helper) the block uses. Importing
 *  `X` next to the helper is not enough: a block that renders it and never
 *  audits it, or audits something else, credits nothing. */
function auditedIn(files: Record<string, string>): Set<string> {
  const names = new Set<string>();
  for (const [p, src] of Object.entries(files)) {
    if (!/\.test\.tsx$/.test(p) || !/from "[./]*test\/dialogA11y"/.test(src)) continue;
    const code = stripComments(src);
    const locals = localFunctions(code);
    for (const block of testBlocks(code)) {
      const text = expand(block, locals);
      if (!/\b(?:auditDialog|staticDialogIssues)\(/.test(text)) continue;
      for (const m of text.matchAll(/<([A-Z]\w*)[\s/>]/g)) names.add(m[1]);
    }
  }
  return names;
}

/** Comments blanked, so prose that names a component credits nothing. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");
}

/** Index just past the bracket that closes the one at `open`, skipping
 *  string and template literals. */
function closeOf(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === "\\") i++;
    } else if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

/** The full text of every `it(...)` / `test(...)` call. */
function testBlocks(src: string): string[] {
  const blocks: string[] = [];
  for (const m of src.matchAll(/(?:^|[^\w.])(?:it|test)(?:\.\w+)?\(/g)) {
    const open = m.index + m[0].length - 1;
    blocks.push(src.slice(open, closeOf(src, open)));
  }
  return blocks;
}

/** Bodies of the file's named functions (`function F(` and `const F = (`). */
function localFunctions(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/(?:function\s+(\w+)\s*(?:<[^>]*>)?\(|const\s+(\w+)\s*=\s*(?:async\s*)?\()/g)) {
    const start = m.index + m[0].length - 1;
    const params = closeOf(src, start);
    const body = src.slice(params).search(/[{(]/);
    if (body < 0) continue;
    const at = params + body;
    out.set(m[1] ?? m[2], src.slice(m.index, closeOf(src, at)));
  }
  return out;
}

/** `block` plus the bodies of the local functions it reaches, transitively. */
function expand(block: string, locals: Map<string, string>): string {
  const seen = new Set<string>();
  let text = block;
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, body] of locals) {
      if (seen.has(name) || !new RegExp(`(?:<|\\b)${name}\\b`).test(text)) continue;
      seen.add(name);
      text += "\n" + body;
      grew = true;
    }
  }
  return text;
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

  it("credits a dialog only where a test both renders and audits it (scanner sanity)", () => {
    const head = `import { auditDialog, staticDialogIssues } from "../../test/dialogA11y";\nimport Foo from "./Foo";\n`;
    const credited = (body: string) => [...auditedIn({ "x/a.test.tsx": head + body })];
    // Imported next to the helper, never rendered or audited: not audited.
    expect(credited(`it("x", () => { expect(1).toBe(1); });`)).toEqual([]);
    // Rendered, but the audit runs in a different test: not audited.
    expect(
      credited(`it("a", () => { render(<Foo />); });\nit("b", async () => { await auditDialog(d, o); });`),
    ).toEqual([]);
    // Named only in a comment inside an audited test: not audited.
    expect(credited(`it("a", async () => {\n  // <Foo /> used to live here\n  await auditDialog(d, o);\n});`)).toEqual([]);
    // Rendered and audited in one test: audited.
    expect(credited(`it("a", async () => { render(<Foo />); expect(await auditDialog(d, o)).toEqual([]); });`)).toContain("Foo");
    expect(credited(`test("a", () => { render(<Foo open />); staticDialogIssues(el); });`)).toContain("Foo");
    // Through a local wrapper the audited test renders.
    expect(
      credited(`function Host() { return <Foo />; }\nit("a", async () => { render(<Host />); await auditDialog(d, o); });`),
    ).toContain("Foo");
  });

  it("every dialog is rendered through the dialog-basics audit", () => {
    const names = auditedIn(sources);
    const missing = surfaces()
      .map(([p]) => base(p).replace(/\.tsx$/, "").replace(/Body$/, ""))
      .filter((name) => !names.has(name));
    expect(missing, "add it to dialogInventory*.a11y.test.tsx (auditDialog)").toEqual([]);
  });
});
