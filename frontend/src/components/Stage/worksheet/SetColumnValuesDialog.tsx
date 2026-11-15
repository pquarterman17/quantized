// Set Column Values (gap audit 4, G3) — Origin's dialog, replacing the bare
// two-field prompt: pick the column to write (an existing one or a new one),
// build the formula with the function / column / operator browsers (each
// inserts at the cursor), limit it to a row range, and watch the first rows'
// current and new values update as you type, with any error shown inline.
// Lazy: WorksheetPane mounts it (its own chunk) only while it is open.
//
// What is kept where — a formula on a new or computed column, values only on
// a data column — is lib/setColumnValues.ts's header; the dialog shows the
// matching sentence for the chosen target so nobody expects a data column to
// recalculate. Apply is one undo step (store/setColumnValuesRun.ts).

import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useEscapeSurface } from "../../../lib/escapeStack";
import type { Dataset } from "../../../lib/types";
import { applySetColumnValues } from "../../../store/setColumnValuesRun";
import { useApp } from "../../../store/useApp";
import { Button, Select } from "../../primitives";
import { useDialogFocus } from "../../overlays/useDialogFocus";
import {
  baseCountOf,
  columnEntries,
  evaluateFormula,
  FUNCTION_ENTRIES,
  insertAt,
  OPERATOR_ENTRIES,
  parseRange,
  previewRows,
  sameFormula,
  targetKind,
  targetNote,
  targetOptions,
  unwrapRange,
  writable,
  type InsertEntry,
  type ScvTarget,
} from "../../../lib/setColumnValues";

export interface SetColumnValuesDialogProps {
  ds: Dataset;
  target: ScvTarget;
  xName: string;
  onClose: () => void;
}

const CELL = { textAlign: "right", padding: "0 14px 0 0" } as const;
const fmt = (v: number | null): string => (v === null ? "" : Number.isNaN(v) ? "–" : String(Number(v.toPrecision(10))));

/** The name and formula a target starts with: a computed column's own. */
function seedFor(ds: Dataset, target: ScvTarget): { name: string; expr: string; from: string; to: string } | null {
  if (target.kind === "new") return { name: "", expr: "", from: "", to: "" };
  const f = target.col >= baseCountOf(ds) ? ds.formulas?.[target.col - baseCountOf(ds)] : undefined;
  if (!f) return null;
  return { name: f.name, ...unwrapRange(f.expr) };
}

function Browser({ label, entries, onPick }: { label: string; entries: InsertEntry[]; onPick: (e: InsertEntry) => void }) {
  return (
    <Select
      aria-label={label}
      value=""
      options={[{ value: "", label }, ...entries.map((e, i) => ({ value: String(i), label: e.label }))]}
      onChange={(e) => {
        const entry = entries[Number(e.target.value)];
        if (e.target.value !== "" && entry) onPick(entry);
      }}
    />
  );
}

