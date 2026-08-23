// Reference-line properties for the canonical Publication Preview draft
// (F2.3d): per-line value and remove, plus an axis+value Add form -- the same
// `RefLine` operations `Inspector/RefLinesCard.tsx` offers on the Stage
// (add / remove / drag-to-move, which commits `updateRefLine`'s value), now
// reachable on the detached draft without touching the Stage. The F2.3b/
// F2.3c precedent applied to reference lines.
//
// Reference lines already RENDER in the publication preview and every export
// (the 2026-08-11 figure_decor.py slice); before this panel they were the
// only visible element of the figure with no way to adjust them from inside
// the preview -- and reaching for the Stage's own card is the one action that
// invalidates the open session (see the drift-subscription fix). That is the
// gap this closes.
//
// AXIS is read-only per row, shown in the row label. Nothing in this app
// flips an existing line's axis after it is created -- RefLinesCard picks an
// axis at Add time and never changes it -- so offering that only in this
// detached panel would be a one-sided divergence, the same call F2.3c made
// for shape `kind`. Add DOES belong here, unlike shapes: a reference line is
// fully specified by an axis and a number, so it needs no live canvas to draw
// on; it is the identical two-field form the Stage card uses.

import { useRef, useState } from "react";

import { deriveRefLineRows } from "./canonicalRefLines";
import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../../lib/focusGuard";
import type { RefLine } from "../../../lib/types";
import { IconButton } from "../../primitives/IconButton";
import { NumberField } from "../../primitives/NumberField";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { Button } from "../../primitives";
import PropertyNumberField from "./PropertyNumberField";

export default function RefLinePropertiesPanel({
  refLines,
  onValue,
  onAdd,
  onRemove,
}: {
  /** The draft's reference lines, in their own array order. Rows (axis-scoped
   *  display labels) derive from this same array -- see canonicalRefLines.ts. */
  refLines: readonly RefLine[];
  onValue: (id: string, value: number) => void;
  onAdd: (axis: RefLine["axis"], value: number) => void;
  onRemove: (id: string) => void;
}) {
  const [axis, setAxis] = useState<RefLine["axis"]>("x");
  const [draft, setDraft] = useState("0");
  // Focus-safety anchor (lib/focusGuard) — a remove ✕ below unmounts its own
  // row; without this, focus falls to <body> and a follow-up Delete
  // keystroke deletes the ACTIVE DATASET instead (see focusGuard's doc).
  const containerRef = useRef<HTMLDivElement>(null);
  const parsed = Number(draft);
  // Same validity rule the store enforces (useApp's addRefLine is called only
  // for a finite value): an Inf/NaN line renders nowhere and would serialize
  // as `null` over the export wire, so the button explains itself rather than
  // accepting a no-op.
  const addReason: string | null =
    draft.trim() === ""
      ? "enter a value"
      : !Number.isFinite(parsed)
        ? "value must be a number"
        : null;
  const rows = deriveRefLineRows(refLines);
  const commitAdd = () => {
    if (addReason !== null) return;
    onAdd(axis, parsed);
    setDraft("0");
  };

  return (
    // tabIndex=-1: an invisible, programmatic-only focus anchor for the
    // per-row remove buttons below — see lib/focusGuard's doc. Not a new
    // Tab stop.
    <div ref={containerRef} tabIndex={-1} onKeyDown={absorbStrayDeleteOnContainer} style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {rows.map((row, index) => {
        const line = refLines[index];
        if (!line) return null;
        return (
          // One field per row, so the group title ("Reference lines") plus the
          // compact "X 1" is the whole story -- a per-row "value" caption
          // above every field would be pure repetition in a ~210px panel.
          <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="qz-v" style={{ flex: 1, whiteSpace: "nowrap" }}>{row.short}</span>
            <PropertyNumberField
              label=""
              ariaLabel={`${row.label} value`}
              value={line.value}
              required
              onValue={(value) => (value === undefined ? undefined : onValue(row.id, value))}
            />
            <IconButton
              title="Remove"
              aria-label={`Remove ${row.label}`}
              onClick={() => removeRowSafely(containerRef.current, () => onRemove(row.id))}
            >
              ✕
            </IconButton>
          </div>
        );
      })}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "end" }}>
        {/* Labelled, unlike the Stage card's bare X/Y pair: in a panel list
            beside "new value" the two glyphs alone don't say what they pick. */}
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">axis</label>
          <SegmentedControl<RefLine["axis"]>
            options={[
              { value: "x", label: "X" },
              { value: "y", label: "Y" },
            ]}
            value={axis}
            onChange={setAxis}
          />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">new value</label>
          {/* Enter commits, matching Inspector/RefLinesCard's own
              `onKeyDown={(e) => e.key === "Enter" && add()}`. Without it,
              adding several lines in a row means a mouse trip to the button
              between every one — and the Stage card sets the expectation. */}
          <NumberField
            aria-label="new reference line value"
            value={draft}
            width={72}
            onChange={setDraft}
            onKeyDown={(event) => event.key === "Enter" && commitAdd()}
          />
        </span>
        <span title={addReason ?? `Draw a reference line across the figure at this ${axis.toUpperCase()} value`}>
          <Button size="sm" disabled={addReason !== null} onClick={commitAdd}>
            Add
          </Button>
        </span>
        {addReason && draft.trim() !== "" && (
          <div className="qzk-ds-meta" style={{ color: "var(--text-dim)", width: "100%" }}>{addReason}</div>
        )}
      </div>
    </div>
  );
}
