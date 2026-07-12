// Symbol palette popover for the rich-text label editors (GOTO #5): a Greek
// grid, sub/superscript + italic/upright inserters, physics symbols, and
// common label snippets. Insertion is math-region aware: inside a `$...$`
// region a symbol inserts its bare mathtext command (`\alpha`); outside, it
// wraps itself (`$\alpha$`) or uses its plain-Unicode form. The popover
// portals to <body> (ContextMenu's clamping/outside-click conventions) and
// its buttons preventDefault on mousedown so the anchored <input> keeps
// focus + caret across inserts.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** One palette entry. `math` is the mathtext form; `text` the plain-Unicode
 *  form preferred OUTSIDE math regions. Snippets are text-only full labels. */
export interface PaletteEntry {
  glyph: string;
  title: string;
  math?: string;
  text?: string;
  /** Caret offset back from the end of the raw snippet (before any `$`
   *  wrapping) — e.g. 1 for `_{}` lands the caret between the braces. */
  caretBack?: number;
}

/** Unescaped `$` count — odd means "inside a math region". */
export function countUnescapedDollars(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "$" && s[i - 1] !== "\\") n++;
  }
  return n;
}

/** Apply `entry` to `value` at the selection; returns the new value and
 *  caret position. Pure — unit-tested without DOM. */
export function insertLabelToken(
  value: string,
  selStart: number,
  selEnd: number,
  entry: PaletteEntry,
): { value: string; cursor: number } {
  const before = value.slice(0, selStart);
  const after = value.slice(selEnd);
  const inMath = countUnescapedDollars(before) % 2 === 1;
  let raw: string;
  let wrapped = false;
  if (inMath) {
    raw = entry.math ?? entry.text ?? "";
    // A bare \command must not merge with a following letter (\alphax).
    if (/\\[a-zA-Z]+$/.test(raw) && /^[a-zA-Z]/.test(after)) raw += " ";
  } else if (entry.text != null) {
    raw = entry.text;
  } else {
    raw = `$${entry.math ?? ""}$`;
    wrapped = true;
  }
  const back = entry.caretBack != null ? entry.caretBack + (wrapped ? 1 : 0) : 0;
  return { value: before + raw + after, cursor: selStart + raw.length - back };
}

/** Wrap the CURRENT SELECTION in `entry`'s open/close markup (split at
 *  `entry.caretBack` from the end of `entry.math` — the same convention
 *  `insertLabelToken` uses to land the caret between empty braces: for
 *  `"_{}"` with `caretBack: 1` that's `open = "_{"`, `close = "}"`).
 *  Math-region aware like `insertLabelToken`: wraps bare (no `$...$`) when
 *  the selection already sits inside a math region, self-contained
 *  (`$open<sel>close$`) otherwise — so keyboard shortcuts never emit a
 *  redundant/nested `$` the parser would reject.
 *
 *  A selection containing ANY unescaped `$` — whether it straddles a
 *  region boundary (odd count) or encloses a whole `$...$` pair (even
 *  count, e.g. selecting all of "$x^2$") — can't be wrapped without
 *  fragmenting a region (the parser segments on every `$` regardless of
 *  nesting, so sandwiching a self-contained region inside more markup
 *  splits the wrapper's own command across segments). Falls back to
 *  `insertLabelToken`'s empty-token insert at the selection start —
 *  always-valid markup over a best-effort guess. Empty selections
 *  delegate to `insertLabelToken` unchanged (its caret-between-braces
 *  idiom is exactly the "cursor placed inside the braces" behaviour). */
export function wrapLabelSelection(
  value: string,
  selStart: number,
  selEnd: number,
  entry: PaletteEntry,
): { value: string; cursor: number } {
  if (selStart === selEnd) return insertLabelToken(value, selStart, selEnd, entry);
  const before = value.slice(0, selStart);
  const sel = value.slice(selStart, selEnd);
  const after = value.slice(selEnd);
  if (countUnescapedDollars(sel) > 0) {
    return insertLabelToken(value, selStart, selStart, entry);
  }
  const inMath = countUnescapedDollars(before) % 2 === 1;
  const raw = entry.math ?? entry.text ?? "";
  const splitAt = entry.caretBack != null ? raw.length - entry.caretBack : raw.length;
  const open = raw.slice(0, splitAt);
  const close = raw.slice(splitAt);
  const body = inMath ? `${open}${sel}${close}` : `$${open}${sel}${close}$`;
  return { value: before + body + after, cursor: before.length + body.length };
}

export const SUBSCRIPT_ENTRY: PaletteEntry = {
  glyph: "x₂", math: "_{}", caretBack: 1, title: "Subscript  _{ }  (Ctrl+=)",
};
export const SUPERSCRIPT_ENTRY: PaletteEntry = {
  glyph: "x²", math: "^{}", caretBack: 1, title: "Superscript  ^{ }  (Ctrl+Shift+=)",
};
export const ITALIC_ENTRY: PaletteEntry = {
  glyph: "𝑎𝑏", math: "\\mathit{}", caretBack: 1, title: "Italic  \\mathit{ }  (Ctrl/Cmd+I)",
};
const UPRIGHT_ENTRY: PaletteEntry = {
  glyph: "ab", math: "\\mathrm{}", caretBack: 1, title: "Upright  \\mathrm{ }",
};

const SCRIPTS: PaletteEntry[] = [SUBSCRIPT_ENTRY, SUPERSCRIPT_ENTRY, ITALIC_ENTRY, UPRIGHT_ENTRY];