export default function SetColumnValuesDialog({ ds, target: initial, xName, onClose }: SetColumnValuesDialogProps) {
  const titleId = useId();
  const ids = { formula: useId(), problem: useId(), note: useId(), name: useId(), from: useId(), to: useId() };
  const dialogRef = useRef<HTMLDivElement>(null);
  const formulaRef = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const datasets = useApp((s) => s.datasets);

  const [target, setTarget] = useState<ScvTarget>(initial);
  const seed = seedFor(ds, initial);
  const [name, setName] = useState(seed?.name ?? "");
  const [expr, setExpr] = useState(seed?.expr ?? "");
  const [from, setFrom] = useState(seed?.from ?? "");
  const [to, setTo] = useState(seed?.to ?? "");
  const [propagate, setPropagate] = useState(false);
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
  // The formula is the first decision: land there, cursor at the end.
  useEffect(() => {
    const el = formulaRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // After a browser insert: focus back in the formula, cursor where it belongs.
  useLayoutEffect(() => {
    const el = formulaRef.current;
    if (caret.current === null || !el) return;
    el.focus();
    el.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [expr]);

  const kind = targetKind(ds, target);
  const rows = ds.data.time.length;
  const range = parseRange(from, to, rows);
  const deferredExpr = useDeferredValue(expr);
  const evaluation = useMemo(() => evaluateFormula(ds, datasets, deferredExpr), [ds, datasets, deferredExpr]);
  const preview = "error" in range || evaluation.error !== undefined ? [] : previewRows(ds, target, evaluation.values, range);
  const canWrite = writable(kind);
  const problem = !canWrite
    ? targetNote(kind, ds)
    : "error" in range
        ? range.error
        : expr !== deferredExpr || expr.trim() === ""
          ? null // still evaluating what was just typed, or nothing typed yet
          : (evaluation.error ?? null);
  // A computed column's σ partner follows a range change, not a new formula.
  const current = target.kind === "column" && kind === "computed" ? ds.formulas?.[target.col - baseCountOf(ds)] : undefined;
  const sigma = current?.derived?.sigma;
  const unbindsSigma = !!sigma && !!current && expr.trim() !== "" && !sameFormula(unwrapRange(current.expr).expr, expr);
  const canApply = !busy && problem === null && expr.trim() !== "" && expr === deferredExpr;

  const pickTarget = (value: string) => {
    const next: ScvTarget = value === "new" ? { kind: "new" } : { kind: "column", col: Number(value) };
    setTarget(next);
    setApplyError(null);
    const s = seedFor(ds, next);
    // A computed column brings its own formula; any other target keeps the draft.
    if (s && next.kind === "column") {
      setName(s.name);
      setExpr(s.expr);
      setFrom(s.from);
      setTo(s.to);
    } else if (next.kind === "new") setName("");
  };

  const insert = (entry: InsertEntry) => {
    const el = formulaRef.current;
    const start = el?.selectionStart ?? expr.length;
    const end = el?.selectionEnd ?? expr.length;
    const r = insertAt(expr, start, end, entry);
    caret.current = r.caret;
    setExpr(r.text);
  };

  const apply = async () => {
    if (!canApply || "error" in range) return;
    setBusy(true);
    setApplyError(null);
    const r = await applySetColumnValues(ds.id, { target, name, expr, range, propagate });
    setBusy(false);
    if (r.ok) close();
    else setApplyError(r.error);
  };

  const shown = applyError ?? problem;
  const columnName = target.kind === "new" ? name.trim() || "New column" : target.col < 0 ? xName || "X" : ds.data.labels[target.col];

  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={canWrite ? ids.note : ids.problem}
        ref={dialogRef}
        tabIndex={-1}
        style={{ width: "min(640px, 94vw)", top: "8%", maxHeight: "86vh" }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const inFormula = e.target === formulaRef.current;
          if (e.key === "Enter" && (!inFormula || e.ctrlKey || e.metaKey) && (e.target as HTMLElement).tagName !== "SELECT" && (e.target as HTMLElement).tagName !== "BUTTON") {
            e.preventDefault();
            void apply();
          }
          // Escape bubbles to the modal escape surface (see SplitDatasetDialog).
          if (e.key !== "Escape") e.stopPropagation();
        }}
      >
        <h2 id={titleId}>Set Column Values — {ds.name}</h2>
        <div className="qz-ws-row">
          <span className="k">Into</span>
          <Select
            aria-label="Into column"
            value={target.kind === "new" ? "new" : String(target.col)}
            options={targetOptions(ds, xName)}
            onChange={(e) => pickTarget(e.target.value)}
          />
        </div>
        {(target.kind === "new" || kind === "computed") && (
          <div className="qz-ws-row">
            <label className="k" htmlFor={ids.name}>
              Column name
            </label>
            <input id={ids.name} className="qz-input" value={name} placeholder="(the formula)" onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div className="qz-ws-row">
          <span className="k">Rows</span>
          <label htmlFor={ids.from}>From</label>
          <input id={ids.from} className="qz-input" inputMode="numeric" style={{ width: 80 }} value={from} placeholder="1" onChange={(e) => setFrom(e.target.value)} />
          <label htmlFor={ids.to}>To</label>
          <input id={ids.to} className="qz-input" inputMode="numeric" style={{ width: 80 }} value={to} placeholder={String(rows)} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="qz-ws-row" style={{ flexWrap: "wrap" }}>
          <Browser label="Insert function…" entries={FUNCTION_ENTRIES} onPick={insert} />
          <Browser label="Insert column…" entries={columnEntries(ds, xName)} onPick={insert} />
          <Browser label="Insert operator…" entries={OPERATOR_ENTRIES} onPick={insert} />
        </div>
        <label htmlFor={ids.formula} className="qzk-field-lbl">
          {columnName} =
        </label>
        <textarea
          id={ids.formula}
          ref={formulaRef}
          className="qz-input"
          rows={3}
          spellCheck={false}
          style={{ fontFamily: "var(--font-mono)", resize: "vertical", minHeight: "4.5em" }}
          value={expr}
          placeholder="e.g. A * 1e-4, round(B, 2), interp(x, C, D)"
          aria-invalid={shown ? true : undefined}
          aria-describedby={shown ? ids.problem : undefined}
          onChange={(e) => {
            setExpr(e.target.value);
            setApplyError(null);
          }}
        />
        {target.kind === "new" && (
          <label className="qz-ws-row">
            <input type="checkbox" checked={propagate} onChange={(e) => setPropagate(e.target.checked)} />± errors: also add the propagated σ, bound as this column&rsquo;s error
          </label>
        )}
        {canWrite && (
          <div id={ids.note} className="qzk-ds-meta" style={{ whiteSpace: "normal" }}>
            {targetNote(kind, ds)}
            {unbindsSigma && ` Changing the formula (not just the rows) unbinds its error column "${sigma}".`}
          </div>
        )}
        {shown && (
          <div id={ids.problem} role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--danger)" }}>
            {shown}
          </div>
        )}
        {preview.length > 0 && (
          <table className="qzk-ds-meta" style={{ fontFamily: "var(--font-mono)", borderCollapse: "collapse", alignSelf: "flex-start" }}>
            <caption style={{ textAlign: "left" }}>
              Preview — the first {preview.length} row{preview.length === 1 ? "" : "s"} of {"error" in range ? 0 : range.to - range.from + 1}
            </caption>
            <thead>
              <tr>
                <th scope="col" style={CELL}>Row</th>
                {target.kind !== "new" && <th scope="col" style={CELL}>Now</th>}
                <th scope="col" style={CELL}>New</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((p) => (
                <tr key={p.row}>
                  <td style={CELL}>{p.row}</td>
                  {target.kind !== "new" && <td style={CELL}>{fmt(p.before)}</td>}
                  <td style={CELL}>{fmt(p.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="qz-btn-row">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!canApply} aria-describedby={!canApply && shown ? ids.problem : undefined} onClick={() => void apply()}>
            {busy ? "Applying…" : target.kind === "new" ? "Add column" : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
