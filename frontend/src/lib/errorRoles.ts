// The canonical error-column role contract (MAIN_PLAN #33, foundation for #36).
//
// What existed: `errKeys: Record<number, number>` — one error channel per value
// channel. That expresses exactly one shape, symmetric vertical Y error, which
// is why X error and asymmetric ± pairs were unreachable. This module is the
// model that covers every shape the plan names (X±, Y±, X+/X−, Y+/Y−), with
// `errKeys` derived from it so every existing consumer keeps working untouched.
//
// TWO RULES THIS ENCODES, both from the plan:
//
//  1. Names are SUGGESTED, never silently forced. `err`/`sigma`/`dR` and
//     friends are strong hints, but a column called `error` next to three Y
//     columns is genuinely ambiguous, and quietly binding it to the wrong one
//     produces a plot that is confidently wrong. So inference only proposes
//     where the pairing is unambiguous, and everything is overridable.
//  2. An error column stays INDEPENDENT of the values it describes. A binding
//     is a reference, never a rewrite — toggling or re-pairing error bars can
//     never mutate the underlying X/Y data.

import type { DataStruct } from "./types";

/** Which side of an asymmetric pair a column supplies. */
export type ErrorSide = "both" | "+" | "-";

export interface ErrorBinding {
  /** Channel index holding the error values. */
  channel: number;
  /** Channel the error describes; -1 means the dataset's x axis. */
  target: number;
  axis: "x" | "y";
  side: ErrorSide;
}

/** Suffixes that mark an asymmetric half, checked before the base names so
 *  `err+` is not first matched as `err`. */
const PLUS = ["+", "up", "hi", "high", "upper"];
const MINUS = ["-", "dn", "down", "lo", "low", "lower"];

/** Tokens that mark a column as an uncertainty. Ordered longest-first so
 *  `stderr` is not shadowed by `err`. */
const ERROR_TOKENS = ["stderr", "sigma", "error", "err", "unc", "sdev", "std", "sd", "se"];

function norm(label: string): string {
  return label.trim().toLowerCase().replace(/[\s_]+/g, "");
}

/** Does this label look like an uncertainty column, and for which axis/side?
 *
 *  Returns null for anything that does not clearly read as an error column —
 *  a false positive here silently turns a real measurement into whiskers. */
export function classifyErrorLabel(
  label: string,
): { axis: "x" | "y" | null; side: ErrorSide; base: string } | null {
  const n = norm(label);
  if (!n) return null;

  let side: ErrorSide = "both";
  let body = n;
  for (const suffix of PLUS) {
    if (body.endsWith(suffix) && body.length > suffix.length) {
      side = "+";
      body = body.slice(0, -suffix.length);
      break;
    }
  }
  if (side === "both") {
    for (const suffix of MINUS) {
      if (body.endsWith(suffix) && body.length > suffix.length) {
        side = "-";
        body = body.slice(0, -suffix.length);
        break;
      }
    }
  }

  // Explicit axis prefix — "xerr"/"yerr" say which axis outright.
  let axis: "x" | "y" | null = null;
  if (body.startsWith("x")) axis = "x";
  else if (body.startsWith("y")) axis = "y";

  const token = ERROR_TOKENS.find((t) => body === t || body.endsWith(t) || body.startsWith(t));
  if (!token) {
    // A bare leading "d" is the instrument convention for a delta column
    // (dR, dQ, dSA) — only treat it as an error when a base name remains.
    if (/^d[a-z0-9]/.test(body)) {
      return { axis, side, base: body.slice(1) };
    }
    return null;
  }
  const base = body.replace(token, "").replace(/^[xy]/, "");
  return { axis, side, base };
}

/** Infer bindings from column labels, pairing each error column with the value
 *  column it describes.
 *
 *  PAIRING RULES, in order of confidence:
 *    1. Base-name match — `dR` binds to `R`, `M_err` to `M`. Unambiguous.
 *    2. An explicit `x` prefix binds to the x axis.
 *    3. Nearest PRECEDING value column — the instrument-file convention the
 *       Origin/reflectometry corpus already relies on.
 *  A column that matches none of these is left UNBOUND rather than guessed at:
 *  the plan's "never silently forced". */
export function inferErrorBindings(data: DataStruct): ErrorBinding[] {
  const labels = data.labels ?? [];
  const classified = labels.map((l) => classifyErrorLabel(l));
  const isError = classified.map((c) => c !== null);
  const bindings: ErrorBinding[] = [];

  for (let ch = 0; ch < labels.length; ch++) {
    const info = classified[ch];
    if (!info) continue;

    // 1. base-name match against a NON-error column
    let target = -2;
    if (info.base) {
      const idx = labels.findIndex((l, i) => !isError[i] && norm(l) === info.base);
      if (idx >= 0) target = idx;
    }
    // 2. explicit x prefix
    if (target === -2 && info.axis === "x") target = -1;
    // 3. nearest preceding value column
    if (target === -2) {
      for (let k = ch - 1; k >= 0; k--) {
        if (!isError[k]) {
          target = k;
          break;
        }
      }
    }
    if (target === -2) continue; // nothing defensible to bind to — leave it out

    bindings.push({
      channel: ch,
      target,
      axis: info.axis ?? (target === -1 ? "x" : "y"),
      side: info.side,
    });
  }
  return bindings;
}

/** Back-compat projection: the legacy `errKeys` map (value channel → error
 *  channel) that the existing error-bar plugin and fit weighting consume.
 *
 *  Only SYMMETRIC Y bindings project — that is all the legacy shape can carry,
 *  and silently collapsing an asymmetric pair into it would draw whiskers that
 *  misstate the data in one direction. */
export function errKeysFromBindings(bindings: readonly ErrorBinding[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const b of bindings) {
    if (b.axis === "y" && b.side === "both" && b.target >= 0) out[b.target] = b.channel;
  }
  return out;
}

/** The asymmetric pair for a target channel on one axis, if both halves exist.
 *  Returns null unless BOTH sides are present — half a pair is not an
 *  asymmetric error bar, and drawing it as one would invent the other side. */
export function asymmetricPair(
  bindings: readonly ErrorBinding[],
  target: number,
  axis: "x" | "y",
): { plus: number; minus: number } | null {
  const plus = bindings.find((b) => b.target === target && b.axis === axis && b.side === "+");
  const minus = bindings.find((b) => b.target === target && b.axis === axis && b.side === "-");
  return plus && minus ? { plus: plus.channel, minus: minus.channel } : null;
}

/** The symmetric binding for a target on one axis, if any. */
export function symmetricBinding(
  bindings: readonly ErrorBinding[],
  target: number,
  axis: "x" | "y",
): number | null {
  const b = bindings.find((x) => x.target === target && x.axis === axis && x.side === "both");
  return b ? b.channel : null;
}

/** Validate bindings read back from a `.dwk` / template — never trust the slot.
 *  Drops anything referencing a channel the dataset no longer has, which is
 *  what keeps a reapplied template from binding error bars to the wrong column
 *  after the source's shape changed. */
export function sanitizeBindings(
  raw: unknown,
  channelCount: number,
): ErrorBinding[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ErrorBinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const b = item as Partial<ErrorBinding>;
    if (typeof b.channel !== "number" || typeof b.target !== "number") continue;
    if (b.channel < 0 || b.channel >= channelCount) continue;
    if (b.target < -1 || b.target >= channelCount) continue;
    if (b.axis !== "x" && b.axis !== "y") continue;
    if (b.side !== "both" && b.side !== "+" && b.side !== "-") continue;
    out.push({ channel: b.channel, target: b.target, axis: b.axis, side: b.side });
  }
  return out;
}
