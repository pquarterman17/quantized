// Inspector card: dedicated Origin provenance surface — the notes-window free
// text (`metadata.origin_notes`) and the parsed results log (fits, worksheet
// ops — `metadata.origin_results_log_records`, plan item 22) that Origin
// projects carry alongside their data. Split out of the generic Metadata card
// (io/origin_project/notes.py) because a raw JSON blob of a multi-record log
// is unreadable there; here each record collapses to a one-line summary that
// expands to its Input/Output params. Falls back to the raw log text
// (`metadata.origin_results_log`) when the structured parse isn't present.

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

export default function OriginProvenanceCard({ active }: { active: Dataset | null }) {
  const setStatus = useApp((s) => s.setStatus);
  const meta = (active?.data.metadata ?? {}) as Record<string, unknown>;

  const notes = isNotesMap(meta.origin_notes) ? meta.origin_notes : null;
  const noteWindows = notes ? Object.keys(notes).filter((w) => notes[w]?.trim()) : [];

  const rawLog = typeof meta.origin_results_log === "string" ? meta.origin_results_log : "";
  const records = Array.isArray(meta.origin_results_log_records)
    ? meta.origin_results_log_records.filter(isRecord)
    : [];

  const hasLog = records.length > 0 || rawLog.length > 0;
  if (!active || (noteWindows.length === 0 && !hasLog)) return null;

  const copyLog = () =>
    copyText(rawLog).then((ok) => setStatus(ok ? "copied results log" : "clipboard unavailable"));

  return (
    <Card title="Origin provenance" count={noteWindows.length + records.length || undefined} defaultOpen={false}>
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
    </Card>
  );
}
