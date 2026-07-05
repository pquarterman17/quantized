// Inspector card: dedicated Origin provenance surface — the notes-window free
// text (`metadata.origin_notes`) and the parsed results log (fits, worksheet
// ops — `metadata.origin_results_log_records`, plan item 22) that Origin
// projects carry alongside their data. Split out of the generic Metadata card
// (io/origin_project/notes.py) because a raw JSON blob of a multi-record log
// is unreadable there; here each record collapses to a one-line summary that
// expands to its Input/Output params. Falls back to the raw log text
// (`metadata.origin_results_log`) when the structured parse isn't present.
//
// Also renders the two non-numeric column recoveries from io/origin_project/
// opj.py + opju.py (plan item 4): `metadata.origin_report_sheets` (Origin
// FitLinear/NLFit report-sheet "cell://..." reference columns) and
// `metadata.origin_text_columns` (short inline text columns) — both keyed
// `{col_short: [strings...]}`. Each is a raw-JSON-unreadable dict just like
// the results log, so it gets the same one-section-per-column <details>
// treatment: a summary line (column letter + first string + row count) that
// expands to the full string list.

import { copyText } from "../../lib/clipboard";
import { formatMetaValue } from "../../lib/metadata";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Button, Card } from "../primitives";

interface ResultsLogRecord {
  timestamp: string;
  operation: string;
  params: Record<string, Record<string, unknown>>;
  extra?: string[];
}

function isRecord(v: unknown): v is ResultsLogRecord {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as Record<string, unknown>).timestamp === "string" &&
    typeof (v as Record<string, unknown>).operation === "string"
  );
}

function isNotesMap(v: unknown): v is Record<string, string> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isColumnStringsMap(v: unknown): v is Record<string, string[]> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((rows) => Array.isArray(rows))
  );
}

/** Origin column short names (A, B, …, Z, AA, AB, …) sort correctly by
 *  length-then-lex — no need to parse the base-26 letter encoding itself. */
function sortColumnKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** One <details> block per Origin column, summarizing to its short name +
 *  first string + row count, expanding to the full (scrollable) string list.
 *  Shared by the report-sheet and inline-text-column sections below. */
