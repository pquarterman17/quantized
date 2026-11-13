// The Publication preview's "Text & fonts" group (publication-figures audit
// #6/#7), split out of PropertyPanels.tsx (400-line component ceiling).
//
// Per-element sizes: a base font size used to move the tick and axis labels
// but leave the title at the preset's own (smaller) size, so a 12 pt figure
// had an 11 pt title. The backend now scales an unset title/legend size with
// the base (`calc.figure_fonts.effective_style`) and these fields set each
// element explicitly — the preview is the server render, so the screen shows
// exactly what Export writes.
//
// Font: a picker of the families the export can actually render
// (`GET /api/export/fonts`), with the common proprietary names listed by what
// they resolve to here (Arial → Liberation Sans). A free-text name used to
// fall back to DejaVu Sans silently; a fallback is now said in the panel and
// by the export's own warning.

import { useEffect, useState } from "react";

import { fetchFigureFonts, type FigureFonts } from "../../../lib/api/figureRenderInfo";
import type { FigureOverrides } from "../../../lib/figureOverrides";
import { Select } from "../../primitives";
import Num from "./PropertyNumberField";

const SIZE_FIELDS = [
  { key: "font_size", label: "font size" },
  { key: "title_size", label: "title size" },
  { key: "label_size", label: "axis label size" },
  { key: "tick_size", label: "tick label size" },
  { key: "legend_size", label: "legend size" },
] as const;

/** The picker's options: preset, then the proprietary names (with what they
 *  render as here), then every installed family; an unknown current value is
 *  kept so the picker never silently changes it. */
export function fontOptions(fonts: FigureFonts | null, current: string | undefined): { value: string; label: string }[] {
  const out = [{ value: "", label: "(preset)" }];
  const seen = new Set<string>([""]);
  for (const [name, res] of Object.entries(fonts?.aliases ?? {})) {
    const note = res.status === "installed" ? "" : res.status === "substituted" ? ` → ${res.family}` : ` (not installed → ${res.family})`;
    out.push({ value: name, label: `${name}${note}` });
    seen.add(name);
  }
  for (const family of fonts?.families ?? []) {
    if (seen.has(family)) continue;
    out.push({ value: family, label: family });
    seen.add(family);
  }
  if (current && !seen.has(current)) out.push({ value: current, label: `${current} (not installed)` });
  return out;
}

/** The note shown under the picker when the chosen font will not render as
 *  itself in the export; null when it will (or nothing is chosen). */
export function fontNote(fonts: FigureFonts | null, current: string | undefined): string | null {
  if (!current || !fonts) return null;
  const alias = fonts.aliases[current];
  if (alias && alias.status !== "installed") {
    return alias.status === "substituted"
      ? `${current} is not installed; exports use the metric-compatible ${alias.family}.`
      : `${current} is not installed; exports fall back to ${alias.family}.`;
  }
  const installed = fonts.families.some((f) => f.toLowerCase() === current.toLowerCase());
  return installed ? null : `${current} is not installed; exports fall back to DejaVu.`;
}

export default function TypographyPanel({
  overrides,
  patch,
}: {
  overrides: FigureOverrides;
  patch: (change: Partial<FigureOverrides>) => void;
}) {
  const [fonts, setFonts] = useState<FigureFonts | null>(null);
  useEffect(() => {
    let live = true;
    fetchFigureFonts().then((list) => live && setFonts(list), () => undefined); // offline: the picker keeps the preset + current value
    return () => {
      live = false;
    };
  }, []);
  const note = fontNote(fonts, overrides.font_name);
  return (
    <>
      {SIZE_FIELDS.map(({ key, label }) => (
        <Num key={key} label={label} value={overrides[key]} min={1} onValue={(v) => patch({ [key]: v })} />
      ))}
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
        <label className="qzk-field-lbl">font name</label>
        <Select
          aria-label="font name"
          style={{ maxWidth: 180 }}
          options={fontOptions(fonts, overrides.font_name)}
          value={overrides.font_name ?? ""}
          onChange={(event) => patch({ font_name: event.target.value || undefined })}
        />
      </span>
      {note && (
        <div role="status" className="qzk-ds-meta qzk-msg" style={{ width: "100%", color: "var(--text-dim)" }}>
          {note}
        </div>
      )}
    </>
  );
}
