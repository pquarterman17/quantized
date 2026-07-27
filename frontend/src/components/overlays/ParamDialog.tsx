// Ported from fermiviewer frontend/src/components/overlays/ParamDialog.tsx.
// Promise-based parameter dialog: askParams(title, fields) resolves with typed
// values or null on cancel. Mount one <ParamDialog/> at the app root.

import { useState } from "react";
import { create } from "zustand";

import { coerceParams, type ParamField, type ParamValues } from "../../lib/params";
import { ParamFieldRow } from "./ParamFields";
import { Button } from "../primitives";

export type { ParamField, ParamValues } from "../../lib/params";

interface DialogState {
  title: string | null;
  fields: ParamField[];
  resolve: ((v: ParamValues | null) => void) | null;
  open: (
    title: string,
    fields: ParamField[],
    resolve: (v: ParamValues | null) => void,
  ) => void;
  close: () => void;
}

const useParamDialog = create<DialogState>((set) => ({
  title: null,
  fields: [],
  resolve: null,
  open: (title, fields, resolve) => set({ title, fields, resolve }),
  close: () => set({ title: null, fields: [], resolve: null }),
}));

/** Open the dialog; resolves with the values or null on cancel. */
export function askParams(
  title: string,
  fields: ParamField[],
): Promise<ParamValues | null> {
  return new Promise((resolve) => {
    useParamDialog.getState().open(title, fields, resolve);
  });
}

export default function ParamDialog() {
  const title = useParamDialog((s) => s.title);
  const fields = useParamDialog((s) => s.fields);
  const resolve = useParamDialog((s) => s.resolve);
  const close = useParamDialog((s) => s.close);
  const [values, setValues] = useState<ParamValues>({});

  // Reset `values` to this dialog's field defaults SYNCHRONOUSLY, during
  // render, rather than in a useEffect (react.dev "adjusting state when a
  // prop changes"). `fields` is a fresh array literal per askParams() call,
  // so `fields !== initializedFields` is true exactly once per open.
  //
  // A useEffect-based reset used to run here instead — it fires strictly
  // AFTER the first commit/paint, leaving a window where `values` still
  // holds the PREVIOUS dialog's leftovers (or the initial `{}`). A fast field
  // edit (a real user typing quickly, or — reliably, at 1M-row render scale —
  // Playwright's scripted selectOption()) can land inside that window: the
  // edit's `setValues({...values, [key]: v})` and the effect's
  // `setValues(init)` both close over the SAME stale `values`, and `useState`
  // REPLACES rather than merges, so whichever call lands second wins outright.
  // When the edit wins, every OTHER field's key is missing from `values` —
  // exportFigureCommand.ts's `(params.x_label as string).trim()` then threw
  // on `undefined` before exportActive's own try/catch ever ran, and that
  // rejection was swallowed by store/commands.ts's runAction (P0.4 finding
  // 15, 2026-07-27: the "Export figure…" SVG dialog hung with zero network
  // activity, no toast, no console error — traced to exactly this race).
  // Resetting during render means the FIRST commit already has full,
  // race-free defaults, so there is no window left for an edit to land in.
  const [initializedFields, setInitializedFields] = useState<ParamField[] | null>(null);
  if (title !== null && fields !== initializedFields) {
    const init: ParamValues = {};
    for (const f of fields) init[f.key] = f.default;
    setValues(init);
    setInitializedFields(fields);
  }

  if (title === null) return null;

  const finish = (v: ParamValues | null) => {
    resolve?.(v);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") finish(coerceParams(values, fields));
    if (e.key === "Escape") finish(null);
    e.stopPropagation();
  };

  return (
    <div className="qz-overlay-backdrop" onMouseDown={() => finish(null)}>
      <div
        className="qzk-glass qz-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <h2>{title}</h2>
        {fields.map((f, i) => (
          <ParamFieldRow
            key={f.key}
            field={f}
            value={values[f.key]}
            autoFocus={i === 0}
            onChange={(v) => setValues({ ...values, [f.key]: v })}
          />
        ))}
        <div className="qz-btn-row">
          <Button onClick={() => finish(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => finish(coerceParams(values, fields))}>
            Run
          </Button>
        </div>
      </div>
    </div>
  );
}
