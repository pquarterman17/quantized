// Text-formatting help sheet (GOTO #11): documents the rich-text label
// micro-syntax shipped by GOTO #5 (lib/richtext) — the exact `$...$` subset
// the parser accepts, nothing more. Every worked example renders LIVE through
// the same RichText primitive the legend and label editors use, so this sheet
// cannot drift from the parser: if the subset changes, the previews change.
// ShortcutsDialog conventions: a read-only modal on the store
// `textFormatHelpOpen` flag; backdrop click / Esc / Close dismiss it.

import { useId, useRef } from "react";

import { Button, RichText } from "../primitives";
import { useApp } from "../../store/useApp";
import { useDialogFocus } from "./useDialogFocus";
import { useEscapeSurface } from "../../lib/escapeStack";

/** Worked examples: [what you type, note]. Rendered live via RichText. */
const EXAMPLES: [string, string][] = [
  ["$\\mu_0H$ (T)", "applied field axis"],
  ["Q ($\\AA^{-1}$)", "reciprocal angstroms"],
  ["$\\chi''$", "imaginary susceptibility"],
  ["$2\\theta$ (°)", "diffraction angle"],
  ["$M_{sat}$", "subscript group"],
  ["$10^{-6}$", "superscript exponent"],
  ["$\\mathrm{R}$ vs $R$", "upright vs math italic"],
  ["$T \\leq T_c$", "relation (≤ ≥ ≠ ≈ ∝)"],
  ["$\\mu_0H \\rightarrow \\infty$", "arrows and ∞"],
  ["$\\frac{M}{M_s}$", "fraction"],
  ["$\\sqrt{x^2+y^2}$", "square root"],
  ["$\\sqrt[3]{V}$", "nth root"],
  ["$\\sum_{i=1}^{n} x_i$", "sum (stacked limits)"],
  ["$\\int_0^\\infty f dx$", "integral (side limits)"],
];

/** Label-editor keyboard shortcuts (MAIN #17): [keys, what it does]. Wraps
 *  the current selection (or drops an empty token with the cursor inside
 *  the braces, same as a palette click, when nothing is selected). */
const SHORTCUTS: [string, string][] = [
  ["Ctrl / Cmd + I", "Wrap selection in italic — $\\mathit{...}$"],
  ["Ctrl + =", "Wrap selection in subscript — _{...}"],
  ["Ctrl + Shift + =", "Wrap selection in superscript — ^{...}"],
  ["Ctrl / Cmd + .", "Open the symbol palette"],
];

/** Syntax reference: [token(s), meaning]. Shown verbatim (mono), not parsed. */
const SYNTAX: [string, string][] = [
  ["$...$", "math region — all tokens below work only inside it"],
  ["_x   _{...}", "subscript (single char or group; nesting supported)"],
  ["^x   ^{...}", "superscript (single char or group; nesting supported)"],
  ["\\frac{num}{den}", "stacked fraction"],
  ["\\sqrt{...}   \\sqrt[n]{...}", "square / nth root"],
  ["\\sum_{..}^{..}   \\prod", "large operator, limits stacked over/under"],
  ["\\int_{..}^{..}   \\oint", "large operator, limits to the side"],
  [
    "\\alpha … \\omega",
    "lowercase Greek, italic (plus \\varepsilon \\vartheta \\varsigma \\varphi variants)",
  ],
  ["\\Gamma … \\Omega", "uppercase Greek, upright"],
  ["\\AA  \\circ  \\times  \\cdot  \\pm  \\mp  \\div  \\prime  \\,", "Å ∘ × ⋅ ± ∓ ÷ ′ and a thin space"],
  ["\\leq \\geq \\neq \\approx \\equiv \\sim \\propto \\ll \\gg", "relations ≤ ≥ ≠ ≈ ≡ ∼ ∝ ≪ ≫"],
  ["\\infty \\partial \\nabla \\perp \\parallel \\angle \\cdots \\ldots", "∞ ∂ ∇ ⊥ ∥ ∠ ⋯ …"],
  ["\\rightarrow (\\to) \\leftarrow \\leftrightarrow \\Rightarrow", "arrows → ← ↔ ⇒"],
  ["\\mathrm{...}  \\mathit{...}", "force upright / italic for a group"],
  ["a-z 0-9", "letters render italic, digits upright (mathtext convention)"],
  ["° Å µ × ± ⋅ ∘ ′ ″ − and Greek", "literal Unicode also accepted inside math"],
  ["\\$", "a literal dollar sign (outside math regions)"],
];

