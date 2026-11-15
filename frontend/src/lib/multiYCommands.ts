// Plot ▸ "Y Axis Settings…" (gap audit 4 G11): edit one Y3+ axis -- title,
// scale (with the G17 log2 / Ln / probability scales), range, tick step,
// number format, colour -- or remove it. One undo step per apply
// (`setExtraYAxis`). Loaded on demand from commands/plotCommands.ts.
//
// Refused here, said in the dialog (lib/multiY.ts's module doc): an extra
// axis never links (G19 links Y1) and never crosses (G17's crossing is X / Y).

import { askParams } from "../store/paramDialog";
import type { StoreGet } from "./exportActive";
import { MAX_EXTRA_Y, resolveExtraYAxes, type ExtraYAxis } from "./multiY";
import { effectiveChannels } from "./plotdata";
import { openFigureDialog } from "../store/figureDialogs";
import { setExtraYAxis } from "./multiYEdit";
import type { AxisFormat, AxisScale, TickMode } from "./types";

const SCALES = ["Same as Y1", "Linear", "Log10", "Log2", "Ln", "Probability (%)", "Reciprocal"] as const;
const FORMATS: readonly [string, TickMode | null][] = [["Same as Y1", null], ["Auto", "auto"], ["Fixed", "fixed"], ["Scientific", "sci"], ["Engineering", "eng"]];

function scaleChoice(a: ExtraYAxis): string {
  if (a.scale === null) return SCALES[0];
  if (a.scale === "reciprocal") return "Reciprocal";
  if (a.scale === "log") return a.fmt?.base === "2" ? "Log2" : a.fmt?.base === "e" ? "Ln" : "Log10";
  return a.fmt?.prob ? "Probability (%)" : "Linear";
}

