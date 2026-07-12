// Rich-text labels (GOTO #5): the micro-syntax parser and shared AST.
//
// Labels are plain text with optional `$...$` math regions in a STRICT subset
// of matplotlib mathtext — the same string renders on-screen (uPlot canvas /
// DOM, via this AST) and in vector export (matplotlib parses it natively).
// This parser is the gatekeeper: anything it accepts MUST render in
// matplotlib mathtext, so everything outside the verified subset is rejected
// (probed against matplotlib 3.11: `%` and `#` are mathtext-invalid, hence
// excluded; `\,`/`\AA`/`\circ`/Greek/`\mathrm`/`\mathit` all verified).
//
// Subset, inside `$...$`:
//   _x  _{...}  ^x  ^{...}     sub/superscript (nesting supported)
//   {...}                      grouping
//   \frac{num}{den}            stacked fraction (rendered on canvas + export)
//   \sqrt{...}  \sqrt[n]{...}  radical, with optional root index
//   \alpha … \omega (+ \var* forms), \Gamma … \Omega   Greek (lowercase
//                              italic, uppercase upright — the TeX/mathtext
//                              convention)
//   \AA \circ \times \cdot \pm \mp \div \prime \,       symbols / thin space
//   \leq \geq \neq \approx \equiv \sim \propto \ll \gg  relations
//   \infty \partial \nabla \perp \parallel \angle \cdots \ldots  analysis
//   \rightarrow (\to) \leftarrow \leftrightarrow \Rightarrow     arrows
//   \mathrm{...} upright, \mathit{...} italic
//   letters → italic (mathtext convention), digits/punct → upright,
//   `-` → true minus (U+2212), `'` → prime (U+2032), whitespace ignored
//   (mathtext drops it too), plus a verified set of literal Unicode
//   (Greek, ° Å µ × ± ⋅ ∘ ′ ″ −).
// Outside `$...$`: literal Unicode passthrough; `\$` → a literal `$`.
//
// Unparseable input NEVER throws into a render path: `parseRichText` returns
// `ok: false` plus the whole string as one literal text node, and callers
// fall back to today's plain rendering (the export side applies the same
// literal fallback — see calc/figure_labels.py). A label containing no `$`
// short-circuits (`hasMarkup`) so it renders byte-identical to before.

export type RichNode =
  | { kind: "text"; text: string; italic: boolean }
  | { kind: "sub"; children: RichNode[] }
  | { kind: "sup"; children: RichNode[] }
  | { kind: "frac"; num: RichNode[]; den: RichNode[] }
  | { kind: "sqrt"; radicand: RichNode[]; index: RichNode[] | null };

export interface RichParseResult {
  ok: boolean;
  /** ASCII parse error (null when ok). */
  error: string | null;
  /** The parsed AST; on failure, a single literal text node of the source. */
  nodes: RichNode[];
}

/** Fast-path gate: only strings containing `$` are ever parsed. */
export function hasMarkup(s: string): boolean {
  return s.includes("$");
}

/** Greek commands -> [unicode, italic]. Lowercase renders italic, uppercase
 *  upright (mathtext's default math style). The \var* forms map to the TeX
 *  glyph variants (\epsilon = U+03F5 lunate, \varepsilon = U+03B5, etc.). */
const GREEK: Record<string, [string, boolean]> = {
  alpha: ["α", true],
  beta: ["β", true],
  gamma: ["γ", true],
  delta: ["δ", true],
  epsilon: ["ϵ", true],
  varepsilon: ["ε", true],
  zeta: ["ζ", true],
  eta: ["η", true],
  theta: ["θ", true],
  vartheta: ["ϑ", true],
  iota: ["ι", true],
  kappa: ["κ", true],
  lambda: ["λ", true],
  mu: ["μ", true],
  nu: ["ν", true],
  xi: ["ξ", true],
  pi: ["π", true],
  rho: ["ρ", true],
  sigma: ["σ", true],
  varsigma: ["ς", true],
  tau: ["τ", true],
  upsilon: ["υ", true],
  phi: ["ϕ", true],
  varphi: ["φ", true],
  chi: ["χ", true],
  psi: ["ψ", true],
  omega: ["ω", true],
  Gamma: ["Γ", false],
  Delta: ["Δ", false],
  Theta: ["Θ", false],
  Lambda: ["Λ", false],
  Xi: ["Ξ", false],
  Pi: ["Π", false],
  Sigma: ["Σ", false],
  Upsilon: ["Υ", false],
  Phi: ["Φ", false],
  Psi: ["Ψ", false],
  Omega: ["Ω", false],
};

