// Block-level edits on a report sheet (PRIMARY_SOFTWARE_AUDIT_PLAN P3.6) —
// the pure half of "Send figure to report" and the report viewer's per-block
// move/remove controls. Every function returns a NEW sheet (sharing untouched
// sections/blocks) and never mutates its input, so a result can go straight
// into `updateReportSheet` and the pre-edit sheet stays valid in the undo
// snapshot. No React/store imports: reached only from the lazy report viewer
// and the lazy send-to-report command, so it stays off the eager bundle.

import type { FigureSpec } from "./api/figures";
import type { ReportFigureBlock, ReportSheet } from "./report";

/** The section a sent figure lands in (created on first use). */
export const FIGURES_SECTION = "Figures";

/** A spec-carrying figure block. `spec` is stored as a detached, JSON-clean
 *  copy — exactly the bytes `/api/export/figure` would receive (NaN -> null
 *  as `JSON.stringify` sends it), and immune to anything later done to the
 *  objects the live spec shared with the store. Mirrors the backend's own
 *  `calc.report.figure_block` (`json.loads(json.dumps(spec))`). */
export function figureBlockFromSpec(spec: FigureSpec, name: string, caption: string): ReportFigureBlock {
  const block: ReportFigureBlock = {
    type: "figure",
    name,
    spec: JSON.parse(JSON.stringify(spec)) as Record<string, unknown>,
  };
  const c = caption.trim();
  if (c) block.caption = c;
  return block;
}

/** A new one-section report holding `block`. `created` matches the backend
 *  emitter's stamp format (ISO-8601, seconds, UTC). */
export function newFigureReport(title: string, block: ReportFigureBlock, now: Date = new Date()): ReportSheet {
  return {
    title,
    sections: [{ title: FIGURES_SECTION, blocks: [block] }],
    created: now.toISOString().replace(/\.\d{3}Z$/, "+00:00"),
  };
}

/** `sheet` with `block` appended to its LAST section titled
 *  {@link FIGURES_SECTION}, or to a new such section at the end. */
export function appendFigureBlock(sheet: ReportSheet, block: ReportFigureBlock): ReportSheet {
  let at = -1;
  sheet.sections.forEach((sec, i) => {
    if (sec.title === FIGURES_SECTION) at = i;
  });
  if (at < 0) return { ...sheet, sections: [...sheet.sections, { title: FIGURES_SECTION, blocks: [block] }] };
  return {
    ...sheet,
    sections: sheet.sections.map((sec, i) => (i === at ? { ...sec, blocks: [...sec.blocks, block] } : sec)),
  };
}

/** `sheet` with block `bi` of section `si` moved by `delta` places within its
 *  section; `null` when the move is out of range (nothing to do). */
export function moveReportBlock(sheet: ReportSheet, si: number, bi: number, delta: -1 | 1): ReportSheet | null {
  const sec = sheet.sections[si];
  const to = bi + delta;
  if (!sec || bi < 0 || bi >= sec.blocks.length || to < 0 || to >= sec.blocks.length) return null;
  const blocks = [...sec.blocks];
  [blocks[bi], blocks[to]] = [blocks[to], blocks[bi]];
  return { ...sheet, sections: sheet.sections.map((s, i) => (i === si ? { ...s, blocks } : s)) };
}

/** `sheet` without block `bi` of section `si` (an emptied section stays, so
 *  its title and later sends still have a home); `null` when out of range. */
export function removeReportBlock(sheet: ReportSheet, si: number, bi: number): ReportSheet | null {
  const sec = sheet.sections[si];
  if (!sec || bi < 0 || bi >= sec.blocks.length) return null;
  const blocks = sec.blocks.filter((_, j) => j !== bi);
  return { ...sheet, sections: sheet.sections.map((s, i) => (i === si ? { ...s, blocks } : s)) };
}
