// Find in project, "In folder…" scope (G23): search a folder of SAVED projects
// without opening them ("which project had the sample 2311-B fit?"). Results
// are grouped by file; "Open" goes through the existing Recent Projects reopen
// (commands/recentProjectReopen.ts), so it keeps that path's replace-confirm,
// consent and error handling. Unreadable files are listed, never hidden.

import { useState } from "react";

import { searchProjectFolder, type FolderSearchResponse } from "../../../lib/api/projectSearch";
import { hasDesktopShell, pickNativeDirectory } from "../../../lib/desktopBridge";
import { plural } from "../../../lib/plural";
import { NumberField } from "../../primitives/NumberField";

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

const TRUNCATED: Record<string, string> = {
  max_files: "Stopped at the file limit; narrow the folder to see the rest.",
  timeout: "Stopped at the time limit; narrow the folder to see the rest.",
};

export default function FolderSearch({ query }: { query: string }) {
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<FolderSearchResponse | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setRes(await searchProjectFolder(folder.trim(), query.trim()));
    } catch (e) {
      setRes(null);
      setError(e instanceof Error ? e.message : "search failed");
    } finally {
      setBusy(false);
    }
  };
  const open = async (path: string) => {
    const { openRecentProject } = await import("../../../commands/recentProjectReopen");
    await openRecentProject(baseName(path), path);
  };
  const browse = async () => {
    const picked = await pickNativeDirectory(folder || undefined);
    if (picked) setFolder(picked);
  };
  const ready = folder.trim() !== "" && query.trim() !== "" && !busy;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <NumberField numeric={false} value={folder} width={hasDesktopShell() ? 230 : 290}
          placeholder="folder of saved projects (.dwk)" title="Folder to search; its sub-folders are searched too"
          onChange={setFolder} />
        {hasDesktopShell() && <button className="qz-btn" onClick={() => void browse()}>Browse…</button>}
        <button className="qz-btn" disabled={!ready} onClick={() => void run()}>Search</button>
      </div>
      {busy && <div className="qzk-ds-meta" style={{ marginTop: 6 }}>Searching…</div>}
      {error && <div className="qzk-ds-meta" role="alert" style={{ marginTop: 6, color: "var(--danger)" }}>{error}</div>}
      {res && !busy && (
        <div style={{ marginTop: 6 }}>
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
            {res.matches.length} project{plural(res.matches.length)} match · {res.scanned} file{plural(res.scanned)} scanned
          </div>
          {res.truncated && <div className="qzk-ds-meta" role="status">{TRUNCATED[res.truncated] ?? res.truncated}</div>}
          {res.matches.map((m) => (
            <div key={m.path} style={{ marginTop: 6 }} data-testid="folder-match">
              <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                <span className="qzk-menu-trunc" style={{ flex: 1, fontWeight: 600 }} title={m.path}>{m.relpath}</span>
                <span className="qz-shortcut">{m.hit_count} hit{plural(m.hit_count)}</span>
                <button className="qz-btn" onClick={() => void open(m.path)}>Open</button>
              </div>
              {m.hits.map((h, i) => (
                <div key={i} className="qzk-ds-meta" style={{ display: "flex", gap: 6 }}>
                  <span className="qz-shortcut" style={{ width: 46, flex: "0 0 auto" }}>{h.kind}</span>
                  <span className="qzk-menu-trunc" style={{ flex: 1 }} title={h.location}>{h.snippet} <span style={{ color: "var(--text-faint)" }}>· {h.location}</span></span>
                </div>
              ))}
            </div>
          ))}
          {res.skipped.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary className="qzk-ds-meta">{res.skipped.length} file{plural(res.skipped.length)} skipped</summary>
              {res.skipped.map((s) => (
                <div key={s.path} className="qzk-ds-meta" title={s.path}>{baseName(s.path)}: {s.reason}</div>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
