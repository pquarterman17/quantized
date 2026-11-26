// Text to columns: pick the delimiter, see the first rows split, then create a
// NEW worksheet holding the pieces (the source is never edited; one undo step;
// store/textToColumnsRun.ts). The split rules are lib/textToColumns.ts's header.
// Lazy: WorksheetPane mounts it (its own chunk) only while it is open.

import { useId, useMemo, useRef, useState } from "react";

import { useEscapeSurface } from "../../../lib/escapeStack";
import { originTextColumns } from "../../../lib/originTextColumns";
import { classifyColumns, DELIMITER_LABELS, delimiterText, splitCells, MAX_SPLIT_COLUMNS, type DelimiterKind, type SplitOptions } from "../../../lib/textToColumns";
import type { Dataset } from "../../../lib/types";
import { runTextToColumns } from "../../../store/textToColumnsRun";
import { Button, Select } from "../../primitives";
import { useDialogFocus } from "../../overlays/useDialogFocus";

export interface TextToColumnsDialogProps {
  ds: Dataset;
  /** The text column's short name. */
  textName: string;
  onClose: () => void;
}

const PREVIEW_ROWS = 8;
const PREVIEW_COLS = 8;
const CELL = { textAlign: "left", padding: "0 14px 0 0", whiteSpace: "nowrap" } as const;
const KINDS = Object.keys(DELIMITER_LABELS) as DelimiterKind[];

export default function TextToColumnsDialog({ ds, textName, onClose }: TextToColumnsDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const col = useMemo(() => originTextColumns(ds.data).find((t) => t.shortName === textName), [ds.data, textName]);
  const [delimiter, setDelimiter] = useState<DelimiterKind>("comma");
  const [custom, setCustom] = useState("");
  const [quote, setQuote] = useState(true);
  const [trim, setTrim] = useState(true);
  const [merge, setMerge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const restore = useDialogFocus(dialogRef, true);
  const close = () => {
    onClose();
    restore();
  };
  useEscapeSurface("modal", () => {
    close();
    return true;
  });

  const options: SplitOptions = { delimiter, custom, quote, trim, merge };
  const label = col?.longName ?? col?.shortName ?? textName;
  const split = useMemo(() => {
    const d = delimiterText({ delimiter, custom });
    if (!col) return { problem: `the text column "${textName}" is no longer in this worksheet` } as const;
    if ("error" in d) return { problem: d.error } as const;
    const table = splitCells(col.rows, { delimiter, custom, quote, trim, merge });
    if (table.width > MAX_SPLIT_COLUMNS) return { problem: `This would create ${table.width} columns (the limit is ${MAX_SPLIT_COLUMNS}): check the delimiter.` } as const;
    return { table, kinds: classifyColumns(table) } as const;
  }, [col, delimiter, custom, quote, trim, merge, textName]);

  const problem = "problem" in split ? split.problem : null;
  const ok = !problem && !busy && split.table!.width > 0;
  const shown = applyError ?? problem;

  const apply = async () => {
    if (!ok) return;
    setBusy(true);
    setApplyError(null);
    const r = await runTextToColumns(ds.id, textName, options);
    setBusy(false);
    if (r.ok) close();
    else setApplyError(r.error);
  };

  const table = "table" in split ? split.table : null;
  const kinds = "kinds" in split ? split.kinds : [];
  const shownCols = Math.min(table?.width ?? 0, PREVIEW_COLS);

  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog"
        role="dialog"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        style={{ width: "min(640px, 94vw)", top: "8%", maxHeight: "86vh" }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const tag = (e.target as HTMLElement).tagName;
          if (e.key === "Enter" && tag !== "SELECT" && tag !== "BUTTON") {
            e.preventDefault();
            void apply();
          }
          if (e.key !== "Escape") e.stopPropagation();
        }}
      >
        <h2 id={titleId}>Text to columns — {label}</h2>
        <div className="qz-ws-row">
          <span className="k">Split on</span>
          <Select
            aria-label="Delimiter"
            value={delimiter}
            options={KINDS.map((k) => ({ value: k, label: DELIMITER_LABELS[k] }))}
            onChange={(e) => setDelimiter(e.target.value as DelimiterKind)}
          />
          {delimiter === "custom" && (
            <input aria-label="Custom delimiter" className="qz-input" style={{ width: 120, fontFamily: "var(--font-mono)" }} value={custom} placeholder="e.g. | or --" onChange={(e) => setCustom(e.target.value)} />
          )}
        </div>
        <label className="qz-ws-row">
          <input type="checkbox" checked={quote} onChange={(e) => setQuote(e.target.checked)} />A &quot;quoted field&quot; may contain the delimiter
        </label>
        <label className="qz-ws-row">
          <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} />Trim spaces around each piece
        </label>
        <label className="qz-ws-row">
          <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />Treat repeated delimiters as one (skip empty pieces)
        </label>
        <div className="qzk-ds-meta" style={{ whiteSpace: "normal" }}>
          Creates a new worksheet with the pieces added after the existing columns; &quot;{ds.name}&quot; is not changed. A piece column that is all numbers becomes a value column, any other stays text. Undo removes the new worksheet.
        </div>
        {shown && (
          <div role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--danger)" }}>
            {shown}
          </div>
        )}
        {table && table.width > 0 && (
          <table className="qzk-ds-meta" style={{ fontFamily: "var(--font-mono)", borderCollapse: "collapse", alignSelf: "flex-start", maxWidth: "100%", overflowX: "auto", display: "block" }}>
            <caption style={{ textAlign: "left" }}>
              Preview — {table.width} column{table.width === 1 ? "" : "s"} ({kinds.filter((k) => k.numeric).length} numeric), first {Math.min(PREVIEW_ROWS, table.rows.length)} of {table.rows.length} rows
              {table.width > shownCols ? `, first ${shownCols} columns shown` : ""}
            </caption>
            <thead>
              <tr>
                {Array.from({ length: shownCols }, (_, c) => (
                  <th key={c} scope="col" style={CELL}>
                    {label} {c + 1}
                    {kinds[c]?.numeric ? " (number)" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                <tr key={i}>
                  {r.slice(0, shownCols).map((f, c) => (
                    <td key={c} style={CELL}>{f}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="qz-btn-row">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!ok} onClick={() => void apply()}>
            {busy ? "Creating…" : "Create worksheet"}
          </Button>
        </div>
      </div>
    </div>
  );
}
