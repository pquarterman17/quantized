// Static accessible-name scan (PRIMARY_SOFTWARE_AUDIT_PLAN, "Accessible
// names/state for icons…" box, package U6). Test-support only — imported by
// `accessibleNames.test.ts`, never by app code.
//
// The defect it finds: an icon-only control whose accessible name is a glyph
// or nothing. Name computation takes an element's CONTENT before its `title`,
// so `<button title="Toggle library">▤</button>` is announced as "▤" (or,
// in most screen readers, as nothing at all). Only `aria-label` /
// `aria-labelledby` outrank the content. The visible glyph stays; the name
// moves to `aria-label`.
//
// This is a JSX-shaped text scan, not a parser — deliberately small. It errs
// toward SILENCE on anything it cannot read statically (a child expression
// it cannot evaluate, a `{...spread}` that may carry the label); the render-
// level half (`accessibleNames.render.test.tsx`) covers rendered names.

/** One control the scan judged unnamed. `line` is 1-based. */
export interface UnnamedControl {
  line: number;
  tag: string;
  reason: string;
}

/** A name "reads as words": at least two characters and at least one letter.
 *  "▤", "×", "⧉", "Q" and "" fail; "log", "Σx", "1-D", "+Rows" pass. */
export function isWordLikeName(name: string): boolean {
  const s = name.replace(/\s+/g, "");
  return s.length >= 2 && /\p{L}/u.test(s);
}

/** Blank comments out (keeping offsets and line numbers): block comments,
 *  JSX `{/* … *\/}` comments, and whole-line `//` comments. Trailing `//`
 *  comments after code are left alone — JSX text may legitimately hold `//`. */
export function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  // A comment opens after whitespace or punctuation, never mid-word — so the
  // `/*` inside `accept="image/*"` does not swallow the markup after it.
  return src
    .replace(/(^|[\s{(,;])(\/\*[\s\S]*?\*\/)/g, (_m, pre: string, body: string) => pre + blank(body))
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

interface OpenTag {
  end: number;
  attrs: string;
  selfClosing: boolean;
}

/** Read the opening tag starting at `i` (the `<`), skipping `{…}` attribute
 *  expressions and quoted values. */
function readOpenTag(src: string, i: number): OpenTag | null {
  let depth = 0;
  let quote: string | null = null;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === "\\") j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || (depth > 0 && c === "`")) quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) {
      return { end: j + 1, attrs: src.slice(i, j + 1), selfClosing: src[j - 1] === "/" };
    }
  }
  return null;
}

/** Index of the `</tag>` closing the element whose children start at `from`. */
function findClose(src: string, tag: string, from: number): number {
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[0].startsWith("</")) {
      if (--depth === 0) return m.index;
    } else {
      const t = readOpenTag(src, m.index);
      if (t && !t.selfClosing) depth++;
      if (t) re.lastIndex = t.end;
    }
  }
  return -1;
}

/** Index just past the `}` matching the `{` at `i`. */
function matchBrace(src: string, i: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) {
      if (c === "\\") j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return src.length;
}

const LITERAL = String.raw`(?:"[^"]*"|'[^']*')`;
const BARE_LITERAL = new RegExp(`^${LITERAL}$`);
const TERNARY = new RegExp(`^[^?]*\\?\\s*(${LITERAL})\\s*:\\s*(${LITERAL})$`);
const AND_LITERAL = new RegExp(`^[^?]*&&\\s*(${LITERAL})$`);

/** The text a `{expr}` child contributes, or null when it can't be known. */
function expressionText(expr: string): string | null {
  const e = expr.trim();
  if (e === "") return "";
  if (BARE_LITERAL.test(e)) return e.slice(1, -1);
  const t = TERNARY.exec(e);
  // Both branches concatenated: a glyph toggle ("☾"/"☀") stays glyph-only,
  // and a branch with words makes the whole read as words either way.
  if (t) return t[1].slice(1, -1) + t[2].slice(1, -1);
  const a = AND_LITERAL.exec(e);
  if (a) return a[1].slice(1, -1);
  return null;
}

interface ChildText {
  text: string;
  /** True when some child's contribution can't be read statically. */
  dynamic: boolean;
  /** True when a descendant carries its own aria-label (e.g. a file input). */
  innerLabel: boolean;
}

