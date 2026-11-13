// `plainText`, moved out of lib/richtext.ts so the eager label parser does
// not carry it (no eager caller flattens labels; bundle offset for the
// Origin-escape detector, publication-figures audit #17).

import { parseRichText, type RichNode } from "./richtext";

/** Flatten an AST (or raw label) to plain text — a11y / tooltip fallback. */
export function plainText(input: string | RichNode[]): string {
  const nodes = typeof input === "string" ? parseRichText(input).nodes : input;
  let out = "";
  for (const n of nodes) {
    if (n.kind === "text") out += n.text;
    else if (n.kind === "frac") out += `${plainText(n.num)}/${plainText(n.den)}`;
    else if (n.kind === "sqrt") {
      out += `${n.index ? plainText(n.index) : ""}√(${plainText(n.radicand)})`;
    } else if (n.kind === "bigop") {
      out += n.op;
      if (n.under) out += `_${plainText(n.under)}`;
      if (n.over) out += `^${plainText(n.over)}`;
    } else out += plainText(n.children);
  }
  return out;
}
