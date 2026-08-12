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

import { asymmetricPair, type ErrorBinding, type ErrorSide } from "../../lib/errorRoles";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { Button, Card, Select } from "../primitives";

const SIDES: { value: ErrorSide; label: string }[] = [
  { value: "both", label: "± symmetric" },
  { value: "+", label: "+ upper" },
  { value: "-", label: "− lower" },
];

export default function ErrorRolesCard({ active }: { active: Dataset | null }) {
  const setErrorRoles = useApp((s) => s.setErrorRoles);
  const detectErrorRoles = useApp((s) => s.detectErrorRoles);
  const setStatus = useApp((s) => s.setStatus);
  if (!active || active.data.labels.length < 2) return null;

  const labels = active.data.labels;
  const roles = active.errorRoles ?? [];
  const patch = (i: number, next: Partial<ErrorBinding>) =>
    setErrorRoles(
      active.id,
      roles.map((r, k) => (k === i ? { ...r, ...next } : r)),
    );

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
      {roles.length === 0 ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          No error columns bound. Detect them from the column names, or pair one
          per series in Channels.
        </div>
      ) : (
        roles.map((r, i) => (
          <div
            key={`${r.channel}-${r.axis}-${r.side}`}
            style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 2 }}
          >
            <span className="qzk-menu-trunc" style={{ flex: 1 }} title={labels[r.channel]}>
              {labels[r.channel] ?? `ch ${r.channel}`}
            </span>
            <Select
              style={{ maxWidth: 96, minWidth: 0 }}
              value={String(r.target)}
              onChange={(e) => patch(i, { target: Number(e.target.value) })}
              title="The series (or axis) this error describes"
              options={[
                { value: "-1", label: "→ x axis" },
                ...labels.map((l, j) => ({ value: String(j), label: `→ ${l}` })),
              ]}
            />
            <Select
              style={{ maxWidth: 64, minWidth: 0 }}
              value={r.axis}
              onChange={(e) => patch(i, { axis: e.target.value as "x" | "y" })}
              title="Draw the whisker horizontally (x) or vertically (y)"
              options={[
                { value: "y", label: "y" },
                { value: "x", label: "x" },
              ]}
            />
            <Select
              style={{ maxWidth: 108, minWidth: 0 }}
              value={r.side}
              onChange={(e) => patch(i, { side: e.target.value as ErrorSide })}
              title="Symmetric, or one half of an asymmetric pair"
              options={SIDES}
            />
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Remove error role for ${labels[r.channel]}`}
              title="Remove this binding (the column itself is untouched)"
              className="qz-shortcut"
              onClick={() => setErrorRoles(active.id, roles.filter((_, k) => k !== i))}
            >
              ✕
            </span>
          </div>
        ))
      )}
      {halfPairs.length > 0 && (
        <div role="alert" className="qzk-ds-meta qzk-msg" style={{ color: "var(--warn, #c80)" }}>
          {halfPairs.length} one-sided binding{halfPairs.length === 1 ? "" : "s"} —
          an asymmetric pair needs BOTH halves, so nothing is drawn for these.
        </div>
      )}
      <div style={{ marginTop: 6 }}>
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
    </Card>
  );
}