export default function TextFormatHelp() {
  const open = useApp((s) => s.textFormatHelpOpen);
  const setOpen = useApp((s) => s.setTextFormatHelpOpen);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // Esc closes even when focus isn't inside the dialog (ShortcutsDialog). R1
  // (P3.3): a `modal` surface in `lib/escapeStack.ts` — a true backdrop modal
  // outranks every other registry surface, and the registry is what orders two
  // of these against EACH OTHER, which window-capture could not.
  // FIXED 2026-09-19 (BUG-018, P3.3 round 9). Escape now goes through the
  // app's one ordered registry on its `modal` layer, so the innermost open
  // dialog closes and nothing below it acts on the same keystroke. The
  // per-dialog `window`-capture listener this replaces used
  // `stopPropagation()`, which does not stop a same-node, same-phase sibling,
  // so two open dialogs both closed on ONE Escape.
  useEscapeSurface(
    "modal",
    () => {
      setOpen(false);
      return true;
    },
    open,
  );

  // R1: focus-in, Tab trap, restore-to-opener. Read-only sheet, one real
  // control (Close) — the hook's default first-focusable landing is it.
  useDialogFocus(dialogRef, open);

  if (!open) return null;

  return (
    <div className="qz-overlay-backdrop" onMouseDown={() => setOpen(false)}>
      <div
        className="qzk-glass qz-dialog"
        style={{ maxWidth: 620, maxHeight: "80vh", overflowY: "auto" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Text formatting</h2>
        <p style={{ color: "var(--text-dim)", marginTop: 6 }}>
          Labels, titles, and legend names are plain text with optional{" "}
          <code>$...$</code> math regions in a strict subset of matplotlib
          mathtext. The same string renders identically on-screen and in
          vector export. Outside <code>$...$</code>, text (including Unicode
          like µ or Å) passes through literally.
        </p>

        <h3 style={{ marginTop: 14 }}>Examples</h3>
        <table className="qz-table" data-testid="tfh-examples">
          <thead>
            <tr>
              <th>you type</th>
              <th>you see</th>
              <th>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLES.map(([src, note]) => (
              <tr key={src}>
                <td style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{src}</td>
                <td>
                  <RichText text={src} />
                </td>
                <td style={{ color: "var(--text-faint)" }}>{note}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ marginTop: 14 }}>Inside a math region</h3>
        <table className="qz-table" data-testid="tfh-syntax">
          <tbody>
            {SYNTAX.map(([tok, desc]) => (
              <tr key={tok}>
                <td style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{tok}</td>
                <td style={{ color: "var(--text-dim)" }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ marginTop: 14 }}>Symbol palette</h3>
        <p style={{ color: "var(--text-dim)", marginTop: 6 }}>
          Every label field has an Ω button that opens the symbol palette —
          Greek letters, sub/superscript and italic/upright inserters, physics
          symbols, and common snippets. It inserts the right form for the
          caret position: the bare command inside a math region, a{" "}
          <code>$...$</code>-wrapped or plain-Unicode form outside.
        </p>

        <h3 style={{ marginTop: 14 }}>Keyboard shortcuts</h3>
        <p style={{ color: "var(--text-dim)", marginTop: 6 }}>
          Select text in any label field first, then apply the shortcut to
          wrap it. With nothing selected, the shortcut inserts an empty
          token and leaves the cursor inside it, ready to type.
        </p>
        <table className="qz-table" data-testid="tfh-shortcuts">
          <tbody>
            {SHORTCUTS.map(([keys, desc]) => (
              <tr key={keys}>
                <td style={{ fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{keys}</td>
                <td style={{ color: "var(--text-dim)" }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 style={{ marginTop: 14 }}>When markup is invalid</h3>
        <p style={{ color: "var(--text-dim)", marginTop: 6 }}>
          Invalid markup (an unclosed <code>$</code>, an unknown{" "}
          <code>\command</code>, an unmatched brace) never errors: the whole
          string simply renders literally, everywhere — plot, legend, editors,
          and export all apply the same fallback. The label editors also show
          the specific problem live while you type.
        </p>

        <div className="qz-btn-row">
          <Button variant="primary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
