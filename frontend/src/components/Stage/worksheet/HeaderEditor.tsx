// In-place editor for a worksheet column's header rows — Long name, Units and
// Comments, Origin's three label rows (worksheet audit #12: none of them could
// be edited). Opens ON the header cell (double-click it, Shift+F2 from the
// cell cursor, or the column menu) as a small fixed popover so the three
// fields fit even when the header is narrow. Enter applies (one undo step,
// store/worksheetColumns.ts's setColumnHeader), Escape cancels; focus starts
// in Long Name and returns to the grid when it closes. A value column also
// lists the worksheet's user parameters (Temperature, Sample, ... —
// lib/userParams.ts): a value per parameter for THIS column, a "New parameter"
// pair, and a remove button per parameter (every column).

import { useEffect, useRef, useState } from "react";

import { columnMetaAt } from "../../../lib/columnmeta";
import { cleanSpec, cleanTags, type SpecLimits } from "../../../lib/columnSpecs";
import type { Dataset } from "../../../lib/types";
import { userParamRows, userParamValue } from "../../../lib/userParams";
import { applyHeaderEdit } from "../../../store/userParamActions";
import { useDialogFocus } from "../../overlays/useDialogFocus";

export interface HeaderEditTarget {
  col: number;
  x: number;
  y: number;
}

export default function HeaderEditor({
  ds,
  target,
  xName,
  xUnit,
  onClose,
}: {
  ds: Dataset;
  target: HeaderEditTarget;
  xName: string;
  xUnit: string;
  onClose: () => void;
}) {
  const { col } = target;
  const comment = ds.columnProps?.[col]?.comment ?? columnMetaAt(ds.data, col)?.comment ?? "";
  const [label, setLabel] = useState(col < 0 ? xName : (ds.data.labels[col] ?? ""));
  const [unit, setUnit] = useState(col < 0 ? xUnit : (ds.data.units[col] ?? ""));
  const [note, setNote] = useState(comment);
  // Spec limits and tags (G27, provisional, owner to confirm): typed as text,
  // applied only when valid; a blank clears. Sent only when changed.
  const oldSpec = ds.columnProps?.[col]?.spec;
  const oldTags = ds.columnProps?.[col]?.tags;
  const [spec, setSpec] = useState({ lsl: String(oldSpec?.lsl ?? ""), usl: String(oldSpec?.usl ?? ""), target: String(oldSpec?.target ?? "") });
  const [tagText, setTagText] = useState((oldTags ?? []).join(", "));
  const num = (t: string) => (t.trim() === "" ? undefined : Number(t));
  const bad = (t: string) => t.trim() !== "" && !Number.isFinite(Number(t));
  const nextSpec: SpecLimits | undefined = cleanSpec({ lsl: num(spec.lsl), usl: num(spec.usl), target: num(spec.target) });
  const specError =
    bad(spec.lsl) || bad(spec.usl) || bad(spec.target)
      ? "Spec limits must be numbers."
      : nextSpec?.lsl != null && nextSpec.usl != null && nextSpec.lsl > nextSpec.usl
        ? "LSL must not exceed USL."
        : "";
  const params = col >= 0 ? userParamRows(ds.data) : [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [p.name, userParamValue(params, p.name, col)])),
  );
  // Parameters marked with × are removed on Apply (Cancel keeps them), so a
  // remove never throws away the other edits typed here.
  const [removed, setRemoved] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const first = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // The shared dialog focus contract: focus in on open, Tab kept inside, and
  // focus back to the opener (the grid) when Apply / Cancel / Escape closes it.
  const restore = useDialogFocus(box, true);
  const close = () => {
    onClose();
    restore();
  };
  useEffect(() => first.current?.select(), []);
  // A click anywhere else closes it unapplied, like any popover.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  const name = col < 0 ? xName : (ds.data.labels[col] ?? `column ${col + 1}`);
  const apply = () => {
    if (specError) return;
    const specChanged = JSON.stringify(nextSpec ?? null) !== JSON.stringify(oldSpec ?? null);
    const nextTags = cleanTags(tagText);
    const tagsChanged = JSON.stringify(nextTags ?? null) !== JSON.stringify(oldTags ?? null);
    // One undo step for the header rows and every parameter edit together.
    applyHeaderEdit(ds.id, col, {
      label, unit,
      ...(note !== comment ? { comment: note } : {}),
      ...(specChanged ? { spec: nextSpec ?? null } : {}),
      ...(tagsChanged ? { tags: nextTags ?? null } : {}),
    }, {
      values,
      removed,
      ...(newName.trim() ? { added: { name: newName, value: newValue } } : {}),
    });
    close();
  };
  const field = (text: string, value: string, set: (v: string) => void, ref?: React.Ref<HTMLInputElement>, aria?: string, hint?: string) => (
    <label style={{ display: "grid", gridTemplateColumns: "84px 1fr", alignItems: "center", gap: 6 }}>
      <span title={text}>{text}</span>
      <input
        ref={ref}
        className="qz-input"
        aria-label={aria ?? `${text}, ${name}`}
        value={value}
        placeholder={hint}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <div
      role="dialog"
      aria-label={`Edit header of ${name}`}
      ref={box}
      className="qzk-header-editor"
      style={{
        position: "fixed",
        left: Math.max(8, Math.min(target.x, window.innerWidth - 300)),
        top: Math.max(8, Math.min(target.y, window.innerHeight - 330 - 34 * (params.length + 1))),
      }}
      onKeyDown={(e) => {
        e.stopPropagation(); // the grid's own keys must not act while typing here
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          apply();
        } else if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="qzk-ds-meta">Column header — {name}</div>
      {field("Long name", label, setLabel, first)}
      {field("Units", unit, setUnit)}
      {field("Comments", note, setNote)}
      {field("Tags", tagText, setTagText, undefined, `Tags, ${name}`, "comma-separated")}
      <div className="qzk-ds-meta">Spec limits (optional)</div>
      {field("LSL", spec.lsl, (v) => setSpec((o) => ({ ...o, lsl: v })), undefined, undefined, "lower limit")}
      {field("USL", spec.usl, (v) => setSpec((o) => ({ ...o, usl: v })), undefined, undefined, "upper limit")}
      {field("Target", spec.target, (v) => setSpec((o) => ({ ...o, target: v })), undefined, undefined, "nominal value")}
      {specError && <div role="alert" className="qzk-ds-meta" style={{ color: "var(--danger)" }}>{specError}</div>}
      {col >= 0 && (
        <>
          <div className="qzk-ds-meta">User parameters</div>
          {params.filter((p) => !removed.includes(p.name)).map((p) => (
            <div key={p.name} style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <div style={{ flex: 1 }}>{field(p.name, values[p.name] ?? "", (v) => setValues((o) => ({ ...o, [p.name]: v })), undefined, `Parameter ${p.name}, ${name}`)}</div>
              <button
                className="qz-btn"
                title={`Remove the parameter "${p.name}" from every column (when you press Apply)`}
                aria-label={`Remove parameter ${p.name}`}
                onClick={() => setRemoved((r) => [...r, p.name])}
              >
                ×
              </button>
            </div>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <input className="qz-input" placeholder="New parameter" aria-label={`New parameter name, ${name}`} value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="qz-input" placeholder="Value" aria-label={`New parameter value, ${name}`} value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          </div>
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <button className="qz-btn" onClick={close}>
          Cancel
        </button>
        <button className="qz-btn qz-primary" onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}
