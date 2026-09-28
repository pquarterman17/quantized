// The focused Statistics stage's plot area — the flat canvas or the facet
// grid — split out of StatStage.tsx (P2.6 box 4) so the wrapper stays under
// the component ceiling once the summary table joined it. Owns the plot half
// of the selection link: the draws get the row selection's marks
// (`useStatGroupSelection.decorate*`), and a click on a category slot picks
// that group — in a facet panel, only the group's rows IN that panel.
//
// P2.6 box 1: the error-bar footnote ("Error bars: SE of the mean") sits in a
// strip reserved under the whole figure — one per figure, flat or faceted, as
// the export's footnote is — so it never covers a panel's own axis caption.

import { useMemo, type MouseEvent } from "react";

import type { AxisSlot } from "../../lib/groupAxis";
import type { Accent, Theme } from "../../store/useApp";
import type { StatDrawData } from "./statRender";
import StatStageCanvas from "./StatStageCanvas";
import type { StatGroupSelection } from "./useStatGroupSelection";
import type { FacetDraw } from "./useStatStageCompute";

interface Props {
  draw: StatDrawData | null;
  drawFacets: FacetDraw[] | null;
  theme: Theme;
  accent: Accent;
  /** Null: no link (a non-categorical mode). */
  sel: StatGroupSelection | null;
  /** Space kept free on the right for the summary dock, px. */
  right: number;
  /** Which error bar the figure draws (`statErrorNote.figureErrorNote`);
   *  null = none drawn, no footnote strip. */
  errorNote?: string | null;
}

/** Height of the footnote strip under the figure, px. */
const NOTE_H = 18;

function ErrorNote({ text, right }: { text: string; right: number }) {
  return (
    <div
      data-testid="stat-error-note"
      style={{
        position: "absolute",
        left: 16,
        right: 8 + right,
        bottom: 2,
        height: NOTE_H - 4,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontStyle: "italic",
        color: "var(--text-dim)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
}

function drawnSlots(d: StatDrawData | null): readonly AxisSlot[] {
  return d && "slots" in d && d.slots ? d.slots : [];
}

export default function StatStagePlot({ draw, drawFacets, theme, accent, sel, right, errorNote = null }: Props) {
  const decorate = sel?.decorate;
  const decorateFacets = sel?.decorateFacets;
  const shown = useMemo(() => (decorate ? decorate(draw) : draw), [decorate, draw]);
  const shownFacets = useMemo(
    () => (decorateFacets ? decorateFacets(drawFacets) : drawFacets),
    [decorateFacets, drawFacets],
  );

  const clickFor = (d: StatDrawData | null, panel?: string) => {
    const slots = drawnSlots(d);
    if (!sel || !slots.length || slots.some((s) => s.key == null)) return {};
    return {
      slotCount: slots.length,
      onSlotClick: (i: number, e: MouseEvent) =>
        sel.select(slots[i].key as string, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey }, panel),
    };
  };

  const foot = errorNote ? NOTE_H : 0;
  const plot = shownFacets ? (
    <div
      style={{
        position: "absolute",
        inset: 8,
        right: 8 + right,
        bottom: 8 + foot,
        display: "grid",
        gap: 8,
        gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(shownFacets.length))}, 1fr)`,
      }}
    >
      {shownFacets.map((f) => (
        <div key={f.label} style={{ position: "relative", display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              color: "var(--text-dim)",
              padding: "0 2px 2px",
            }}
          >
            {f.label}
          </div>
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
            <StatStageCanvas data={f.draw} theme={theme} accent={accent} {...clickFor(f.draw, f.label)} />
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div style={{ position: "absolute", inset: 0, right, bottom: foot }}>
      <StatStageCanvas data={shown} theme={theme} accent={accent} {...clickFor(shown)} />
    </div>
  );
  return (
    <>
      {plot}
      {errorNote && <ErrorNote text={errorNote} right={right} />}
    </>
  );
}
