// Shared card kit for ALL calculator tabs (MAIN_PLAN #8 consolidation —
// hoisted from thinfilm/shared.tsx, which itself was extracted from
// ThinFilmTab.tsx): the Card/Field layout pieces, the row/result styles, the
// calc-history-recording runner factory, and the numeric-list parser. Each
// tab owns its own local state (exactly as the per-tab copies did) and
// composes these. The rendered DOM is identical to the former private copies.

import { copyText } from "../../../lib/clipboard";
import { fmtNum } from "../../../lib/format";
import { useCalcHistory } from "../../../store/calcHistory";
import { toast } from "../../../store/toasts";
import { Button, IconButton, NumberField } from "../../primitives";

/** A result string plus the exact value copy-to-clipboard should write —
 *  usually the raw JS number's full-precision `String(...)`, not the
 *  rounded `fmtNum` display text (item 5, calculator audit). Falls back to
 *  `text` when omitted (most existing `makeCardRunner` cards, whose result
 *  is only ever built as an already-formatted string). */
export type CardResult = { text: string; err?: boolean; copyValue?: string } | null;

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

/** A labelled NumberField (numeric by default — pass numeric={false} for text).
 *  The input's accessible name defaults to `label` (usually a short glyph like
 *  "t" or "σ", visible right next to it) — pass `ariaLabel` when a card has
 *  more than one field sharing that glyph (e.g. two "t" fields), so
 *  `getByLabelText` and screen readers alike can tell them apart. */
export function Field({
  label,
  value,
  onChange,
  width = 84,
  unit,
  numeric = true,
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: number;
  unit?: string;
  numeric?: boolean;
  ariaLabel?: string;
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
        aria-label={ariaLabel ?? label}
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

/** Parse pasted two-column data (one "x y" / "x, y" / "x\ty" pair per line —
 *  whitespace/comma tolerant, like `parseList` but per row) into parallel x/y
 *  arrays. Blank lines are skipped; a malformed row (not exactly 2 numeric
 *  tokens) is silently dropped rather than throwing, so one bad paste row
 *  doesn't block the whole card. Shared by every card that fits a pasted
 *  (x, y) sweep — e.g. Curie-Weiss (T, χ) and the Hall-effect field sweep
 *  (H, R_xy) — rather than each hand-rolling its own paste parser. */
export function parseXYPairs(text: string): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line
      .trim()
      .split(/[\s,]+/)
      .filter((p) => p.length > 0);
    if (parts.length < 2) continue;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      x.push(a);
      y.push(b);
    }
  }
  return { x, y };
}

/** Build one tab's card-calculation runner, bound to its history domain:
 *  success records to the calc history; failure surfaces the API error
 *  inline (never a toast — matches the MATLAB cards). */
export function makeCardRunner(domain: string) {
  return async function runCalc(
    setter: (r: CardResult) => void,
    label: string,
    fn: () => Promise<string>,
  ): Promise<void> {
    try {
      const text = await fn();
      setter({ text });
      useCalcHistory.getState().record({ domain, label, summary: text });
    } catch (e) {
      setter({ text: e instanceof Error ? e.message : "calculation failed", err: true });
    }
  };
}

/** Copy-to-clipboard button for a calculator result (⧉ glyph — the same
 *  convention as Inspector/MetadataCard's "⧉ Copy metadata"). One mechanism,
 *  reused everywhere a result needs a copy affordance: `resultLine` below
 *  and the four hook-backed tabs' custom result displays (Units/Xray/
 *  Crystal/Sld) all render this rather than hand-rolling their own. */
export function CopyButton({ value, label = "result" }: { value: string; label?: string }) {
  return (
    <IconButton
      aria-label={`copy ${label}`}
      title={`copy ${label}`}
      style={{ marginLeft: 6 }}
      onClick={() =>
        void copyText(value).then((ok) =>
          toast(ok ? `copied ${label}` : "clipboard unavailable", ok ? "ok" : "danger"),
        )
      }
    >
      ⧉
    </IconButton>
  );
}

export const resultLine = (r: CardResult) =>
  r && (
    <div style={r.err ? ERR : RESULT}>
      <span>{r.text}</span>
      {!r.err && <CopyButton value={r.copyValue ?? r.text} />}
    </div>
  );

export { Button, fmtNum };
