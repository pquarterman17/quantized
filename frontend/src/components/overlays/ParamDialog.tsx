// Ported from fermiviewer frontend/src/components/overlays/ParamDialog.tsx.
// Promise-based parameter dialog: askParams(title, fields) resolves with typed
// values or null on cancel. Mount one <ParamDialog/> at the app root.

import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (title !== null) {
      const init: ParamValues = {};
      for (const f of fields) init[f.key] = f.default;
      setValues(init);
    }
  }, [title, fields]);

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