/** Non-Greek symbol commands (always upright). Every entry is verified to
 *  render in matplotlib mathtext (the export gate parses the same string), so
 *  screen and export stay WYSIWYG. Relations/operators/arrows below map to the
 *  SAME Unicode glyph matplotlib draws for the command. NB `\deg` is
 *  deliberately absent: matplotlib renders it as the text "deg", not `°`. */
const SYMBOLS: Record<string, string> = {
  AA: "Å", // Å
  circ: "∘", // ∘ (ring operator; `^\circ` is the degree idiom)
  times: "×",
  cdot: "⋅",
  pm: "±",
  mp: "∓",
  div: "÷",
  prime: "′",
  // Relations / comparisons.
  leq: "≤",
  geq: "≥",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  propto: "∝",
  ll: "≪",
  gg: "≫",
  // Analysis / geometry symbols.
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  perp: "⊥",
  parallel: "∥",
  angle: "∠",
  cdots: "⋯",
  ldots: "…",
  dots: "…", // alias of \ldots
  // Arrows.
  rightarrow: "→",
  to: "→", // alias of \rightarrow
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
};

/** ASCII punctuation verified to parse in mathtext math mode. `%` and `#`
 *  are mathtext-INVALID (probed) and deliberately absent. */
const MATH_PUNCT = new Set([..."+=/()[]|.,:;!*<>"]);

/** Literal Unicode accepted inside math (verified against mathtext): the
 *  degree sign, Å, micro, and the operator glyphs this module itself emits. */
const MATH_UNICODE = new Set([..."°Åµ×±⋅∘′″−"]);

/** Direct Greek codepoints allowed in math (same glyphs the commands emit). */
function greekUnicodeItalic(c: string): boolean | null {
  for (const [glyph, italic] of Object.values(GREEK)) {
    if (glyph === c) return italic;
  }
  return null;
}

class RichSyntaxError extends Error {}

type MathStyle = "auto" | "rm" | "it";

/** Append a text run, merging with the previous run when styles match. */
function emitText(nodes: RichNode[], text: string, italic: boolean): void {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last && last.kind === "text" && last.italic === italic) last.text += text;
  else nodes.push({ kind: "text", text, italic });
}

/** One char inside math -> its text run, or throw when outside the subset. */
function emitMathChar(nodes: RichNode[], c: string, style: MathStyle): void {
  if (/[a-zA-Z]/.test(c)) {
    emitText(nodes, c, style !== "rm");
    return;
  }
  if (/[0-9]/.test(c)) {
    emitText(nodes, c, style === "it");
    return;
  }
  if (c === "-") {
    emitText(nodes, "−", false); // mathtext renders '-' as a true minus
    return;
  }
  if (c === "'") {
    emitText(nodes, "′", false); // mathtext turns ' into a prime
    return;
  }
  if (MATH_PUNCT.has(c)) {
    emitText(nodes, c, false);
    return;
  }
  const greekIt = greekUnicodeItalic(c);
  if (greekIt != null) {
    emitText(nodes, c, greekIt);
    return;
  }
  if (MATH_UNICODE.has(c)) {
    emitText(nodes, c, false);
    return;
  }
  throw new RichSyntaxError(`unsupported character "${c}" in math mode`);
}

/** Cursor over one math-segment body. */
interface Cursor {
  src: string;
  pos: number;
}

