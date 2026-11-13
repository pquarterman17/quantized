// Error-role override (MAIN_PLAN #36).
//
// The ± picker in the Channels card sets ONE symmetric vertical error per
// series, which is all the legacy model could express. This card exposes the
// canonical roles: which column, describing which series, on which axis, as a
// symmetric bar or one half of an asymmetric pair.
//
// "Detect from names" is the plan's "suggested, never silently forced" made
// literal — inference runs when the USER asks for it, and its result is an
// ordinary editable list afterwards, not a hidden decision.

import { useRef } from "react";

import { reviewSeedErrorBindings } from "../../lib/errorBindingConfidence";
import { confirmErrorBindings, withdrawErrorBindingConfirmation } from "../../lib/errorRoleConfirm";
import { asymmetricPair, nextManualErrorBindings, type ErrorBinding, type ErrorSide } from "../../lib/errorRoles";
import { effectiveChannels } from "../../lib/plotdata";
import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../lib/focusGuard";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Button, Select } from "../primitives";
import Card from "../primitives/Card";
import { IconButton } from "../primitives/IconButton";

const SIDES: { value: ErrorSide; label: string }[] = [
  { value: "both", label: "± symmetric" },
  { value: "+", label: "+ upper" },
  { value: "-", label: "− lower" },
];