/** The text content a screen reader would read from these JSX children:
 *  aria-hidden subtrees drop out, string expressions are evaluated. */
export function childText(children: string): ChildText {
  const out: ChildText = { text: "", dynamic: false, innerLabel: false };
  let i = 0;
  while (i < children.length) {
    const c = children[i];
    if (c === "{") {
      const end = matchBrace(children, i);
      const v = expressionText(children.slice(i + 1, end - 1));
      if (v === null) out.dynamic = true;
      else out.text += v;
      i = end;
    } else if (c === "<" && /[A-Za-z]/.test(children[i + 1] ?? "")) {
      const tag = /^<([A-Za-z][\w.]*)/.exec(children.slice(i))![1];
      const open = readOpenTag(children, i);
      if (!open) break;
      if (/\baria-label(ledby)?=/.test(open.attrs)) out.innerLabel = true;
      let next = open.end;
      if (!open.selfClosing) {
        const close = findClose(children, tag, open.end);
        if (close < 0) break;
        if (!/\baria-hidden\b(?!=\{?\s*["']?false)/.test(open.attrs)) {
          const inner = childText(children.slice(open.end, close));
          out.text += inner.text;
          out.dynamic ||= inner.dynamic;
          out.innerLabel ||= inner.innerLabel;
        }
        next = close + tag.length + 3;
      } else if (/^[A-Z]/.test(tag) || /\{\s*\.\.\./.test(open.attrs)) {
        out.dynamic = true; // a component (`<Icon />`) renders unknown content
      }
      i = next;
    } else if (c === "<") {
      // A fragment `<>` / `</>` or a stray closer: markup, not text.
      const gt = children.indexOf(">", i);
      i = gt < 0 ? children.length : gt + 1;
    } else {
      const next = children.slice(i + 1).search(/[{<]/);
      const end = next < 0 ? children.length : i + 1 + next;
      // JSX entities (&times;) are glyphs for this purpose.
      out.text += children.slice(i, end).replace(/&#?\w+;/g, "·");
      i = end;
    }
  }
  return out;
}

const CANDIDATE = /<(button|Button|Pill|IconButton|label|span|div|a)\b/g;

/** Every icon-only control in one `.tsx` source whose accessible name would
 *  be a glyph or empty. See the header for what counts. */
export function findUnnamedControls(source: string): UnnamedControl[] {
  const src = stripComments(source);
  const found: UnnamedControl[] = [];
  CANDIDATE.lastIndex = 0;
  for (let m = CANDIDATE.exec(src); m; m = CANDIDATE.exec(src)) {
    const tag = m[1];
    const open = readOpenTag(src, m.index);
    if (!open) continue;
    const { attrs } = open;
    const iconClass = /qz-icon-btn/.test(attrs) || tag === "IconButton";
    const isButton = tag === "button" || tag === "Button" || tag === "Pill" || /\brole=["']button["']/.test(attrs);
    if (!iconClass && !isButton) continue;
    if (/\baria-label(ledby)?=/.test(attrs)) continue;
    // A spread may carry the label (and is how IconButton forwards it).
    if (/\{\s*\.\.\./.test(attrs)) continue;
    let content: ChildText = { text: "", dynamic: false, innerLabel: false };
    if (!open.selfClosing) {
      const close = findClose(src, tag, open.end);
      if (close >= 0) content = childText(src.slice(open.end, close));
    }
    if (content.innerLabel) continue;
    const line = src.slice(0, m.index).split("\n").length;
    const shown = content.text.replace(/\s+/g, " ").trim();
    if (iconClass) {
      // By contract an icon button shows a glyph: content can't name it.
      if (content.dynamic || !isWordLikeName(shown)) {
        found.push({ line, tag, reason: `icon button named by its content "${shown || "…"}"` });
      }
    } else if (!content.dynamic) {
      if (shown === "" && !/\btitle=/.test(attrs)) {
        found.push({ line, tag, reason: "button with no content, title, or aria-label" });
      } else if (shown !== "" && !isWordLikeName(shown)) {
        found.push({ line, tag, reason: `glyph-only button named "${shown}"` });
      }
    }
  }
  return found;
}
