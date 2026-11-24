// Quick Convert: a small file / folder chooser over the machine Quantized runs on
// (a web page cannot read paths from the OS dialog). Keyboard: Tab / arrows to a
// row, Enter opens a folder or ticks a file, Esc leaves the chooser (only it).

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { browseFolder, type BrowseEntry } from "../../../lib/api/convertQuick";
import { Button } from "../../primitives";
import { plainError, sizeText } from "./quickConvertModel";

interface Props {
  mode: "files" | "folder";
  /** Where to start; "" = the user's home folder. */
  start: string;
  onPick: (paths: string[]) => void;
  onCancel: () => void;
}

export default function PathChooser({ mode, start, onPick, onCancel }: Props) {
  const [here, setHere] = useState<{ path: string; parent: string | null; entries: BrowseEntry[] } | null>(null);
  const [typed, setTyped] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);

  const go = useCallback(async (path: string) => {
    try {
      const r = await browseFolder(path);
      setHere(r);
      setTyped(r.path);
      setError(null);
    } catch (e) {
      setError(plainError(e instanceof Error ? e.message : String(e)));
    }
  }, []);

  useEffect(() => {
    void go(start);
  }, [go, start]);
  useEffect(() => root.current?.focus(), []);

  const open = (e: BrowseEntry): void => {
    if (e.is_dir) void go(e.path);
    else if (mode === "files") setChosen((c) => (c.includes(e.path) ? c.filter((p) => p !== e.path) : [...c, e.path]));
  };
  const rows = (here?.entries ?? []).filter((e) => mode === "files" || e.is_dir);

  return (
    <div
      ref={root}
      className="qzk-qc-chooser"
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <h3 id={titleId}>{mode === "files" ? "Choose files to convert" : "Choose the output folder"}</h3>
      <form
        className="qzk-qc-folder"
        onSubmit={(e) => {
          e.preventDefault();
          void go(typed);
        }}
      >
        <Button size="sm" type="button" disabled={!here?.parent} onClick={() => here?.parent && void go(here.parent)} aria-label="Up one folder">
          ↑ Up
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => void go("")}>
          Home
        </Button>
        <input className="qz-input" aria-label="Folder path" value={typed} spellCheck={false} onChange={(e) => setTyped(e.target.value)} />
        <Button size="sm" type="submit">
          Go
        </Button>
      </form>
      {error && (
        <p role="alert" className="qzk-qc-note qzk-qc-danger">
          {error}
        </p>
      )}
      <ul className="qzk-qc-list" aria-label="Folder contents">
        {rows.length === 0 && !error && <li className="qzk-qc-dim qzk-qc-empty">{mode === "files" ? "No files here." : "No sub-folders here."}</li>}
        {rows.map((e) => (
          <li key={e.path}>
            <button
              type="button"
              className="qzk-qc-entry"
              aria-pressed={!e.is_dir && mode === "files" ? chosen.includes(e.path) : undefined}
              onClick={() => open(e)}
              onDoubleClick={() => {
                if (!e.is_dir && mode === "files") onPick([e.path]);
              }}
            >
              <span aria-hidden="true">{e.is_dir ? "▸" : chosen.includes(e.path) ? "☑" : "☐"}</span>
              <span className="qzk-qc-entry-name">{e.name}</span>
              <span className="qzk-qc-dim">{e.is_dir ? "folder" : sizeText(e.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="qzk-qc-actions">
        {mode === "files" ? (
          <Button variant="primary" size="sm" disabled={!chosen.length} onClick={() => onPick(chosen)}>
            Add {chosen.length || ""} file{chosen.length === 1 ? "" : "s"}
          </Button>
        ) : (
          <Button variant="primary" size="sm" disabled={!here} onClick={() => here && onPick([here.path])}>
            Use this folder
          </Button>
        )}
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
