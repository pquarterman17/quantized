import { useEffect, useState } from "react";

import { querySqlite } from "../../../lib/api";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, NumberField } from "../../primitives";

export const SHOW_SQLITE_QUERY = "qz:show-sqlite-query";

let sequence = 0;

export default function SqliteQueryDialog() {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("SELECT * FROM measurements LIMIT 1000");
  const [xColumn, setXColumn] = useState("");
  const [maxRows, setMaxRows] = useState(100_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(SHOW_SQLITE_QUERY, show);
    return () => window.removeEventListener(SHOW_SQLITE_QUERY, show);
  }, []);

  if (!open) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await querySqlite({
        path: path.trim(),
        query: query.trim(),
        ...(xColumn.trim() ? { x_column: xColumn.trim() } : {}),
        max_rows: maxRows,
      });
      const base = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "SQLite query";
      addDataset({ id: `sqlite-${Date.now().toString(36)}-${++sequence}`, name: `${base} (query)`, data });
      setStatus(`loaded ${data.time.length} rows from SQLite`);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "SQLite query failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolWindow id="sqlite-query" title="SQLite query" width={520} onClose={() => setOpen(false)}>
      <div style={{ display: "grid", gap: 8, padding: 10 }}>
        <label className="qzk-field-lbl" htmlFor="sqlite-path">Database file path</label>
        <input id="sqlite-path" className="qz-input" value={path} onChange={(event) => setPath(event.target.value)} placeholder="C:\\data\\measurements.sqlite" />
        <label className="qzk-field-lbl" htmlFor="sqlite-sql">SELECT or WITH query</label>
        <textarea id="sqlite-sql" className="qz-input" rows={7} value={query} onChange={(event) => setQuery(event.target.value)} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label className="qzk-field-lbl" htmlFor="sqlite-x">X column</label>
          <input id="sqlite-x" className="qz-input" value={xColumn} onChange={(event) => setXColumn(event.target.value)} placeholder="optional; otherwise row number" style={{ width: 180 }} />
          <label className="qzk-field-lbl">Maximum rows</label>
          <NumberField value={String(maxRows)} width={90} onChange={(value) => setMaxRows(Math.max(1, Math.min(1_000_000, Number(value) || 1)))} />
        </div>
        <div className="qz-hint">Read-only connection · SELECT/CTE only · 5-second hard timeout · path confined to allowed roots · the database&rsquo;s contents are never modified (a WAL-mode database may gain <code>-wal</code>/<code>-shm</code> sidecar files, which SQLite needs even to read it).</div>
        {error && <div role="alert" style={{ color: "var(--danger)" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={busy || !path.trim() || !query.trim()} onClick={() => void run()}>{busy ? "Running…" : "Run query"}</Button>
        </div>
      </div>
    </ToolWindow>
  );
}

