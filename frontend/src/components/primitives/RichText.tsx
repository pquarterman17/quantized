// Rich-text label renderer for HTML surfaces (GOTO #5): the plot legend and
// the label-editor live previews. Parses the shared micro-syntax
// (lib/richtext) and renders <i>/<sub>/<sup> runs; a $-free or INVALID label
// renders as the raw string — the same literal fallback the canvas and
// export renderers apply, so all three surfaces always agree.

import type { CSSProperties, ReactNode } from "react";

import { hasMarkup, parseRichText, type RichNode } from "../../lib/richtext";

// Inline styles (self-contained so the primitive needs no global stylesheet —
// it renders identically under Testing Library and the visual harness).
const FRAC_STYLE: CSSProperties = {
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "center",
  verticalAlign: "middle",
  lineHeight: 1.05,
  margin: "0 0.15em",
};
const FRAC_NUM_STYLE: CSSProperties = { borderBottom: "1px solid currentColor", padding: "0 0.15em" };
const FRAC_DEN_STYLE: CSSProperties = { padding: "0 0.15em" };
const SQRT_STYLE: CSSProperties = { whiteSpace: "nowrap" };
const SQRT_RAD_STYLE: CSSProperties = { borderTop: "1px solid currentColor", padding: "0 0.1em" };

function renderNodes(nodes: RichNode[], keyBase: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyBase}.${i}`;
    if (n.kind === "text") {
      return n.italic ? <i key={key}>{n.text}</i> : <span key={key}>{n.text}</span>;
    }
    // Fractions/roots (MAIN #28): CSS approximations of the canvas layout — a
    // stacked column with a rule for \frac, a √ prefix + overlined radicand
    // for \sqrt. Good enough for the DOM surfaces (legend, editor preview);
    // the canvas + matplotlib paths carry the pixel-faithful rendering.
    if (n.kind === "frac") {
      return (
        <span key={key} style={FRAC_STYLE}>
          <span style={FRAC_NUM_STYLE}>{renderNodes(n.num, `${key}.n`)}</span>
          <span style={FRAC_DEN_STYLE}>{renderNodes(n.den, `${key}.d`)}</span>
        </span>
      );
    }
    if (n.kind === "sqrt") {
      return (
        <span key={key} style={SQRT_STYLE}>
          {n.index && (
            <sup style={{ fontSize: "0.6em" }}>{renderNodes(n.index, `${key}.i`)}</sup>
          )}
          <span aria-hidden="true">√</span>
          <span style={SQRT_RAD_STYLE}>{renderNodes(n.radicand, `${key}.r`)}</span>
        </span>
      );
    }
    const Tag = n.kind; // "sub" | "sup"
    return (
      // fontSize matches the canvas renderer's SCRIPT_SCALE (0.7x per level).
      <Tag key={key} style={{ fontSize: "0.7em" }}>
        {renderNodes(n.children, key)}
      </Tag>
    );
  });
}

export default function RichText({ text }: { text: string }) {
  if (!hasMarkup(text)) return <>{text}</>;
  const r = parseRichText(text);
  if (!r.ok) return <>{text}</>;
  return <>{renderNodes(r.nodes, "rt")}</>;
}
