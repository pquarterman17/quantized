// The worksheet formula language's tokenizer — split out of formula.ts (which
// sat at its 500-line ceiling) when P2.5's Python-like syntax landed. Every
// token carries `p`, its 0-based start offset in the source, so a syntax error
// can say WHERE it is ("… (column 7)", the same 1-based suffix the P2.7 fit
// equation syntax uses — calc/fit_equation_syntax.py).
//
// Python-like additions (P2.5, 2026-09-27), all previously syntax errors, so no
// formula that already parsed changes meaning:
//   - `**` power and `//` floor division are single operator tokens.
//   - `np.` / `numpy.` / `math.` before a name is dropped (`np.sqrt(A)` is
//     `sqrt(A)`, `np.pi` is `pi`) — the prefix is spelling, not a namespace.
//   - "text" / 'text' string literals (no escapes), used only by the fitted-
//     value references `fit("Model", "param")` / `fitval("Model", x)`.
//   - a `.` directly followed by a letter is the member operator
//     (`fit("Gaussian").A`); a `.` followed by a digit still starts a number.

import type { Tok } from "./formulaTypes";

/** A syntax error at a 0-based source offset: "<message> (column N)". */
export function syntaxError(message: string, at: number): Error {
  return new Error(`${message} (column ${at + 1})`);
}

const NAMESPACES = new Set(["np", "numpy", "math"]);
const isNameStart = (c: string | undefined): boolean => !!c && /[a-zA-Z_]/.test(c);

export function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const p = i;
    if (c === " " || c === "\t") {
      i++;
    } else if ((c >= "0" && c <= "9") || (c === "." && !isNameStart(src[i + 1]))) {
      let j = i + 1;
      while (j < src.length && /[0-9.eE+-]/.test(src[j])) {
        // allow exponent sign only right after e/E
        if ((src[j] === "+" || src[j] === "-") && !/[eE]/.test(src[j - 1])) break;
        j++;
      }
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw syntaxError(`bad number "${src.slice(i, j)}"`, p);
      toks.push({ t: "num", v: num, p });
      i = j;
    } else if (isNameStart(c)) {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      let name = src.slice(i, j);
      if (NAMESPACES.has(name) && src[j] === "." && isNameStart(src[j + 1])) {
        const k = j + 1;
        j = k + 1;
        while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
        name = src.slice(k, j);
      }
      toks.push({ t: "name", v: name, p });
      i = j;
    } else if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw syntaxError("unterminated text in quotes", p);
      toks.push({ t: "str", v: src.slice(i + 1, end), p });
      i = end + 1;
    } else if (c === "<" || c === ">" || c === "=" || c === "!") {
      // Comparison operators: <= >= == != are two-char; < and > also stand
      // alone. A lone "=" or "!" is not a valid token (no assignment, and
      // "not" — not "!" — is the logical-negation spelling; see formula.ts).
      if (src[i + 1] === "=") {
        toks.push({ t: "op", v: c + "=", p });
        i += 2;
      } else if (c === "<" || c === ">") {
        toks.push({ t: "op", v: c, p });
        i++;
      } else {
        throw syntaxError(`unexpected character "${c}"`, p);
      }
    } else if ((c === "*" || c === "/") && src[i + 1] === c) {
      toks.push({ t: "op", v: c + c, p });
      i += 2;
    } else if ("+-*/%^(),.".includes(c)) {
      toks.push({ t: "op", v: c, p });
      i++;
    } else {
      throw syntaxError(`unexpected character "${c}"`, p);
    }
  }
  return toks;
}
