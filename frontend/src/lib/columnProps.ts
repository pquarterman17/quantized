// User-set worksheet column properties (`Dataset.columnProps`): the Comments
// header row and the per-column DISPLAY number format of Origin's Column
// Properties dialog. Pure — the store writes go through
// store/worksheetColumns.ts, the grid reads the formatter below.
//
// Keyed by column like every other channel-indexed Dataset field (-1 = the X
// column), so a column insert / delete / move remaps it through
// lib/channelRemap.ts's `remapDatasetChannels` with the rest.
//
// A display format never touches the stored number: copy, export, formulas
// and plots keep full precision, exactly as Origin's display format does.

/** A worksheet column's DISPLAY number format (Origin's Column Properties ›
 *  Display): fixed decimal places, scientific, or significant digits. Only
 *  the grid's text changes, never the stored number. */
export interface NumberFormat {
  kind: "decimal" | "sci" | "sig";
  digits: number;
}

/** User-set worksheet column properties, keyed by column (-1 = X) in
 *  `Dataset.columnProps`: the Comments header row and the display format. */
export interface ColumnProps {
  comment?: string;
  format?: NumberFormat;
}

/** Origin's three numeric display choices; `null` is "Auto" (the grid's own
 *  per-column precision, components/Stage/worksheet/cellFormat.ts). */
export const NUMBER_FORMAT_KINDS: readonly NumberFormat["kind"][] = ["decimal", "sci", "sig"];

/** The menu wording for each kind (the format dialog's select). */
export const NUMBER_FORMAT_LABELS: Record<NumberFormat["kind"] | "auto", string> = {
  auto: "Auto",
  decimal: "Decimal places",
  sci: "Scientific",
  sig: "Significant digits",
};

/** The largest digit count any kind accepts (toFixed/toPrecision's own limit
 *  is higher, but no lab number has more than double precision's 17). */
export const MAX_FORMAT_DIGITS = 17;

/** Clamp a requested digit count into the kind's valid range: 0..17 decimals,
 *  0..17 mantissa decimals, 1..17 significant digits. */
export function clampDigits(kind: NumberFormat["kind"], digits: number): number {
  const d = Number.isFinite(digits) ? Math.round(digits) : 0;
  return Math.max(kind === "sig" ? 1 : 0, Math.min(MAX_FORMAT_DIGITS, d));
}

/** Format one cell under an explicit format; em-dash for missing, like the
 *  grid's automatic formatter. */
export function formatNumber(v: number | undefined, f: NumberFormat): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const digits = clampDigits(f.kind, f.digits);
  if (f.kind === "decimal") return v.toFixed(digits);
  if (f.kind === "sci") return v.toExponential(digits);
  return v.toPrecision(digits);
}

/** `props` with column `col`'s entry patched; a field set to `undefined` is
 *  removed, an emptied entry is dropped, and an emptied map is `undefined`
 *  (the store's "absent rather than empty" convention). */
export function patchColumnProps(
  props: Record<number, ColumnProps> | undefined,
  col: number,
  patch: Partial<ColumnProps>,
): Record<number, ColumnProps> | undefined {
  const next: ColumnProps = { ...props?.[col], ...patch };
  if (next.comment === undefined || next.comment === "") delete next.comment;
  if (next.format === undefined) delete next.format;
  const out = { ...props };
  if (Object.keys(next).length) out[col] = next;
  else delete out[col];
  return Object.keys(out).length ? out : undefined;
}

/** Load-time sanitizer for a `.dwk`'s `columnProps`: integer keys in
 *  `[-1, width)`, a string comment, a known format kind with a numeric digit
 *  count (clamped). `undefined` when nothing valid remains. */
export function sanitizeColumnProps(raw: unknown, width: number): Record<number, ColumnProps> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  let out: Record<number, ColumnProps> | undefined;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const c = Number(k);
    if (!Number.isInteger(c) || c < -1 || c >= width || !v || typeof v !== "object") continue;
    const entry = v as { comment?: unknown; format?: { kind?: unknown; digits?: unknown } };
    const kind = entry.format?.kind;
    const format =
      typeof kind === "string" && (NUMBER_FORMAT_KINDS as readonly string[]).includes(kind) && typeof entry.format?.digits === "number"
        ? { kind: kind as NumberFormat["kind"], digits: clampDigits(kind as NumberFormat["kind"], entry.format.digits) }
        : undefined;
    const comment = typeof entry.comment === "string" && entry.comment !== "" ? entry.comment : undefined;
    out = patchColumnProps(out, c, { comment, format });
  }
  return out;
}