function ColumnStringsSection({
  title,
  cols,
  keys,
}: {
  title: string;
  cols: Record<string, string[]>;
  keys: string[];
}) {
  if (keys.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-faint)", marginBottom: 2 }}>
        {title}
      </div>
      {keys.map((col) => {
        const rows = cols[col];
        const first = rows[0] ?? "";
        const label = first ? truncate(first, 60) : "(empty)";
        return (
          <details className="qz-provenance-row" key={col}>
            <summary>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>{col}</span>{" "}
              <span style={{ color: "var(--text-faint)" }}>{label}</span>{" "}
              <span style={{ color: "var(--text-faint)" }}>({rows.length})</span>
            </summary>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-size-sm)",
                color: "var(--text-dim)",
                maxHeight: 160,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                paddingLeft: 14,
                marginTop: 4,
              }}
            >
              {rows.map((s, i) => (
                <div key={i}>{s || " "}</div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export default function OriginProvenanceCard({ active }: { active: Dataset | null }) {
  const setStatus = useApp((s) => s.setStatus);
  const meta = (active?.data.metadata ?? {}) as Record<string, unknown>;

  const notes = isNotesMap(meta.origin_notes) ? meta.origin_notes : null;
  const noteWindows = notes ? Object.keys(notes).filter((w) => notes[w]?.trim()) : [];

  const rawLog = typeof meta.origin_results_log === "string" ? meta.origin_results_log : "";
  const records = Array.isArray(meta.origin_results_log_records)
    ? meta.origin_results_log_records.filter(isRecord)
    : [];

  const reportSheets = isColumnStringsMap(meta.origin_report_sheets) ? meta.origin_report_sheets : null;
  const reportKeys = reportSheets ? sortColumnKeys(Object.keys(reportSheets)) : [];

  const textColumns = isColumnStringsMap(meta.origin_text_columns) ? meta.origin_text_columns : null;
  const textKeys = textColumns ? sortColumnKeys(Object.keys(textColumns)) : [];

  // The designated X column failed to decode, so `.time` is a synthetic row
  // index rather than Origin's real independent variable (io/origin_project/
  // opj.py). Surface it so a row-index x-axis isn't a silent mystery.
  const xUnrecovered = meta.x_column_recovered === false;
  const xUnrecoveredName =
    typeof meta.x_column_unrecovered === "string" ? meta.x_column_unrecovered : "";

  const hasLog = records.length > 0 || rawLog.length > 0;
  const hasColumnSections = reportKeys.length > 0 || textKeys.length > 0;
  if (!active || (noteWindows.length === 0 && !hasLog && !hasColumnSections && !xUnrecovered))
    return null;

  const copyLog = () =>
    copyText(rawLog).then((ok) => setStatus(ok ? "copied results log" : "clipboard unavailable"));

  return (
    <Card
      title="Origin provenance"
      count={noteWindows.length + records.length + reportKeys.length + textKeys.length || undefined}
      defaultOpen={false}
    >
      {xUnrecovered && (
        <div
          style={{
            marginBottom: 10,
            fontSize: "var(--font-size-sm)",
            color: "var(--text-faint)",
            lineHeight: 1.4,
          }}
        >
          <span style={{ color: "var(--accent)" }}>⚠</span> X axis shows the row index — Origin's
          designated X column{xUnrecoveredName ? ` (“${xUnrecoveredName}”)` : ""} could not be
          decoded, so its values aren&rsquo;t available.
        </div>
      )}

      {noteWindows.length > 0 && (
        <div style={{ marginBottom: hasLog ? 10 : 0 }}>
          {noteWindows.map((w) => (
            <div key={w} style={{ marginBottom: 6 }}>
              <div
                style={{
                  fontSize: "var(--font-size-sm)",
                  color: "var(--text-faint)",
                  marginBottom: 2,
                }}
              >
                {w}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--font-size-sm)",
                  color: "var(--text-dim)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {notes![w]}
              </div>
            </div>
          ))}
        </div>
      )}

      {records.length > 0 ? (
        <div>
          {records.map((r, i) => {
            const sections = Object.entries(r.params).filter(([, kv]) => Object.keys(kv).length > 0);
            return (
              <details className="qz-provenance-row" key={i}>
                <summary>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-faint)" }}>
                    {r.timestamp}
                  </span>{" "}
                  <span style={{ color: "var(--text-dim)" }}>{r.operation || "(unnamed operation)"}</span>
                </summary>
                <div style={{ paddingLeft: 14, marginTop: 4 }}>
                  {sections.length > 0 ? (
                    sections.map(([section, kv]) => (
                      <div key={section} style={{ marginBottom: 6 }}>
                        {section && (
                          <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-faint)" }}>
                            {section}
                          </div>
                        )}
                        {Object.entries(kv).map(([k, v]) => (
                          <div className="qz-meta-row" key={k}>
                            <span className="qz-k" title={k}>
                              {k}
                            </span>
                            <span className="qz-v" title={formatMetaValue(v)}>
                              {formatMetaValue(v)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))
                  ) : (
                    <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-faint)" }}>
                      no parameters recorded
                    </span>
                  )}
                  {r.extra && r.extra.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      {r.extra.map((line, j) => (
                        <div key={j} style={{ fontSize: "var(--font-size-sm)", color: "var(--text-faint)" }}>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      ) : rawLog ? (
        <pre
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-sm)",
            color: "var(--text-dim)",
            maxHeight: 200,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
          }}
        >
          {rawLog}
        </pre>
      ) : null}

      {rawLog && (
        <Button size="sm" onClick={copyLog} style={{ marginTop: 6 }}>
          ⧉ Copy results log
        </Button>
      )}

      {reportSheets && (
        <ColumnStringsSection title="Report-sheet columns" cols={reportSheets} keys={reportKeys} />
      )}

      {textColumns && <ColumnStringsSection title="Text columns" cols={textColumns} keys={textKeys} />}
    </Card>
  );
}