/** Consume a `{...}` group at `cur.pos` (which must be `{`) and return its
 *  parsed children at `style`. */
function parseGroup(cur: Cursor, style: MathStyle, what: string): RichNode[] {
  if (cur.src[cur.pos] !== "{") throw new RichSyntaxError(`${what} requires a {...} group`);
  cur.pos += 1; // consume {
  return parseMath(cur, style, true);
}

// Most commands are style-independent (Greek/symbols carry their own upright/
// italic convention); \mathrm/\mathit set the style for their group, while
// \frac/\sqrt render their operands in the CURRENT style (hence the param).
function parseCommand(cur: Cursor, nodes: RichNode[], style: MathStyle): void {
  // cur.pos sits just after the backslash.
  if (cur.src[cur.pos] === ",") {
    cur.pos += 1;
    emitText(nodes, " ", false); // thin space (U+2009)
    return;
  }
  let name = "";
  while (cur.pos < cur.src.length && /[a-zA-Z]/.test(cur.src[cur.pos])) {
    name += cur.src[cur.pos];
    cur.pos += 1;
  }
  if (!name) throw new RichSyntaxError("stray backslash in math mode");
  if (name === "mathrm" || name === "mathit") {
    const children = parseGroup(cur, name === "mathrm" ? "rm" : "it", `\\${name}`);
    for (const child of children) appendNode(nodes, child);
    return;
  }
  if (name === "frac") {
    const num = parseGroup(cur, style, "\\frac numerator");
    const den = parseGroup(cur, style, "\\frac denominator");
    nodes.push({ kind: "frac", num, den });
    return;
  }
  if (name === "sqrt") {
    let index: RichNode[] | null = null;
    if (cur.src[cur.pos] === "[") {
      cur.pos += 1;
      const close = cur.src.indexOf("]", cur.pos);
      if (close < 0) throw new RichSyntaxError("\\sqrt[ without a closing ]");
      const idx: Cursor = { src: cur.src.slice(cur.pos, close), pos: 0 };
      index = parseMath(idx, style, false); // the [n] root index
      cur.pos = close + 1;
    }
    const radicand = parseGroup(cur, style, "\\sqrt");
    nodes.push({ kind: "sqrt", radicand, index });
    return;
  }
  const greek = GREEK[name];
  if (greek) {
    emitText(nodes, greek[0], greek[1]);
    return;
  }
  const sym = SYMBOLS[name];
  if (sym) {
    emitText(nodes, sym, false);
    return;
  }
  throw new RichSyntaxError(`unknown command \\${name}`);
}

/** Append preserving text-run merging (group results flatten into parent). */
function appendNode(nodes: RichNode[], node: RichNode): void {
  if (node.kind === "text") emitText(nodes, node.text, node.italic);
  else nodes.push(node);
}

/** The operand of `_` / `^`: a {...} group, a \command, or a single char. */
function parseScriptOperand(cur: Cursor, style: MathStyle): RichNode[] {
  while (cur.pos < cur.src.length && /\s/.test(cur.src[cur.pos])) cur.pos += 1;
  const c = cur.src[cur.pos];
  if (c === undefined) throw new RichSyntaxError("_ or ^ at end of math region");
  if (c === "{") {
    cur.pos += 1;
    return parseMath(cur, style, true);
  }
  const out: RichNode[] = [];
  if (c === "\\") {
    cur.pos += 1;
    parseCommand(cur, out, style);
    return out;
  }
  cur.pos += 1;
  emitMathChar(out, c, style);
  return out;
}