const num = (v: unknown): number | null => {
  const t = String(v ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** The axis patch for the dialog's answers, or an error to show. */
export function extraAxisPatch(a: ExtraYAxis, p: Record<string, unknown>): Partial<ExtraYAxis> | string {
  const lo = num(p.min);
  const hi = num(p.max);
  const step = num(p.step);
  if (Number.isNaN(lo) || Number.isNaN(hi) || Number.isNaN(step)) return "type a number, or leave it blank for auto";
  if ((lo === null) !== (hi === null)) return "give both limits, or neither";
  if (lo !== null && hi !== null && !(lo < hi)) return "the minimum must be below the maximum";
  if (step !== null && step <= 0) return "the tick step must be positive";
  const color = String(p.color ?? "").trim();
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) return "colour: #rrggbb, or blank for the axis ink";
  const choice = String(p.scale);
  const mode = FORMATS.find(([label]) => label === p.format)?.[1] ?? null;
  const digits = Math.max(0, Math.min(10, Math.round(Number(p.digits) || 0)));
  // Base / probability live on the format (G17), so a special scale needs one.
  const base: Partial<AxisFormat> = choice === "Log2" ? { base: "2" } : choice === "Ln" ? { base: "e" } : choice === "Probability (%)" ? { prob: "percent" } : {};
  const { base: _b, prob: _p, ...own } = a.fmt ?? { mode: "auto" as TickMode, digits: 2 };
  void [_b, _p];
  const fmt: AxisFormat | null = mode === null && !Object.keys(base).length ? null : { ...own, ...(mode ? { mode, digits } : {}), ...base };
  const scale: AxisScale | null = choice === SCALES[0] ? null : choice === "Reciprocal" ? "reciprocal" : choice.startsWith("Log") || choice === "Ln" ? "log" : "linear";
  return {
    label: String(p.label ?? "").trim(),
    scale,
    lim: lo !== null && hi !== null ? [lo, hi] : null,
    step: lo !== null ? step : null, // a step needs a fixed range (Y1's rule)
    fmt,
    color: color || null,
  };
}

/** The right-hand axes the focused graph draws, left to right: "y2" when Y2
 *  has a drawn series, then each drawn extra axis' index into `yAxes` --
 *  the order `lib/uplotMultiY.ts` lays them out in. */
export function drawnRightAxes(st: ReturnType<StoreGet>): ("y2" | number)[] {
  const ds = st.datasets.find((d) => d.id === st.activeId);
  if (!ds) return [];
  const hidden = new Set(st.hiddenChannels);
  const shown = effectiveChannels(ds.data, st.yKeys, st.xKey, ds.channelRoles, st.seriesOrder).filter((ch) => !hidden.has(ch));
  const { axes } = resolveExtraYAxes(shown, st, { scale: st.yScale, fmt: st.yFmt });
  const taken = new Set(axes.flatMap((a) => a.keys));
  const y2 = shown.some((ch) => st.y2Keys?.includes(ch) && !taken.has(ch));
  return [...(y2 ? ["y2" as const] : []), ...axes.map((a) => a.n - 3)];
}

/** Double-click on the `rank`-th right-hand axis (0 = innermost): Y2 opens
 *  the Axis dialog, a Y3+ axis its own settings (review L3). */
export function openRightAxis(s: StoreGet, rank: number): boolean {
  if (s().yAxes.length === 0) return false; // no Y3+: the plain Axis dialog decides
  const at = drawnRightAxes(s())[rank];
  if (at === "y2") openFigureDialog({ kind: "axis", axis: "y2" });
  else if (at !== undefined) void editExtraYAxes(s, at);
  return true;
}

/** `only`: edit that extra axis (index into `yAxes`) without asking which. */
export async function editExtraYAxes(s: StoreGet, only?: number): Promise<void> {
  const st = s();
  if (st.yAxes.length === 0) {
    st.setStatus(`No Y3 axis yet: set a series' axis to +Y3 in the Inspector's Channels card (up to Y${MAX_EXTRA_Y + 2})`);
    return;
  }
  let i = only ?? 0;
  if (only === undefined && st.yAxes.length > 1) {
    const names = st.yAxes.map((_, k) => `Y${k + 3}`);
    const pick = await askParams("Y Axis Settings", [{ key: "axis", label: "Axis", type: "select", default: names[0], options: names }], { confirmLabel: "Next" });
    if (!pick) return;
    i = Math.max(0, names.indexOf(String(pick.axis)));
  }
  const a = s().yAxes[i];
  if (!a) return;
  const name = `Y${i + 3}`;
  const p = await askParams(`${name} Axis`, [
    { key: "label", label: "Title", type: "text", default: a.label, placeholder: "auto: its series' name" },
    { key: "scale", label: "Scale", type: "select", default: scaleChoice(a), options: [...SCALES] },
    { key: "min", label: "From", type: "text", default: a.lim ? String(a.lim[0]) : "", placeholder: "auto" },
    { key: "max", label: "To", type: "text", default: a.lim ? String(a.lim[1]) : "", placeholder: "auto" },
    { key: "step", label: "Major tick step", type: "text", default: a.step === null ? "" : String(a.step), placeholder: "auto" },
    { key: "format", label: "Tick labels", type: "select", default: FORMATS.find(([, m]) => m === (a.fmt?.mode ?? null))?.[0] ?? FORMATS[0][0], options: FORMATS.map(([l]) => l) },
    { key: "digits", label: "Digits", type: "number", default: a.fmt?.digits ?? 2 },
    { key: "color", label: "Colour", type: "text", default: a.color ?? "", placeholder: "#rrggbb — blank: the axis ink" },
    { key: "remove", label: `Remove ${name} (its series go back to Y1)`, type: "boolean", default: false },
  ], {
    confirmLabel: "Apply",
    message: `${name} sits on the right, one slot outside the axis before it. It does not link to other windows and does not cross X (those apply to Y1).`,
  });
  if (!p) return;
  if (p.remove === true) {
    setExtraYAxis(s, i, null);
    s().setStatus(`${name} removed — its series are on Y1`);
    return;
  }
  const patch = extraAxisPatch(a, p);
  if (typeof patch === "string") {
    s().setStatus(`${name} unchanged: ${patch}`);
    return;
  }
  setExtraYAxis(s, i, patch);
  s().setStatus(`${name} axis updated`);
}
