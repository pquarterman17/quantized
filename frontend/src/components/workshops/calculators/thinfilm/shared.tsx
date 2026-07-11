// Shared primitives for the Thin Film calculator cards (extracted from
// ThinFilmTab.tsx — MAIN_PLAN #1, component-ceiling ratchet): the Card/Field
// layout pieces, the row/result styles, the calc-history-recording runner,
// and the numeric-list parser. Each card component owns its own local state
// (exactly as the monolithic tab did) and composes these.

import { Button, NumberField } from "../../../primitives";
import { fmtNum } from "../../../../lib/format";
import { useCalcHistory } from "../../../../store/calcHistory";

export const DOMAIN = "Thin Film";

export type CardResult = { text: string; err?: boolean } | null;

/** A titled group of inputs + a result line, mirroring the MATLAB cards. */
export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--border-soft)",
        borderRadius: 6,
        padding: "8px 10px",
        marginTop: 10,
      }}
    >
      <div className="qzk-field-lbl" style={{ marginTop: 0, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function Field({
  label,
  value,
  onChange,
  width = 84,
  unit,
  numeric = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: number;
  unit?: string;
  numeric?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className="qzk-field-lbl" style={{ margin: 0 }}>
        {label}
      </span>
      <NumberField
        value={value}
        width={width}
        onChange={onChange}
        unit={unit}
        numeric={numeric}
      />
    </span>
  );
}

export const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};
export const RESULT: React.CSSProperties = {
  marginTop: 8,
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-size-lg)",
};
export const ERR: React.CSSProperties = { marginTop: 8, color: "var(--danger)" };

/** Parse a comma/space separated numeric list. */
export function parseList(s: string): number[] {
  return s
    .split(/[\s,]+/)
    .filter((x) => x.length > 0)
    .map(Number);
}

/** Run one card's calculation: success records to the calc history; failure
 *  surfaces the API error inline (never a toast — matches the MATLAB cards). */
export async function runCalc(
  setter: (r: CardResult) => void,
  label: string,
  fn: () => Promise<string>,
): Promise<void> {
  try {
    const text = await fn();
    setter({ text });
    useCalcHistory.getState().record({ domain: DOMAIN, label, summary: text });
  } catch (e) {
    setter({ text: e instanceof Error ? e.message : "calculation failed", err: true });
  }
}

export const resultLine = (r: CardResult) => r && <div style={r.err ? ERR : RESULT}>{r.text}</div>;

export { Button, fmtNum };
