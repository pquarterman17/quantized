// Import wizard — the numbered raw-lines strip (UX audit 8 #7). Rendered
// from the preview when there is one, and from the file text the wizard holds
// when the preview request failed, so the lines are on screen exactly when
// the user has to fix the settings. Line numbers are 1-based, the same base
// as the Header / Units / Label / Data start fields above it (which used to
// read "Header line 0" beside "Data start line 1"). The delimiter is
// highlighted in every line, so a wrong guess is visible at a glance.

import type { ReactNode } from "react";

export interface RawLineRoles {
  header_line: number | null;
  units_line: number | null;
  label_line: number | null;
  data_start_line: number;
}

/** No line marked (the settings guess has not arrived, or failed). */
export const NO_LINE_ROLES: RawLineRoles = { header_line: null, units_line: null, label_line: null, data_start_line: -1 };

const DELIM_STYLE = { color: "var(--accent)", fontWeight: 700 } as const;

/** `line` with every `delim` wrapped in a highlight span (a tab as "⇥"). */
function marked(line: string, delim: string | null): ReactNode {
  if (!delim || !line.includes(delim)) return line || " ";
  const parts = line.split(delim);
  const glyph = delim === "\t" ? "⇥\t" : delim;
  return parts.flatMap((part, i) =>
    i === 0 ? [part] : [<span key={i} data-delim="" style={DELIM_STYLE}>{glyph}</span>, part],
  );
}

export default function RawLines({
  lines,
  roles,
  delimiter,
  more = 0,
}: {
  lines: readonly string[];
  roles: RawLineRoles;
  /** The character to highlight, or null. */
  delimiter: string | null;
  /** Lines in the file past the last one shown. */
  more?: number;
}) {
  const rowBg = (i: number): string | undefined => {
    if (i === roles.header_line) return "var(--accent-soft)";
    if (i === roles.units_line) return "var(--capture-soft)";
    if (i === roles.label_line) return "var(--border-soft)";
    return undefined;
  };
  const rowTitle = (i: number): string | undefined => {
    if (i === roles.header_line) return "header line";
    if (i === roles.units_line) return "units line";
    if (i === roles.label_line) return "label line (legend labels)";
    if (i === roles.data_start_line) return "first data line";
    return undefined;
  };
  return (
    <div
      role="group"
      aria-label="Raw lines"
      style={{
        maxHeight: 130,
        overflowY: "auto",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--font-size-sm)",
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          data-raw-line={i + 1}
          title={rowTitle(i)}
          style={{
            display: "flex",
            gap: 8,
            padding: "1px 6px",
            background: rowBg(i),
            borderTop: i === roles.data_start_line ? "1px solid var(--ok)" : undefined,
            whiteSpace: "pre",
          }}
        >
          <span style={{ color: "var(--text-faint)", minWidth: 24, textAlign: "right" }}>{i + 1}</span>
          <span style={{ color: "var(--text-dim)" }}>{marked(line, delimiter)}</span>
        </div>
      ))}
      {more > 0 && (
        <div style={{ padding: "1px 6px", color: "var(--text-faint)" }}>
          … {more} more line{more === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
