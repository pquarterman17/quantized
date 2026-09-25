// Ported from fermiviewer frontend/src/components/overlays/ParamDialog.tsx.
// Promise-based parameter dialog: askParams(title, fields) resolves with typed
// values or null on cancel.
//
// This is the dialog's BODY, a lazy chunk since bundle diet slice 8
// (plans/BUNDLE_HEADROOM.md). `askParams` and its store live in
// `store/paramDialog.ts`; mount the thin gate `ParamDialog.tsx` at the app
// root, which loads this module on the first ask. Never import this file
// statically from an eagerly reachable module -- `architecture.test.ts`'s
// SEAMS guard fails the build if you do.

import { useId, useRef, useState } from "react";

import { coerceParams, type ParamField, type ParamValues } from "../../lib/params";
import { useParamDialog } from "../../store/paramDialog";
import { ParamFieldRow } from "./ParamFields";
import { useDialogFocus } from "./useDialogFocus";
import { Button } from "../primitives";

export default function ParamDialog() {
  const title = useParamDialog((s) => s.title);
  const fields = useParamDialog((s) => s.fields);
  const resolve = useParamDialog((s) => s.resolve);
  const close = useParamDialog((s) => s.close);
  const [values, setValues] = useState<ParamValues>({});
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  // P3.3. Escape/Enter live on the dialog box's React `onKeyDown`, so they
  // only work while focus is INSIDE it. `autoFocus` covers that for a
  // number/text first row — but not for a `select`/`boolean` first row, and
  // not at all for a dialog with zero fields (askParams is also used for
  // confirm-shaped prompts), where focus stayed on the opener behind the
  // backdrop and Escape did nothing. This puts focus on the first control
  // whenever nothing else claimed it, traps Tab inside, and hands focus back
  // to the opener on close.
  useDialogFocus(dialogRef, title !== null);

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
        role="dialog"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <h2 id={titleId}>{title}</h2>
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