/** Parse math until end of segment (or the matching `}` when inGroup). */
function parseMath(cur: Cursor, style: MathStyle, inGroup: boolean): RichNode[] {
  const nodes: RichNode[] = [];
  while (cur.pos < cur.src.length) {
    const c = cur.src[cur.pos];
    if (c === "}") {
      if (inGroup) {
        cur.pos += 1;
        return nodes;
      }
      throw new RichSyntaxError("unmatched } in math mode");
    }
    if (/\s/.test(c)) {
      cur.pos += 1; // mathtext ignores whitespace in math mode
      continue;
    }
    if (c === "{") {
      cur.pos += 1;
      for (const child of parseMath(cur, style, true)) appendNode(nodes, child);
      continue;
    }
    if (c === "_" || c === "^") {
      cur.pos += 1;
      const children = parseScriptOperand(cur, style);
      nodes.push({ kind: c === "_" ? "sub" : "sup", children });
      continue;
    }
    if (c === "\\") {
      cur.pos += 1;
      parseCommand(cur, nodes, style);
      continue;
    }
    cur.pos += 1;
    emitMathChar(nodes, c, style);
  }
  if (inGroup) throw new RichSyntaxError("unclosed { group in math mode");
  return nodes;
}

/** Split the source into alternating text/math segments on unescaped `$`. */
function splitSegments(source: string): { math: boolean; body: string }[] {
  const segs: { math: boolean; body: string }[] = [];
  let cur = "";
  let inMath = false;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\" && source[i + 1] === "$" && !inMath) {
      cur += "$"; // \$ outside math is a literal dollar (matplotlib rule)
      i += 2;
      continue;
    }
    if (c === "$") {
      segs.push({ math: inMath, body: cur });
      cur = "";
      inMath = !inMath;
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  if (inMath) throw new RichSyntaxError("unclosed $ math region");
  segs.push({ math: false, body: cur });
  return segs;
}

/** Parse a label into the shared AST. Never throws — failure returns the
 *  whole source as one literal node with `ok: false` (see module doc). */
export function parseRichText(source: string): RichParseResult {
  const literal: RichNode[] = source ? [{ kind: "text", text: source, italic: false }] : [];
  try {
    const segs = splitSegments(source);
    const anyMath = segs.some((s) => s.math);
    const nodes: RichNode[] = [];
    for (const seg of segs) {
      if (!seg.math) {
        // In a math-bearing string the WHOLE string goes through matplotlib's
        // mathtext parser, whose text mode chokes on raw backslashes — reject
        // them so the WYSIWYG contract holds. A no-math string is rendered by
        // matplotlib's plain-text path, which passes anything through.
        if (anyMath && seg.body.includes("\\")) {
          throw new RichSyntaxError("backslash outside a $...$ math region");
        }
        emitText(nodes, seg.body, false);
        continue;
      }
      if (!seg.body.trim()) throw new RichSyntaxError("empty $...$ math region");
      const cur: Cursor = { src: seg.body, pos: 0 };
      for (const child of parseMath(cur, "auto", false)) appendNode(nodes, child);
    }
    return { ok: true, error: null, nodes };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, nodes: literal };
  }
}

/** Convenience for renderers: the AST when the label is rich AND valid,
 *  else null (caller keeps today's plain rendering — the fallback path). */
export function richLabelAst(s: string | null | undefined): RichNode[] | null {
  if (!s || !hasMarkup(s)) return null;
  const r = parseRichText(s);
  return r.ok ? r.nodes : null;
}

/** Flatten an AST (or raw label) to plain text — a11y / tooltip fallback. */
export function plainText(input: string | RichNode[]): string {
  const nodes = typeof input === "string" ? parseRichText(input).nodes : input;
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text") out += n.text;
    else if (n.kind === "frac") out += `${plainText(n.num)}/${plainText(n.den)}`;
    else if (n.kind === "sqrt") {
      out += `${n.index ? plainText(n.index) : ""}√(${plainText(n.radicand)})`;
    } else out += plainText(n.children);
  }
  return out;
}

/** Live editor feedback: `{ ok: true }` or `{ ok: false, error }`. */
export function validateRichText(s: string): { ok: boolean; error?: string } {
  if (!hasMarkup(s)) return { ok: true };
  const r = parseRichText(s);
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "invalid label markup" };
}