export default function ErrorRolesCard({ active }: { active: Dataset | null }) {
  // Retrospective-audit P1 fix: this was the ONE decor card in its class
  // (shades/shapes/ref-lines/annotations/error-roles) without the
  // lib/focusGuard wiring — clicking a row's ✕ unmounted the focused span,
  // dropped focus to <body>, and the next Delete removed the active DATASET
  // (the exact incident focusGuard.ts's header documents).
  const containerRef = useRef<HTMLDivElement>(null);
  const setErrorRoles = useApp((s) => s.setErrorRoles);
  const detectErrorRoles = useApp((s) => s.detectErrorRoles);
  const setStatus = useApp((s) => s.setStatus);
  const recordHistory = useApp((s) => s.recordHistory);
  const yKeys = useApp((s) => s.yKeys);
  const xKey = useApp((s) => s.xKey);
  if (!active || active.data.labels.length < 2) return null;
  const plottedY = effectiveChannels(active.data, yKeys, xKey, active.channelRoles);

  const labels = active.data.labels;
  const roles = active.errorRoles ?? [];
  // An edit here is an explicit decision: recorded as confirmed
  // (lib/errorRoleConfirm.ts) so a new figure applies it without asking; a
  // removal withdraws any confirmation for that column.
  const patch = (i: number, next: Partial<ErrorBinding>) => {
    const edited = { ...roles[i], ...next };
    setErrorRoles(active.id, roles.map((r, k) => (k === i ? edited : r)));
    confirmErrorBindings(active.id, [edited]);
  };
  const remove = (i: number) => {
    setErrorRoles(active.id, roles.filter((_, k) => k !== i));
    withdrawErrorBindingConfirmation(active.id, roles[i].channel);
  };
  // Pairings the confidence grade would ask about before a new figure applies
  // them (adjacency alone); each row offers a one-click confirm.
  const unconfirmed = reviewSeedErrorBindings(active).confirm;
  const confirmRow = (r: ErrorBinding) => {
    recordHistory("confirm error role");
    confirmErrorBindings(active.id, [r]);
  };
  const needsConfirm = (r: ErrorBinding) =>
    unconfirmed.some((u) => u.channel === r.channel && u.target === r.target && u.axis === r.axis && u.side === r.side);

  // Manual Add: the next column(s) not yet bound as an error, against the
  // first plotted series (or the first other column). Confirmed, like any
  // explicit edit here, so new figures apply it without asking.
  const add = (pair: boolean) => {
    const added = nextManualErrorBindings(active, roles, pair, plottedY);
    if (added.length === 0) {
      setStatus(pair ? "Add ± pair needs two unbound columns" : "every column is already bound");
      return;
    }
    setErrorRoles(active.id, [...roles, ...added]);
    confirmErrorBindings(active.id, added);
  };

  // Warn about a half-pair: it is legal to have one and drawn as nothing, so
  // saying so beats leaving the user to wonder why no bars appeared.
  const halfPairs = roles.filter(
    (r) => r.side !== "both" && !asymmetricPair(roles, r.target, r.axis),
  );

  return (
    <Card
      title="Error columns"
      defaultOpen={false}
      count={roles.length || undefined}
      helpTopic="Import wizard"
    >
      <div ref={containerRef} tabIndex={-1} onKeyDown={absorbStrayDeleteOnContainer}>
      {roles.length === 0 ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          No error columns bound. Detect them from the column names, or pair one
          per series in Channels.
        </div>
      ) : (
        roles.map((r, i) => (
          // Figures-audit #14: the column name gets its own line and the
          // three selects share the line below, so neither the name nor
          // "± symmetric" is clipped at the Inspector's default width.
          <div key={`${r.channel}-${r.axis}-${r.side}`} style={{ marginBottom: 4 }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <Select
              style={{ flex: 1, minWidth: 0 }}
              aria-label={`Error column ${i + 1}`}
              value={String(r.channel)}
              onChange={(e) => patch(i, { channel: Number(e.target.value) })}
              title="The column holding the error values"
              options={labels.map((l, j) => ({ value: String(j), label: l }))}
            />
            {/* Real buttons, so both are in the Tab order and fire on
                Enter/Space natively. Each one removes ITSELF (✕ drops the row,
                ✓ disappears once the pairing is confirmed), so both go
                through removeRowSafely to keep focus off <body>. Delete or
                Backspace on a focused one is absorbed: otherwise it reaches
                the global Delete shortcut and removes the whole dataset. */}
            <IconButton
              type="button"
              aria-label={`Remove error role for ${labels[r.channel] ?? `ch ${r.channel}`}`}
              title="Remove this binding (the column itself is untouched)"
              onClick={() => removeRowSafely(containerRef.current, () => remove(i))}
              onKeyDown={absorbStrayDeleteOnContainer}
            >
              ✕
            </IconButton>
            {needsConfirm(r) && (
              <IconButton
                type="button"
                aria-label={`Confirm error role for ${labels[r.channel] ?? `ch ${r.channel}`}`}
                title="Only column position suggests this pairing; confirm it so new figures apply it without asking."
                onClick={() => removeRowSafely(containerRef.current, () => confirmRow(r))}
                onKeyDown={absorbStrayDeleteOnContainer}
              >
                ✓
              </IconButton>
            )}
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", paddingLeft: 8 }}>
            <Select
              style={{ flex: "1.4 1 0", minWidth: 0 }}
              aria-label={`Error column ${i + 1} describes`}
              value={String(r.target)}
              onChange={(e) => patch(i, { target: Number(e.target.value) })}
              title="The series (or axis) this error describes"
              options={[
                { value: "-1", label: "→ x axis" },
                ...labels.map((l, j) => ({ value: String(j), label: `→ ${l}` })),
              ]}
            />
            <Select
              style={{ flex: "0.6 1 0", minWidth: 0 }}
              aria-label={`Error column ${i + 1} direction`}
              value={r.axis}
              onChange={(e) => patch(i, { axis: e.target.value as "x" | "y" })}
              title="Draw the whisker horizontally (x) or vertically (y)"
              options={[
                { value: "y", label: "y" },
                { value: "x", label: "x" },
              ]}
            />
            <Select
              style={{ flex: "1.2 1 0", minWidth: 0 }}
              aria-label={`Error column ${i + 1} side`}
              value={r.side}
              onChange={(e) => patch(i, { side: e.target.value as ErrorSide })}
              title="Symmetric, or one half of an asymmetric pair"
              options={SIDES}
            />
          </div>
          </div>
        ))
      )}
      {halfPairs.length > 0 && (
        <div role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--warn, #c80)" }}>
          {halfPairs.length} one-sided binding{halfPairs.length === 1 ? "" : "s"} —
          an asymmetric pair needs BOTH halves, so nothing is drawn for these.
        </div>
      )}
      <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {/* Manual Add (figures-audit #10: only the Publication preview had
            one). Seeds the next unbound column against the first plotted
            series; every field is editable on the new row. */}
        <Button size="sm" onClick={() => add(false)} title="Bind another column as a symmetric (±) error">
          Add
        </Button>
        <Button
          size="sm"
          onClick={() => add(true)}
          title="Bind two columns as the upper (+) and lower (−) halves of an asymmetric error"
        >
          Add ± pair
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const n = detectErrorRoles(active.id);
            setStatus(
              n ? `detected ${n} error column${n === 1 ? "" : "s"}` : "no error columns recognized",
            );
          }}
          title="Suggest bindings from the column names (err, sigma, dR, xerr, err+/−)"
        >
          Detect from names
        </Button>
      </div>
      </div>
    </Card>
  );
}
