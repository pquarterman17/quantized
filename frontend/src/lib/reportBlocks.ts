// Block-level edits on a report sheet (PRIMARY_SOFTWARE_AUDIT_PLAN P3.6) —
// the pure half of "Send figure to report" and the report viewer's per-block
// move/remove controls. Every function returns a NEW sheet (sharing untouched
// sections/blocks) and never mutates its input, so a result can go straight
// into `updateReportSheet` and the pre-edit sheet stays valid in the undo
// snapshot. No React/store imports: reached only from the lazy report viewer
// and the lazy send-to-report command, so it stays off the eager bundle.

import type { FigureSpec } from "./api/figures";
import type { ReportFigureBlock, ReportSheet } from "./report";

// Stable, NON-persisted identity for a block, for React keys and focus
// targeting in the viewer. Every edit above keeps untouched blocks as the
// same objects (a move swaps references, a remove filters), and undo/redo
// restore the very objects a snapshot held, so object identity IS block
// identity for as long as the block exists — no id field in the schema.
const blockKeys = new WeakMap<object, string>();
let blockKeySeq = 0;

/** This block's stable key (minted on first sight, never saved). */
export function reportBlockKey(block: object): string {
  let key = blockKeys.get(block);
  if (key === undefined) {
    key = `blk-${++blockKeySeq}`;
    blockKeys.set(block, key);
  }
  return key;
}

/** The section a sent figure lands in (created on first use). */
export const FIGURES_SECTION = "Figures";

/** A spec-carrying figure block. `spec` is stored as a DETACHED copy, immune
 *  to anything later done to the objects the live spec shared with the store
 *  (the same copy semantics as the backend's `calc.report.figure_block`).
 *  `structuredClone`, not a JSON round-trip: one copy instead of a full
 *  serialized string plus a re-parsed copy at peak. It keeps NaN/undefined
 *  in memory; they serialize exactly as the export wire does (NaN -> null,
 *  undefined dropped) whenever the block is exported or saved. */
export function figureBlockFromSpec(spec: FigureSpec, name: string, caption: string): ReportFigureBlock {
  const block: ReportFigureBlock = {
    type: "figure",
    name,
    spec: structuredClone(spec) as unknown as Record<string, unknown>,
  };
  const c = caption.trim();
  if (c) block.caption = c;
  return block;
}

/** `stem`, or `stem-2`, `stem-3`, … — the first not already a figure name in
 *  `sheet`, so each figure's export warning (which names it) and LaTeX file
 *  stem tell sent figures apart. */
export function uniqueFigureName(sheet: ReportSheet | null, stem: string): string {
  const taken = new Set<string>();
  for (const sec of sheet?.sections ?? []) {
    for (const b of sec.blocks) if (b.type === "figure") taken.add(b.name);
  }
  let name = stem;
  for (let n = 2; taken.has(name); n++) name = `${stem}-${n}`;
  return name;
}

/** Above this ESTIMATED serialized size a sent spec earns a heads-up toast:
 *  the report, every `.dwk` save/autosave and every report export carry it. */
export const LARGE_SPEC_BYTES = 5_000_000;
/** Estimated JSON bytes per number — a typical measured double ("12.3456789,"). */
export const BYTES_PER_NUMBER = 12;

/** A cheap estimate of `v`'s JSON size (numbers x BYTES_PER_NUMBER, strings
 *  by length), walked without serializing — so checking a large spec never
 *  allocates the string the clone above was chosen to avoid. */
export function estimateJsonBytes(v: unknown): number {
  if (typeof v === "number" || typeof v === "boolean" || v === null) return BYTES_PER_NUMBER;
  if (typeof v === "string") return v.length + 2;
  if (Array.isArray(v)) {
    let n = 2;
    for (const x of v) n += estimateJsonBytes(x);
    return n;
  }
  if (typeof v === "object" && v !== null) {
    let n = 2;
    for (const [k, x] of Object.entries(v)) n += k.length + 3 + estimateJsonBytes(x);
    return n;
  }
  return 0;
}

/** The info-toast text for a large sent spec, or `null` at/under the limit. */
export function largeSpecNotice(bytes: number): string | null {
  if (bytes <= LARGE_SPEC_BYTES) return null;
  const mb = (bytes / 1_000_000).toFixed(1);
  return `this figure carries ~${mb} MB of plotted data — the report and the saved .dwk grow by about that much`;
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
