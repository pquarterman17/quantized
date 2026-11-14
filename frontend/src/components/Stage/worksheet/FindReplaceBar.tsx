// Worksheet Find / Replace bar (N4): Ctrl+F finds, Ctrl+H also replaces, in
// the focused worksheet. Lazy-loaded by WorksheetPane. The matching and the
// edit construction are pure (lib/worksheetFind.ts); a replace goes through the
// store's `setCellBlock`, so it is ONE undo step however many cells change, and
// a re-derived (read-only) sheet refuses with the same notice every other edit
// path shows.

import { useEffect, useMemo, useRef, useState } from "react";

import { editRefusalNotice, isRederived } from "../../../lib/rederived";
import type { Dataset } from "../../../lib/types";
import { findCells, replaceCells, type FindCell, type FindOptions } from "../../../lib/worksheetFind";
import { useApp } from "../../../store/useApp";

export interface FindSelection {
  rows: ReadonlySet<number>;
  cols: ReadonlySet<number>;
}

export interface FindReplaceBarProps {
  ds: Dataset;
  /** The visible rows in display order (filter + sort). */
  order: readonly number[];
  /** Count of non-computed value columns; matches beyond it are read-only. */
  writableCols: number;
  /** The cells / rows + columns currently selected, or null for none. */
  selection: FindSelection | null;
  /** Show the Replace row (Ctrl+H). */
  replace: boolean;
  /** Bumped by every Ctrl+F / Ctrl+H, to pull focus back into Find. */
  focusTick: number;
  onGoTo: (row: number, col: number) => void;
  onClose: () => void;
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "es"}`;

export default function FindReplaceBar({ ds, order, writableCols, selection, replace, focusTick, onGoTo, onClose }: FindReplaceBarProps) {
  const setCellBlock = useApp((s) => s.setCellBlock);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeCell, setWholeCell] = useState(false);
  const [inSelection, setInSelection] = useState(false);
  const [insideNumbers, setInsideNumbers] = useState(false);
  /** Replace all inside numbers asks once, showing what it will do. */
  const [pending, setPending] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState("");
  const findRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
  }, [focusTick]);

  const opts: FindOptions = { query, matchCase, wholeCell, insideNumbers };
  const scoped = inSelection && selection ? selection : null;
  const hits = useMemo(
    () => findCells(ds.data, { query, matchCase, wholeCell }, order, scoped ?? {}),
    [ds.data, query, matchCase, wholeCell, order, scoped],
  );
  const current = hits.length ? Math.min(index, hits.length - 1) : -1;
  const at = current >= 0 ? hits[current] : null;
  useEffect(() => {
    if (at) onGoTo(at.row, at.col);
    // Move the cursor when the CURRENT MATCH changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at?.row, at?.col]);

  const step = (d: number) => {
    if (hits.length) setIndex((current + d + hits.length) % hits.length);
  };

  useEffect(() => setPending(null), [query, replacement, matchCase, wholeCell, insideNumbers, inSelection, ds.data]);

  const apply = (targets: readonly FindCell[], keepIndex: boolean) => {
    if (isRederived(ds)) {
      setNote(editRefusalNotice(ds));
      return;
    }
    const r = replaceCells(ds.data, targets, opts, replacement, writableCols);
    if (r.error) {
      setNote(r.error);
      return;
    }
    if (!keepIndex && !wholeCell && insideNumbers && r.edits.length > 0 && pending === null) {
      const msg = `Will change ${r.edits.length} cell${r.edits.length === 1 ? "" : "s"}, first: ${r.first}. Press Replace all again to confirm.`;
      setPending(msg);
      setNote(msg);
      return;
    }
    if (r.edits.length === 0) {
      setNote(r.readOnly ? "those cells are in computed columns, which are read-only" : "nothing could be replaced");
      return;
    }
    setCellBlock(ds.id, r.edits, "replace cells");
    const extra = [r.skipped ? `${r.skipped} left (the result is not a number)` : "", r.readOnly ? `${r.readOnly} in computed columns left` : ""].filter(Boolean);
    setNote(`replaced ${r.edits.length} cell${r.edits.length === 1 ? "" : "s"}${extra.length ? ` — ${extra.join(", ")}` : ""} (Ctrl+Z undoes it)`);
    if (!keepIndex) setIndex(0);
    // A replacement that still contains the query leaves that cell matching:
    // step past it so Replace never sticks on one cell.
    else if (!wholeCell && replacement.toLowerCase().includes(query.toLowerCase())) setIndex((i) => i + 1);
  };

  const onFindKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  return (
    <div
      role="search"
      aria-label="Find and replace"
      style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
    >
      <input
        ref={findRef}
        className="qz-input"
        style={{ width: 150 }}
        aria-label="Find"
        placeholder="Find"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
          setNote("");
        }}
        onKeyDown={onFindKey}
      />
      {replace && (
        <input
          className="qz-input"
          style={{ width: 150 }}
          aria-label="Replace with"
          placeholder="Replace with"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
      )}
      <label className="qzk-field-lbl" style={{ margin: 0 }}>
        <input type="checkbox" aria-label="Match case" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
      </label>
      <label className="qzk-field-lbl" style={{ margin: 0 }}>
        <input type="checkbox" aria-label="Match whole cell" checked={wholeCell} onChange={(e) => setWholeCell(e.target.checked)} /> Whole cell
      </label>
      <label className="qzk-field-lbl" style={{ margin: 0 }}>
        <input type="checkbox" aria-label="Selection only" disabled={!selection} checked={inSelection && !!selection} onChange={(e) => setInSelection(e.target.checked)} /> Selection only
      </label>
      <label className="qzk-field-lbl" style={{ margin: 0 }}>
        <input type="checkbox" aria-label="Replace inside numbers (edits digits)" checked={insideNumbers} onChange={(e) => setInsideNumbers(e.target.checked)} /> Replace inside numbers (edits digits)
      </label>
      <span className="qzk-ds-meta" aria-live="polite">{query || wholeCell ? plural(hits.length, "match") : ""}</span>
      <button className="qz-btn qz-sm" aria-label="Find previous" disabled={!hits.length} onClick={() => step(-1)}>↑</button>
      <button className="qz-btn qz-sm" aria-label="Find next" disabled={!hits.length} onClick={() => step(1)}>↓</button>
      {replace && (
        <>
          <button className="qz-btn qz-sm" disabled={!at} onClick={() => at && apply([at], true)}>Replace</button>
          <button className="qz-btn qz-sm" disabled={!hits.length} onClick={() => apply(hits, false)}>Replace all</button>
        </>
      )}
      <button className="qz-btn qz-ghost qz-sm" aria-label="Close find" onClick={onClose}>×</button>
      <span role="status" className="qzk-ds-meta" style={{ flexBasis: "100%", color: "var(--text-faint)" }}>{note}</span>
    </div>
  );
}