const GREEK_NAMES: [string, string][] = [
  ["α", "alpha"], ["β", "beta"], ["γ", "gamma"], ["δ", "delta"], ["ε", "varepsilon"],
  ["ζ", "zeta"], ["η", "eta"], ["θ", "theta"], ["ι", "iota"], ["κ", "kappa"],
  ["λ", "lambda"], ["μ", "mu"], ["ν", "nu"], ["ξ", "xi"], ["π", "pi"],
  ["ρ", "rho"], ["σ", "sigma"], ["τ", "tau"], ["υ", "upsilon"], ["ϕ", "phi"],
  ["φ", "varphi"], ["χ", "chi"], ["ψ", "psi"], ["ω", "omega"],
  ["Γ", "Gamma"], ["Δ", "Delta"], ["Θ", "Theta"], ["Λ", "Lambda"], ["Ξ", "Xi"],
  ["Π", "Pi"], ["Σ", "Sigma"], ["Υ", "Upsilon"], ["Φ", "Phi"], ["Ψ", "Psi"],
  ["Ω", "Omega"],
];
const GREEK: PaletteEntry[] = GREEK_NAMES.map(([glyph, name]) => ({
  glyph,
  math: `\\${name}`,
  title: `\\${name}`,
}));

const SYMBOLS: PaletteEntry[] = [
  { glyph: "°", text: "°", math: "^\\circ", title: "Degree (° / ^\\circ in math)" },
  { glyph: "Å", text: "Å", math: "\\AA", title: "Angstrom (\\AA in math)" },
  { glyph: "×", text: "×", math: "\\times", title: "Multiplication (\\times)" },
  { glyph: "⋅", text: "⋅", math: "\\cdot", title: "Center dot (\\cdot)" },
  { glyph: "±", text: "±", math: "\\pm", title: "Plus-minus (\\pm)" },
  { glyph: "′", text: "′", math: "'", title: "Prime (' in math)" },
];

const STRUCTURES: PaletteEntry[] = [
  { glyph: "a/b", math: "\\frac{}{}", caretBack: 3, title: "Fraction  \\frac{ }{ }" },
  { glyph: "√", math: "\\sqrt{}", caretBack: 1, title: "Square root  \\sqrt{ }" },
  { glyph: "ⁿ√", math: "\\sqrt[]{}", caretBack: 3, title: "nth root  \\sqrt[ ]{ }" },
];

const RELATIONS: PaletteEntry[] = [
  { glyph: "≤", text: "≤", math: "\\leq", title: "Less than or equal (\\leq)" },
  { glyph: "≥", text: "≥", math: "\\geq", title: "Greater than or equal (\\geq)" },
  { glyph: "≠", text: "≠", math: "\\neq", title: "Not equal (\\neq)" },
  { glyph: "≈", text: "≈", math: "\\approx", title: "Approximately (\\approx)" },
  { glyph: "∝", text: "∝", math: "\\propto", title: "Proportional to (\\propto)" },
  { glyph: "∞", text: "∞", math: "\\infty", title: "Infinity (\\infty)" },
  { glyph: "→", text: "→", math: "\\rightarrow", title: "Right arrow (\\rightarrow)" },
  { glyph: "∂", text: "∂", math: "\\partial", title: "Partial (\\partial)" },
];

const SNIPPETS: PaletteEntry[] = [
  { glyph: "µ₀H (T)", text: "$\\mu_0H$ (T)", title: "Applied field axis" },
  { glyph: "Å⁻¹", text: "$\\AA^{-1}$", title: "Reciprocal angstroms" },
  { glyph: "10ⁿ", text: "$10^{n}$", caretBack: 3, title: "Power of ten (edit n)" },
  { glyph: "χ″", text: "$\\chi''$", title: "Imaginary susceptibility" },
];

interface SymbolPaletteProps {
  x: number;
  y: number;
  onInsert: (entry: PaletteEntry) => void;
  onClose: () => void;
}

function Section({ label, entries, onInsert, cols }: {
  label: string;
  entries: PaletteEntry[];
  onInsert: (e: PaletteEntry) => void;
  cols: number;
}) {
  return (
    <>
      <div className="qzk-ctx-header">{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2, padding: "0 6px 4px" }}>
        {entries.map((e) => (
          <button
            key={e.title}
            className="qz-icon-btn"
            title={e.title}
            style={{ minWidth: 26 }}
            // Keep the anchored input focused (and its caret intact) so the
            // click handler can insert at the live selection.
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onInsert(e)}
          >
            {e.glyph}
          </button>
        ))}
      </div>
    </>
  );
}

/** The popover. Stays open across inserts; closes on outside mousedown,
 *  Escape, scroll, or resize (ContextMenu conventions). */
export default function SymbolPalette({ x, y, onInsert, onClose }: SymbolPaletteProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const nx = x + r.width + pad > window.innerWidth ? Math.max(pad, window.innerWidth - r.width - pad) : x;
    const ny = y + r.height + pad > window.innerHeight ? Math.max(pad, window.innerHeight - r.height - pad) : y;
    setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={rootRef}
      className="qzk-menu-pop qzk-ctx"
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 1000, width: 248 }}
    >
      <Section label="Insert" entries={SCRIPTS} onInsert={onInsert} cols={4} />
      <Section label="Greek" entries={GREEK} onInsert={onInsert} cols={8} />
      <Section label="Symbols" entries={SYMBOLS} onInsert={onInsert} cols={6} />
      <Section label="Structures" entries={STRUCTURES} onInsert={onInsert} cols={6} />
      <Section label="Relations" entries={RELATIONS} onInsert={onInsert} cols={8} />
      <Section label="Snippets" entries={SNIPPETS} onInsert={onInsert} cols={2} />
    </div>,
    document.body,
  );
}
