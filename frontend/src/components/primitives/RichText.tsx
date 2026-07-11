// Rich-text label renderer for HTML surfaces (GOTO #5): the plot legend and
// the label-editor live previews. Parses the shared micro-syntax
// (lib/richtext) and renders <i>/<sub>/<sup> runs; a $-free or INVALID label
// renders as the raw string — the same literal fallback the canvas and
// export renderers apply, so all three surfaces always agree.

import type { ReactNode } from "react";

import { hasMarkup, parseRichText, type RichNode } from "../../lib/richtext";

function renderNodes(nodes: RichNode[], keyBase: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyBase}.${i}`;
    if (n.kind === "text") {
      return n.italic ? <i key={key}>{n.text}</i> : <span key={key}>{n.text}</span>;
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
