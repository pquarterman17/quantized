// Error-column bindings for the canonical Publication Preview draft (F2.3f):
// per-binding target/axis/side plus a channel+target+axis+side Add form and
// "Detect from names" -- the same `ErrorBinding` operations
// `Inspector/ErrorRolesCard.tsx` offers on the Stage (for a DATASET's default
// roles), now reachable on the detached DOCUMENT draft without touching the
// Stage. The F2.3b/c/d/e precedent applied to error-bar designations, the
// named next gap after F2.3b shipped them read-only.
//
// Vocabulary matches ErrorRolesCard deliberately: same target select ("-1" =
// "-> x axis", else "-> <label>"), same axis select (y/x, whisker direction),
// same SIDES list (+- symmetric / + upper / - lower), same half-pair warning
// via `asymmetricPair` (a one-sided binding with no partner draws nothing).
//
// CHANNEL is read-only per row, like RefLinePropertiesPanel's per-row axis --
// nothing in this app reassigns which column HOLDS the error values after a
// binding exists; only what it describes (target/axis/side) is editable here.
// Add DOES belong here, unlike shapes: a binding is fully specified by four
// selects, so it needs no live canvas -- the ADD form uses only selects, so
// (unlike RefLinePropertiesPanel's numeric field) there is no Enter-to-commit
// affordance to wire.

import { useRef, useState } from "react";

import { asymmetricPair, type ErrorBinding, type ErrorSide } from "../../../lib/errorRoles";
import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../../lib/focusGuard";
import { IconButton } from "../../primitives/IconButton";
import { Button, Select } from "../../primitives";

const SIDES: { value: ErrorSide; label: string }[] = [
  { value: "both", label: "± symmetric" },
  { value: "+", label: "+ upper" },
  { value: "-", label: "− lower" },
];

const AXES: { value: ErrorBinding["axis"]; label: string }[] = [
  { value: "y", label: "y" },
  { value: "x", label: "x" },
];

function targetOptions(labels: readonly string[]): { value: string; label: string }[] {
  return [
    { value: "-1", label: "→ x axis" },
    ...labels.map((label, j) => ({ value: String(j), label: `→ ${label}` })),
  ];
}

export default function ErrorColumnsPanel({
  bindings,
  labels,
  onPatch,
  onAdd,
  onRemove,
  onDetect,
}: {
  /** The draft's error bindings, in their own array order. An ErrorBinding
   *  has no id (see errorRoles.ts's doc) -- array index is its whole
   *  identity, the convention canonicalErrors.ts's helpers and
   *  ErrorRolesCard both use. */
  bindings: readonly ErrorBinding[];
  /** The bound dataset's raw channel labels, indexed by channel. */
  labels: readonly string[];
  onPatch: (index: number, patch: Partial<Omit<ErrorBinding, "channel">>) => void;
  onAdd: (channel: number, target: number, axis: ErrorBinding["axis"], side: ErrorSide) => void;
  onRemove: (index: number) => void;
  onDetect: () => void;
}) {
  const [channel, setChannel] = useState(0);
  const [target, setTarget] = useState("-1");
  const [axis, setAxis] = useState<ErrorBinding["axis"]>("y");
  const [side, setSide] = useState<ErrorSide>("both");
  // Focus-safety anchor (lib/focusGuard) — a remove ✕ below unmounts its own
  // row; without this, focus falls to <body> and a follow-up Delete
  // keystroke deletes the ACTIVE DATASET instead (see focusGuard's doc).
  const containerRef = useRef<HTMLDivElement>(null);

  const halfPairs = bindings.filter(
    (binding) => binding.side !== "both" && !asymmetricPair(bindings, binding.target, binding.axis),
  );
  const addReason: string | null = labels.length === 0 ? "no data columns to bind" : null;

  return (
    // tabIndex=-1: an invisible, programmatic-only focus anchor for the
    // per-row remove buttons below — see lib/focusGuard's doc. Not a new
    // Tab stop.
    <div ref={containerRef} tabIndex={-1} onKeyDown={absorbStrayDeleteOnContainer} style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {bindings.length === 0 ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          No error columns bound. Detect them from the column names, or add one below.
        </div>
      ) : (
        bindings.map((binding, i) => {
          const channelLabel = labels[binding.channel] ?? `ch ${binding.channel}`;
          return (
            <div
              key={`${binding.channel}-${binding.target}-${binding.axis}-${binding.side}`}
              style={{ display: "flex", gap: 4, alignItems: "center" }}
            >
              <span className="qzk-menu-trunc" style={{ flex: 1 }} title={channelLabel}>
                {channelLabel}
              </span>
              <Select
                style={{ maxWidth: 96, minWidth: 0 }}
                aria-label={`error binding ${i + 1} target`}
                value={String(binding.target)}
                onChange={(e) => onPatch(i, { target: Number(e.target.value) })}
                title="The series (or axis) this error describes"
                options={targetOptions(labels)}
              />
              <Select
                style={{ maxWidth: 64, minWidth: 0 }}
                aria-label={`error binding ${i + 1} axis`}
                value={binding.axis}
                onChange={(e) => onPatch(i, { axis: e.target.value as ErrorBinding["axis"] })}
                title="Draw the whisker horizontally (x) or vertically (y)"
                options={AXES}
              />
              <Select
                style={{ maxWidth: 108, minWidth: 0 }}
                aria-label={`error binding ${i + 1} side`}
                value={binding.side}
                onChange={(e) => onPatch(i, { side: e.target.value as ErrorSide })}
                title="Symmetric, or one half of an asymmetric pair"
                options={SIDES}
              />
              <IconButton
                title="Remove"
                aria-label={`Remove error binding for ${channelLabel}`}
                onClick={() => removeRowSafely(containerRef.current, () => onRemove(i))}
              >
                ✕
              </IconButton>
            </div>
          );
        })
      )}
      {halfPairs.length > 0 && (
        <div role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--warn, #c80)" }}>
          {halfPairs.length} one-sided binding{halfPairs.length === 1 ? "" : "s"} —
          an asymmetric pair needs BOTH halves, so nothing is drawn for these.
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "end" }}>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">channel</label>
          <Select
            aria-label="new error binding channel"
            style={{ maxWidth: 96, minWidth: 0 }}
            value={String(channel)}
            onChange={(e) => setChannel(Number(e.target.value))}
            options={labels.map((label, i) => ({ value: String(i), label }))}
          />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">describes</label>
          <Select
            aria-label="new error binding target"
            style={{ maxWidth: 96, minWidth: 0 }}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            options={targetOptions(labels)}
          />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">axis</label>
          <Select
            aria-label="new error binding axis"
            style={{ maxWidth: 64, minWidth: 0 }}
            value={axis}
            onChange={(e) => setAxis(e.target.value as ErrorBinding["axis"])}
            options={AXES}
          />
        </span>
        <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
          <label className="qzk-field-lbl">side</label>
          <Select
            aria-label="new error binding side"
            style={{ maxWidth: 108, minWidth: 0 }}
            value={side}
            onChange={(e) => setSide(e.target.value as ErrorSide)}
            options={SIDES}
          />
        </span>
        <span title={addReason ?? "Bind this column as an error whisker"}>
          <Button size="sm" disabled={addReason !== null} onClick={() => onAdd(channel, Number(target), axis, side)}>
            Add
          </Button>
        </span>
      </div>

      <div>
        <Button
          size="sm"
          onClick={onDetect}
          title="Suggest bindings from the column names (err, sigma, dR, xerr, err+/−)"
        >
          Detect from names
        </Button>
      </div>
    </div>
  );
}
