// Origin's own error-bar plots beyond one symmetric Y column
// (io/origin_project/opju_error_bars.py): asymmetric Y halves
// (`yErrPlus`/`yErrMinus`) and X bars (`xErr`, `xErrPlus`/`xErrMinus`), as
// canonical error bindings (`lib/errorRoles`). The symmetric `yErr` keeps
// riding the legacy `errKeys` (`figureCurveErrKeys`); these cannot, so the
// apply writes them into the focused window's document errors, which the
// canvas (`errorSpans`) and the export (`error_spans`) both read.
//
// Only the lazy Origin-apply chunk imports this module.

import type { ErrorBinding } from "./errorRoles";
import type { OriginCurve, OriginFigure } from "./types";

const SIDES: readonly [keyof OriginCurve, ErrorBinding["axis"], ErrorBinding["side"]][] = [
  ["yErrPlus", "y", "+"],
  ["yErrMinus", "y", "-"],
  ["xErr", "x", "both"],
  ["xErrPlus", "x", "+"],
  ["xErrMinus", "x", "-"],
];

/** One curve's richer error bindings, `channel(letter)` mapping a column
 *  letter of its book to a channel (< 0: not imported). A half pair is
 *  dropped whole: half an asymmetric bar would invent the other side. */
export function curveErrorBindings(curve: OriginCurve, target: number, channel: (letter: string) => number): ErrorBinding[] {
  const out: ErrorBinding[] = [];
  for (const [key, axis, side] of SIDES) {
    const letter = curve[key];
    const ch = typeof letter === "string" && letter ? channel(letter) : -1;
    if (ch >= 0 && ch !== target) out.push({ channel: ch, target, axis, side });
  }
  return (["x", "y"] as const).flatMap((axis) => {
    const mine = out.filter((b) => b.axis === axis);
    const halves = mine.filter((b) => b.side !== "both");
    return halves.length === 1 ? mine.filter((b) => b.side === "both") : mine;
  });
}

/** `figure`'s richer error bindings on the book `meta` describes (its
 *  `origin_book` + `origin_column_names`): each curve's onto its own Y
 *  channel. */
export function figureCurveErrorBindings(figure: OriginFigure, meta: Record<string, unknown>): ErrorBinding[] {
  const letters = Array.isArray(meta.origin_column_names) ? (meta.origin_column_names as unknown[]).map(String) : [];
  const book = String(meta.origin_book ?? "");
  const out: ErrorBinding[] = [];
  for (const c of figure.curves ?? []) {
    const y = letters.indexOf(c.y);
    if (c.book === book && y >= 0) out.push(...curveErrorBindings(c, y, (l) => letters.indexOf(l)));
  }
  return out;
}

const rich = (b: ErrorBinding) => b.axis === "x" || b.side !== "both";
const same = (a: ErrorBinding, b: ErrorBinding) =>
  a.channel === b.channel && a.target === b.target && a.axis === b.axis && a.side === b.side;

const claims = (a: ErrorBinding, b: ErrorBinding) => a.channel === b.channel || (a.target === b.target && a.axis === b.axis);

/** The document errors for an applied figure: the dataset's own richer roles
 *  (minus any the figure re-binds: the same channel, or the same curve and
 *  axis), the figure's (marked `origin`), the user's own window-only richer
 *  bindings, and the symmetric `errKeys` the view carries. A user binding wins
 *  over a figure binding that claims the same channel or curve and axis. Null
 *  when the document needs no write: the figure has none, and `current` holds
 *  neither an earlier Origin-written binding to clear nor a user's to keep. */
export function figureDocumentErrors(
  own: readonly ErrorBinding[],
  roles: readonly ErrorBinding[] | undefined,
  current: readonly ErrorBinding[] | undefined,
  errKeys: Readonly<Record<number, number>>,
): ErrorBinding[] | null {
  const base = (roles ?? []).filter(rich);
  // The user's own: richer, unmarked, and not a dataset role.
  const user = (current ?? []).filter((b) => rich(b) && b.origin !== true && !base.some((r) => same(r, b)));
  const stale = (current ?? []).some((b) => b.origin === true);
  if (!own.length && !stale && !user.length) return null;
  const mine = own.filter((o) => !user.some((u) => claims(u, o))).map((o) => ({ ...o, origin: true as const }));
  const kept = base.filter((r) => !mine.some((o) => claims(o, r)));
  const legacy = Object.entries(errKeys).map(([t, e]): ErrorBinding => ({ channel: e, target: Number(t), axis: "y", side: "both" }));
  return [...kept, ...mine, ...user, ...legacy];
}
