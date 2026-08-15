// Shared card kit for ALL calculator tabs (MAIN_PLAN #8 consolidation —
// hoisted from thinfilm/shared.tsx, which itself was extracted from
// ThinFilmTab.tsx): the Card/Field layout pieces, the row/result styles, the
// calc-history-recording runner factory, and the numeric-list parser. Each
// tab owns its own local state (exactly as the per-tab copies did) and
// composes these. The rendered DOM is identical to the former private copies.

import { useCallback, useRef, useState } from "react";

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

/** One card's result state under the DIRACULATOR_AUDIT provenance contract:
 *  a displayed result is either CURRENT for the visible inputs or gone.
 *
 *  - `run(label, fn)` executes a calculation under a monotonically
 *    increasing per-card request id: a completion (success OR error) whose
 *    id is no longer the latest is dropped outright — an older in-flight
 *    request can never overwrite a newer result, and never records a
 *    misleading history entry (history is written only by the completion
 *    that also owns the display).
 *  - `touch()` is wired into every input change on the card: it clears the
 *    displayed result/error AND bumps the request id, so a pending request
 *    that was issued for the OLD inputs is disowned before it completes.
 *    Inputs deliberately stay editable while a request is pending (the
 *    audit's decision point): editing invalidates rather than blocks.
 *
 *  Success records to the calc history; failure surfaces the API error
 *  inline (never a toast — matches the MATLAB cards). The retired
 *  `makeCardRunner` had neither ordering nor invalidation: two overlapping
 *  runs completed in network order, and results survived input edits. */
export function useCard(domain: string) {
  const [result, setResult] = useState<CardResult>(null);
  const seq = useRef(0);
  const run = useCallback(
    async (label: string, fn: (isCurrent: () => boolean) => Promise<string>): Promise<void> => {
      const id = ++seq.current;
      // For fns with side-effects beyond the returned text (e.g. chaining a
      // value into another card's input): gate them on isCurrent() so a
      // disowned completion can't overwrite state the user has since edited.
      const isCurrent = (): boolean => seq.current === id;
      try {
        const text = await fn(isCurrent);
        if (seq.current !== id) return; // superseded — a newer run/touch owns this card
        setResult({ text });
        useCalcHistory.getState().record({ domain, label, summary: text });
      } catch (e) {
        if (seq.current !== id) return;
        setResult({ text: e instanceof Error ? e.message : "calculation failed", err: true });
      }
    },
    [domain],
  );
  const touch = useCallback((): void => {
    seq.current++;
    setResult((r) => (r == null ? r : null));
  }, []);
  return { result, setResult, run, touch } as const;
}

/** Wrap a Field's setState so the owning card's result invalidates on every
 *  edit — the standard way to wire `useCard.touch` into inputs:
 *  `onChange={withTouch(c1.touch, setD0)}`. */
export const withTouch =
  (touch: () => void, set: (v: string) => void) =>
  (v: string): void => {
    set(v);
    touch();
  };

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
