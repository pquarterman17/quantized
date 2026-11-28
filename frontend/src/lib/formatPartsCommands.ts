// The dialogs and the commit behind "Paste format (choose parts)…" and themes
// (plan item 42). Loaded on demand with the graph-template commands
// (`lib/graphTemplateCommands.ts`), so none of it costs the eager bundle.

import { markNavUndoable } from "../store/historyNav";
import { askParams } from "../store/paramDialog";
import { useApp } from "../store/useApp";
import type { StoreGet } from "./exportActive";
import { DEFAULT_PARTS, FORMAT_PARTS, sanitizeParts, type FormatPartId } from "./formatParts";
import { formatPartsPatch } from "./formatPartsPatch";
import type { GraphTemplate } from "./figuredoc";
import { type GraphFormat } from "./graphFormat";
import { captureExtras } from "./graphFormatExtras";
import { formatAxisOrphans } from "./graphFormatMultiY";
import { navigationView } from "./plotview";

/** The focused graph's page background. */
export function focusedBg(s: ReturnType<StoreGet>) {
  return s.plotWindows.find((w) => w.id === s.focusedWindowId)?.bg ?? "theme";
}

/** `format` with the extras (limits, legend placement, background) of the focused graph. */
export function withExtras(format: GraphFormat, s: ReturnType<StoreGet>): GraphFormat {
  return { ...format, extras: captureExtras(s, focusedBg(s)) };
}

/** Ask which parts. `available`: only these are offered (a theme's own parts). Null on cancel; [] when none is ticked. */
export async function askParts(title: string, confirmLabel: string, available?: readonly FormatPartId[]): Promise<FormatPartId[] | null> {
  const offered = FORMAT_PARTS.filter((p) => !available || available.includes(p.id));
  const answer = await askParams(
    title,
    offered.map((p) => ({ key: p.id, label: `${p.group}: ${p.label}`, type: "boolean" as const, default: !p.optIn })),
    { confirmLabel, message: "Only the ticked parts change; everything else on the graph stays as it is. Which columns are plotted never changes." },
  );
  if (!answer) return null;
  return offered.filter((p) => answer[p.id] === true).map((p) => p.id);
}

/** A saved theme's parts, or null for a whole-style template. */
export const themeParts = (t: GraphTemplate): FormatPartId[] | null => sanitizeParts(t.parts);

/** Whether `parts` is exactly what "everything" means (saved as an ordinary whole template). */
export const isEverything = (parts: readonly FormatPartId[]): boolean =>
  parts.length === DEFAULT_PARTS.length && DEFAULT_PARTS.every((p) => parts.includes(p));

/** Picker labels: a theme says which parts it holds. */
export function templateOptionLabels(templates: readonly GraphTemplate[]): Record<string, string> {
  return Object.fromEntries(templates.map((t) => {
    const parts = themeParts(t);
    return [t.name, parts ? `${t.name} (theme: ${[...new Set(parts.map((p) => FORMAT_PARTS.find((f) => f.id === p)?.group ?? p))].join(", ")})` : t.name];
  }));
}

/** Apply the ticked parts of `format` to the focused graph as ONE undo step (limits included: Ctrl+Z restores
 *  them too). False, with a status line, when nothing would change. */
export function commitFormatParts(s: StoreGet, format: GraphFormat, parts: readonly FormatPartId[], plotted: readonly number[], label: string): boolean {
  if (parts.length === 0) {
    s().setStatus(`${label}: no parts ticked — nothing changed`);
    return false;
  }
  const set = new Set(parts);
  const result = formatPartsPatch(format, set, plotted, s());
  if (Object.keys(result.patch).length === 0 && !result.bg) {
    s().setStatus(`${label}: the format carries none of the ticked parts — nothing changed`);
    return false;
  }
  const navBefore = JSON.stringify(navigationView(s()));
  s().recordHistory(label.toLowerCase());
  const entry = s().history.at(-1);
  useApp.setState((st) => ({
    ...result.patch,
    ...(result.bg ? { plotWindows: st.plotWindows.map((w) => (w.id === st.focusedWindowId ? { ...w, bg: result.bg! } : w)) } : {}),
  }));
  if (entry && JSON.stringify(navigationView(s())) !== navBefore) markNavUndoable(entry.snapshot, navigationView(s()));
  const notes: string[] = [];
  if (set.has("extraAxes")) {
    const lost = formatAxisOrphans(format);
    if (lost) notes.push(`${lost} series assigned to a Y axis the format does not have — drawn on Y1`);
  }
  if (result.unmapped > 0) notes.push(`${result.unmapped} of ${plotted.length} curves are past the format's last curve and keep their own style`);
  s().setStatus(`${label}: ${parts.length} part${parts.length === 1 ? "" : "s"} applied${notes.length ? ` — ${notes.join("; ")}` : ""}`);
  return true;
}
